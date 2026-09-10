import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ClaimSheet } from '../components/ClaimSheet'
import { CopyButton } from '../components/CopyButton'
import { ListTeam } from '../components/ListTeam'
import { PitchTeam } from '../components/PitchTeam'
import { SessionMeta } from '../components/SessionMeta'
import type { SlotView } from '../components/SlotChip'
import { useToast } from '../components/Toast'
import { SlotActionError, claimSlot, moveSlot, releaseSlot } from '../data/slots'
import type { Slot } from '../data/types'
import { useSessionRealtime } from '../data/useSessionRealtime'
import { TEAM_KEYS, positionLabel, type TeamKey } from '../lib/positions'
import { buildWhatsAppMessage } from '../lib/whatsapp'

const VIEW_MODE_KEY = 'sepak.viewMode'

function readViewMode(): 'pitch' | 'list' {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'pitch'
  } catch {
    return 'pitch'
  }
}

/** One ownership toggle to apply against the hook's `mySlotIds` set. */
type OwnershipChange = readonly [slotId: string, owned: boolean]

/** What an action changes optimistically, and what undoes it if the write
 *  fails. `slot`/`revertSlot` are `null` for a move: it touches two rows, so
 *  rather than guess both optimistically the page waits for the real result
 *  and fixes ownership from that outcome instead (see `onMove`). */
type OptimisticChange = {
  slot: Slot | null
  owned: readonly OwnershipChange[]
  revertSlot: Slot | null
  revertOwned: readonly OwnershipChange[]
}

