import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { AdminContactToggle } from '../components/AdminContact'
import { Button } from '../components/Button'
import { ClaimSheet } from '../components/ClaimSheet'
import { CopyButton } from '../components/CopyButton'
import { ListTeam } from '../components/ListTeam'
import { PitchTeam } from '../components/PitchTeam'
import { SessionMeta } from '../components/SessionMeta'
import type { SlotView } from '../components/SlotChip'
import { useToast } from '../components/Toast'
import { WaitlistSheet } from '../components/WaitlistSheet'
import { useAuthUser } from '../data/auth'
import { SlotActionError, adminClearSlot, claimSlot, releaseSlot } from '../data/slots'
import type { Slot } from '../data/types'
import { useSessionRealtime } from '../data/useSessionRealtime'
import { WaitlistActionError, joinWaitlist, leaveWaitlist } from '../data/waitlist'
import { TEAM_KEYS, formatPositions, positionLabel, type Position, type TeamKey } from '../lib/positions'
import { rememberPlayer } from '../lib/playerMemory'
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
 *  fails. */
type OptimisticChange = {
  slot: Slot | null
  owned: readonly OwnershipChange[]
  revertSlot: Slot | null
  revertOwned: readonly OwnershipChange[]
}

export default function SessionPage() {
  const { id } = useParams()
  const {
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
  } = useSessionRealtime(id)
  const { show } = useToast()
  const { role } = useAuthUser()
  // Being signed in is not enough any more -- a signed-in non-admin must not
  // get the organiser override, only someone with a row in sepak.admins.
  const isAdmin = role !== null

  const [selected, setSelected] = useState<SlotView | null>(null)
  const [busy, setBusy] = useState(false)
  const [viewMode, setViewMode] = useState<'pitch' | 'list'>(readViewMode)
  const [pendingName, setPendingName] = useState('')
  const [waitlistOpen, setWaitlistOpen] = useState(false)

  useEffect(() => {
    setPendingName('')
  }, [selected])

  const mySlot = slots.find((slot) => mySlotIds.has(slot.id)) ?? null
  const filled = slots.filter((slot) => slot.playerName !== null).length
  const open = 33 - filled
  const closed = session?.status === 'closed'

  const duplicateName =
    pendingName.trim() !== '' &&
    slots.some((slot) => slot.playerName?.toLowerCase() === pendingName.trim().toLowerCase())

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
      waitlist: waitlist.map(({ playerName, positions }) => ({ playerName, positions })),
    })
  }, [session, slots, waitlist])

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
    } catch (cause: unknown) {
      if (optimistic.revertSlot !== null) applyLocal(optimistic.revertSlot)
      for (const [slotId, owned] of optimistic.revertOwned) setOwned(slotId, owned)
      show(cause instanceof SlotActionError ? cause.message : 'Ada masalah. Cuba lagi.', 'error')
      refetch()
    } finally {
      setBusy(false)
    }
  }

  function onClaim(name: string, phone: string) {
    const slot = selected?.slot
    if (slot === undefined || slot === null) return
    const claimed: Slot = { ...slot, playerName: name, claimedAt: new Date().toISOString() }
    void run(
      () => claimSlot(slot.id, name, phone),
      {
        slot: claimed,
        owned: [[slot.id, true]],
        revertSlot: slot,
        revertOwned: [[slot.id, false]],
      },
      () => rememberPlayer({ name, phone }),
    )
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

  async function onAdminClear() {
    const slot = selected?.slot
    if (slot === undefined || slot === null) return
    setBusy(true)
    try {
      await adminClearSlot(slot.id)
      applyLocal({ ...slot, playerName: null, claimedAt: null })
      // The organiser may be clearing their own claim: drop local ownership
      // too, or `mySlotIds` keeps pointing at a slot that is now empty (the
      // "Slot anda" summary would keep naming it, and reopening it would
      // offer a release that no longer applies to anyone).
      setOwned(slot.id, false)
      setSelected(null)
    } catch (cause: unknown) {
      show(cause instanceof SlotActionError ? cause.message : 'Gagal mengosongkan slot.', 'error')
      refetch()
    } finally {
      setBusy(false)
    }
  }

  function onJoinWaitlist(name: string, phone: string, positions: Position[]) {
    if (session === null) return
    setBusy(true)
    joinWaitlist(session.id, name, phone, positions)
      .then((result) => {
        rememberPlayer({ name, phone })
        setWaitlistOpen(false)
        if (result.placed) {
          // Marking ownership here, ahead of the realtime event for the
          // slot's own row, is what makes the claimed slot highlighted the
          // instant the sheet closes — see the design doc's UI section.
          setOwned(result.slotId, true)
          show('Slot kosong dah wujud — anda terus dapat tempat!')
          return
        }
        const entry = { id: result.waitlistId, positions, createdAt: new Date().toISOString() }
        setMyWaitlistEntry(entry)
        applyWaitlistLocal({ ...entry, sessionId: session.id, playerName: name })
      })
      .catch((cause: unknown) => {
        show(cause instanceof WaitlistActionError ? cause.message : 'Ada masalah. Cuba lagi.', 'error')
      })
      .finally(() => setBusy(false))
  }

  function onLeaveWaitlist() {
    if (session === null) return
    const entry = myWaitlistEntry
    setBusy(true)
    leaveWaitlist(session.id)
      .then(() => {
        if (entry !== null) removeWaitlistLocal(entry.id)
        setMyWaitlistEntry(null)
      })
      .catch((cause: unknown) => {
        show(cause instanceof WaitlistActionError ? cause.message : 'Ada masalah. Cuba lagi.', 'error')
      })
      .finally(() => setBusy(false))
  }

  if (loading) return <p className="p-6 font-sans text-white/45">Memuatkan…</p>

  if (notFound) {
    return (
      <div className="space-y-3 p-6">
        <p className="font-sans text-[15px] text-white/70">Sesi tak dijumpai.</p>
        <Link to="/" className="text-turf-lit underline">Balik ke senarai sesi</Link>
      </div>
    )
  }

  if (error !== null || session === null) {
    return (
      <div className="space-y-3 p-6">
        <p className="font-sans text-[15px] text-merah-soft">Gagal memuatkan sesi.</p>
        <Button variant="secondary" onClick={refetch}>
          Cuba lagi
        </Button>
      </div>
    )
  }

  const TeamView = viewMode === 'pitch' ? PitchTeam : ListTeam

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 pb-24 md:p-8 lg:grid lg:grid-cols-[340px_1fr] lg:items-start lg:gap-8 lg:space-y-0">
      <div className="space-y-4 lg:sticky lg:top-8">
        <SessionMeta session={session} filled={filled} total={33} />

        {mySlot !== null ? (
          <p className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 font-kit text-[15px]">
            {`Slot anda: Team ${mySlot.team} ${session.teamNames[mySlot.team]} — ${positionLabel(mySlot.position)}`}
          </p>
        ) : (
          // Without this, nothing on the page says what to do — every slot looks
          // like a label rather than a thing you can take.
          !closed && (
            <div className="space-y-2 rounded-lg border border-turf-lit/50 bg-turf/25 px-3 py-2">
              {open > 0 && (
                <p className="font-kit text-[15px] text-white">
                  {`Tekan posisi kosong untuk daftar — ${open} lagi kosong.`}
                </p>
              )}
              {myWaitlistEntry !== null ? (
                <p className="font-kit text-[15px] text-white">
                  {`Anda dalam senarai tunggu (${formatPositions(myWaitlistEntry.positions)}).`}
                </p>
              ) : (
                <Button variant="primary" onClick={() => setWaitlistOpen(true)} className="w-full">
                  Sertai senarai tunggu
                </Button>
              )}
            </div>
          )
        )}

        <button
          type="button"
          onClick={toggleViewMode}
          className="ml-auto block rounded-md px-2 py-1 font-kit text-[13px] font-medium text-white/45 underline decoration-white/20 underline-offset-4 active:text-white"
        >
          {viewMode === 'pitch' ? 'Papar senarai' : 'Papar padang'}
        </button>

        <CopyButton text={whatsappText} label="Salin untuk WhatsApp" />
      </div>

      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {TEAM_KEYS.map((team: TeamKey) => (
            <TeamView
              key={team}
              team={team}
              teamName={session.teamNames[team]}
              slots={slots.filter((slot) => slot.team === team)}
              mySlotIds={mySlotIds}
              disabled={closed || busy}
              adminOverride={isAdmin}
              onSelect={setSelected}
            />
          ))}
        </div>

        {waitlist.length > 0 && (
          <section className="rounded-lg bg-night-2 p-3">
            <h3 className="mb-2 font-kit text-base font-semibold tracking-wide text-white">
              {`Senarai Tunggu (${waitlist.length})`}
            </h3>
            <ol className="space-y-2">
              {waitlist.map((entry, index) => {
                const mine = myWaitlistEntry !== null && myWaitlistEntry.id === entry.id
                return (
                  <li
                    key={entry.id}
                    className={[
                      'space-y-1 rounded-lg px-3 py-2',
                      mine ? 'border border-turf-lit/50 bg-turf/25' : 'bg-night',
                    ].join(' ')}
                  >
                    <p className="font-sans text-[14px] text-white">
                      {`${index + 1}. ${entry.playerName}`}
                      <span className="ml-2 text-white/45">{`(${formatPositions(entry.positions)})`}</span>
                    </p>
                    {mine && (
                      <Button
                        variant="destructive"
                        disabled={busy}
                        onClick={onLeaveWaitlist}
                        className="px-2 py-1 text-[12px]"
                      >
                        Keluar dari senarai tunggu
                      </Button>
                    )}
                    {isAdmin && <AdminContactToggle target={{ waitlistId: entry.id }} />}
                  </li>
                )
              })}
            </ol>
          </section>
        )}
      </div>

      <ClaimSheet
        view={selected}
        teamName={
          selected?.slot === undefined || selected.slot === null
            ? ''
            : `Team ${selected.slot.team} ${session.teamNames[selected.slot.team]}`
        }
        busy={busy}
        duplicateName={duplicateName}
        isAdmin={isAdmin}
        onClose={() => setSelected(null)}
        onClaim={onClaim}
        onRelease={onRelease}
        onAdminClear={() => void onAdminClear()}
        onNameChange={setPendingName}
      />

      <WaitlistSheet
        open={waitlistOpen}
        busy={busy}
        onClose={() => setWaitlistOpen(false)}
        onJoin={onJoinWaitlist}
      />
    </div>
  )
}
