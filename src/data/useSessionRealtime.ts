import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSessionWithSlots } from './sessions'
import { getMySlotIds } from './slots'
import { parseSlot, type Session, type Slot } from './types'
import { getMyWaitlistEntry, listWaitlist, parseWaitlistEntry, type MyWaitlistEntry, type WaitlistEntry } from './waitlist'

export type SessionRealtimeState = {
  session: Session | null
  slots: Slot[]
  mySlotIds: ReadonlySet<string>
  waitlist: WaitlistEntry[]
  myWaitlistEntry: MyWaitlistEntry | null
  loading: boolean
  error: string | null
  notFound: boolean
  applyLocal: (slot: Slot) => void
  setOwned: (slotId: string, owned: boolean) => void
  applyWaitlistLocal: (entry: WaitlistEntry) => void
  removeWaitlistLocal: (id: string) => void
  setMyWaitlistEntry: (entry: MyWaitlistEntry | null) => void
  refetch: () => void
}

function replace(slots: readonly Slot[], next: Slot): Slot[] {
  const index = slots.findIndex((slot) => slot.id === next.id)
  if (index === -1) return [...slots, next]
  return slots.map((slot) => (slot.id === next.id ? next : slot))
}

function withOwned(current: ReadonlySet<string>, slotId: string, owned: boolean): Set<string> {
  const next = new Set(current)
  if (owned) next.add(slotId)
  else next.delete(slotId)
  return next
}

/** Kept in the queue's own order (created_at ascending) -- the order
 *  auto-fill itself reads, and the order the queue list renders in. */