export default function SessionPage() {
  const { id } = useParams()
  const { session, slots, mySlotIds, loading, error, notFound, applyLocal, setOwned, refetch } =
    useSessionRealtime(id)
  const { show } = useToast()

  const [selected, setSelected] = useState<SlotView | null>(null)
  const [movingFrom, setMovingFrom] = useState<Slot | null>(null)
  const [busy, setBusy] = useState(false)
  const [viewMode, setViewMode] = useState<'pitch' | 'list'>(readViewMode)

  const mySlot = slots.find((slot) => mySlotIds.has(slot.id)) ?? null
  const filled = slots.filter((slot) => slot.playerName !== null).length
  const closed = session?.status === 'closed'

  const whatsappText = useMemo(() => {
    if (session === null) return ''
    return buildWhatsAppMessage({
      sessionNo: session.sessionNo,
      title: session.title,
      playDate: session.playDate,
      startTime: session.startTime,
      venue: session.venue,
      feeMyr: session.feeMyr,
      teamNames: session.teamNames,
      slots: slots.map(({ team, position, playerName }) => ({ team, position, playerName })),
    })
  }, [session, slots])

  function toggleViewMode() {
    const next = viewMode === 'pitch' ? 'list' : 'pitch'
    setViewMode(next)
    try {
      localStorage.setItem(VIEW_MODE_KEY, next)
    } catch {
      // a remembered preference is a convenience, not a requirement
    }
  }

  /** Optimistic: the slot and its ownership change immediately, and both are
   *  put back if the write loses. The realtime event that follows simply
   *  confirms what is already on screen. */
  async function run(
    action: () => Promise<Slot>,
    optimistic: OptimisticChange,
    onSuccess?: (result: Slot) => void,
  ) {
    setBusy(true)
    if (optimistic.slot !== null) applyLocal(optimistic.slot)
    for (const [slotId, owned] of optimistic.owned) setOwned(slotId, owned)
    try {
      const result = await action()
      applyLocal(result)
      onSuccess?.(result)
      setSelected(null)
      setMovingFrom(null)
    } catch (cause: unknown) {
      if (optimistic.revertSlot !== null) applyLocal(optimistic.revertSlot)
      for (const [slotId, owned] of optimistic.revertOwned) setOwned(slotId, owned)
      show(cause instanceof SlotActionError ? cause.message : 'Ada masalah. Cuba lagi.', 'error')
      refetch()
    } finally {
      setBusy(false)
    }
  }

  function onClaim(name: string) {
    const slot = selected?.slot
    if (slot === undefined || slot === null) return
    const claimed: Slot = { ...slot, playerName: name, claimedAt: new Date().toISOString() }
    void run(() => claimSlot(slot.id, name), {
      slot: claimed,
      owned: [[slot.id, true]],
      revertSlot: slot,
      revertOwned: [[slot.id, false]],
    })
  }

  function onRelease() {
    const slot = selected?.slot
    if (slot === undefined || slot === null) return
    const released: Slot = { ...slot, playerName: null, claimedAt: null }
    void run(() => releaseSlot(slot.id), {
      slot: released,
      owned: [[slot.id, false]],
      revertSlot: slot,
      revertOwned: [[slot.id, true]],
    })
  }

  function onMove(fromId: string, toId: string) {
    void run(
      () => moveSlot(fromId, toId),
      { slot: null, owned: [], revertSlot: null, revertOwned: [] },
      () => {
        setOwned(fromId, false)
        setOwned(toId, true)
      },
    )
  }

  function onSelect(view: SlotView) {
    if (movingFrom !== null) {
      const target = view.slot
      if (target !== null && target.playerName === null) {
        onMove(movingFrom.id, target.id)
        return
      }
    }
    setSelected(view)
  }

  if (loading) return <p className="p-6 text-slate-400">Memuatkan…</p>

  if (notFound) {
    return (
      <div className="space-y-3 p-6">
        <p>Sesi tak dijumpai.</p>
        <Link to="/" className="text-emerald-400 underline">Balik ke senarai sesi</Link>
      </div>
    )
  }

  if (error !== null || session === null) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-red-400">Gagal memuatkan sesi.</p>
        <button
          type="button"
          onClick={refetch}
          className="rounded-2xl bg-slate-800 px-4 py-2 text-sm font-semibold"
        >
          Cuba lagi
        </button>
      </div>
    )
  }

  const TeamView = viewMode === 'pitch' ? PitchTeam : ListTeam

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pb-24">
      <SessionMeta session={session} filled={filled} total={33} />

      {mySlot !== null && (
        <p className="rounded-2xl bg-amber-400/15 px-4 py-2 text-sm text-amber-200">
          {`Slot anda: Team ${mySlot.team} ${session.teamNames[mySlot.team]} — ${positionLabel(mySlot.position)}`}
        </p>
      )}

      {movingFrom !== null && (
        <p className="rounded-2xl bg-sky-400/15 px-4 py-2 text-sm text-sky-200">
          Pilih posisi kosong untuk bertukar.{' '}
          <button type="button" onClick={() => setMovingFrom(null)} className="underline">Batal</button>
        </p>
      )}

      <button
        type="button"
        onClick={toggleViewMode}
        className="w-full rounded-2xl bg-slate-800/70 px-4 py-2 text-xs font-semibold text-slate-300"
      >
        {viewMode === 'pitch' ? 'Papar senarai' : 'Papar padang'}
      </button>

      {TEAM_KEYS.map((team: TeamKey) => (
        <TeamView
          key={team}
          team={team}
          teamName={session.teamNames[team]}
          slots={slots.filter((slot) => slot.team === team)}
          mySlotIds={mySlotIds}
          disabled={closed || busy}
          onSelect={onSelect}
        />
      ))}

      <CopyButton text={whatsappText} label="Salin untuk WhatsApp" />

      <ClaimSheet
        view={selected}
        teamName={
          selected?.slot == null ? '' : `Team ${selected.slot.team} ${session.teamNames[selected.slot.team]}`
        }
        busy={busy}
        onClose={() => setSelected(null)}
        onClaim={onClaim}
        onRelease={onRelease}
        onStartMove={() => {
          setMovingFrom(selected?.slot ?? null)
          setSelected(null)
        }}
      />
    </div>
  )
}
