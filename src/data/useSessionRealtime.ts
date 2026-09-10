import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSessionWithSlots } from './sessions'
import { getMySlotIds } from './slots'
import { parseSlot, type Session, type Slot } from './types'

export type SessionRealtimeState = {
  session: Session | null
  slots: Slot[]
  mySlotIds: ReadonlySet<string>
  loading: boolean
  error: string | null
  notFound: boolean
  applyLocal: (slot: Slot) => void
  setOwned: (slotId: string, owned: boolean) => void
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

export function useSessionRealtime(sessionId: string | undefined): SessionRealtimeState {
  const [session, setSession] = useState<Session | null>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const [mySlotIds, setMySlotIds] = useState<ReadonlySet<string>>(new Set())
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
    // so it is caught independently and simply falls back to an empty set.
    const sessionPromise = getSessionWithSlots(sessionId)
    const ownedPromise = getMySlotIds(sessionId).catch(() => new Set<string>())

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

    return () => {
      cancelled = true
    }
  }, [sessionId, nonce])

  useEffect(() => {
    if (sessionId === undefined) return

    const channel = supabase
      .channel(`slots:${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'slots', filter: `session_id=eq.${sessionId}` },
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
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [sessionId])

  return { session, slots, mySlotIds, loading, error, notFound, applyLocal, setOwned, refetch }
}