function upsertWaitlistEntry(entries: readonly WaitlistEntry[], next: WaitlistEntry): WaitlistEntry[] {
  const without = entries.filter((entry) => entry.id !== next.id)
  return [...without, next].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function removeWaitlistEntry(entries: readonly WaitlistEntry[], id: string): WaitlistEntry[] {
  return entries.filter((entry) => entry.id !== id)
}

/** A realtime DELETE payload's `old` row carries only the primary key under
 *  Postgres's default replica identity -- exactly enough to know which row
 *  left the queue, never its contents. */
function deletedId(old: unknown): string | null {
  if (typeof old !== 'object' || old === null) return null
  const id = Object.fromEntries(Object.entries(old))['id']
  return typeof id === 'string' ? id : null
}

export function useSessionRealtime(sessionId: string | undefined): SessionRealtimeState {
  const [session, setSession] = useState<Session | null>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const [mySlotIds, setMySlotIds] = useState<ReadonlySet<string>>(new Set())
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([])
  const [myWaitlistEntry, setMyWaitlistEntryState] = useState<MyWaitlistEntry | null>(null)
  // A `setState` updater function does not run synchronously at the call
  // site -- it runs later, when React reconciles the update -- so the
  // realtime handler below cannot learn "was this my own entry" by reading
  // a flag set inside `setMyWaitlistEntryState`'s updater. This ref mirrors
  // the state and is readable immediately, in the same tick as the event.
  const myWaitlistEntryRef = useRef<MyWaitlistEntry | null>(null)
  const [loading, setLoading] = useState(sessionId !== undefined)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [nonce, setNonce] = useState(0)

  const refetch = useCallback(() => setNonce((n) => n + 1), [])
  const applyLocal = useCallback((slot: Slot) => setSlots((current) => replace(current, slot)), [])
  const setOwned = useCallback(
    (slotId: string, owned: boolean) => setMySlotIds((current) => withOwned(current, slotId, owned)),
    [],
  )
  const applyWaitlistLocal = useCallback(
    (entry: WaitlistEntry) => setWaitlist((current) => upsertWaitlistEntry(current, entry)),
    [],
  )
  const removeWaitlistLocal = useCallback(
    (id: string) => setWaitlist((current) => removeWaitlistEntry(current, id)),
    [],
  )
  const setMyWaitlistEntry = useCallback((entry: MyWaitlistEntry | null) => setMyWaitlistEntryState(entry), [])

  useEffect(() => {
    myWaitlistEntryRef.current = myWaitlistEntry
  }, [myWaitlistEntry])

  useEffect(() => {
    if (sessionId === undefined) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    setNotFound(false)

    // Fetched alongside the session rather than after it, so ownership
    // does not serialise a second round trip behind the session load. A
    // failure here must not fail the whole page — a player who cannot see
    // their own highlight is a much smaller problem than a blank page —
    // so each is caught independently and simply falls back to empty.
    const sessionPromise = getSessionWithSlots(sessionId)
    const ownedPromise = getMySlotIds(sessionId).catch(() => new Set<string>())
    const waitlistPromise = listWaitlist(sessionId).catch(() => [] as WaitlistEntry[])
    const myWaitlistPromise = getMyWaitlistEntry(sessionId).catch(() => null)

    sessionPromise
      .then((result) => {
        if (cancelled) return
        if (result === null) {
          setNotFound(true)
          return
        }
        setSession(result.session)
        setSlots(result.slots)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : 'Ada masalah memuatkan sesi.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    ownedPromise.then((ids) => {
      if (cancelled) return
      setMySlotIds(ids)
    })

    waitlistPromise.then((entries) => {
      if (cancelled) return
      setWaitlist(entries)
    })

    myWaitlistPromise.then((entry) => {
      if (cancelled) return
      setMyWaitlistEntryState(entry)
    })

    return () => {
      cancelled = true
    }
  }, [sessionId, nonce])

  useEffect(() => {
    if (sessionId === undefined) return

    let everConnected = false

    const channel = supabase
      .channel(`session:${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'sepak', table: 'slots', filter: `session_id=eq.${sessionId}` },
        (payload: { new: unknown }) => {
          // A malformed payload must never take the page down; parseSlot throws
          // on anything unexpected and the event is simply dropped.
          try {
            const slot = parseSlot(payload.new)
            setSlots((current) => replace(current, slot))
          } catch {
            // ignore
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'sepak', table: 'waitlist', filter: `session_id=eq.${sessionId}` },
        (payload: { eventType: string; new: unknown; old: unknown }) => {
          // Auto-fill deletes the placed entry's row in the same transaction
          // as the slot update, so this and the slots handler above are what
          // let the page show both the slot filling and the queue shrinking
          // live, without a reload.
          if (payload.eventType === 'DELETE') {
            const id = deletedId(payload.old)
            if (id === null) return
            setWaitlist((current) => removeWaitlistEntry(current, id))

            const wasMine = myWaitlistEntryRef.current !== null && myWaitlistEntryRef.current.id === id
            setMyWaitlistEntryState((current) => (current !== null && current.id === id ? null : current))

            // This device's own entry just vanished server-side -- an
            // in-page leave already cleared myWaitlistEntry locally before
            // this event arrives, so wasMine only fires here for auto-fill.
            // The slots subscription above delivers the slot's new content,
            // but nothing tells this device the slot is now ITS OWN except
            // re-asking my_slot_ids -- ownership is never inferred from a
            // slot's content, only proven by presenting the token.
            if (wasMine) {
              getMySlotIds(sessionId)
                .then((ids) => setMySlotIds((current) => new Set([...current, ...ids])))
                .catch(() => {
                  // best-effort: worst case the highlight lags until refetch
                })
            }
            return
          }
          try {
            const entry = parseWaitlistEntry(payload.new)
            setWaitlist((current) => upsertWaitlistEntry(current, entry))
          } catch {
            // ignore a malformed payload, same as the slots handler above
          }
        },
      )
      .subscribe((status: string) => {
        // Slots/waitlist may have changed while the socket was down, so a
        // reconnect refetches rather than trusting what is on screen. The
        // first connect is skipped: the initial load already fetched.
        if (status === 'SUBSCRIBED') {
          if (everConnected) refetch()
          everConnected = true
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [sessionId, refetch])

  return {
    session,
    slots,
    mySlotIds,
    waitlist,
    myWaitlistEntry,
    loading,
    error,
    notFound,
    applyLocal,
    setOwned,
    applyWaitlistLocal,
    removeWaitlistLocal,
    setMyWaitlistEntry,
    refetch,
  }
}
