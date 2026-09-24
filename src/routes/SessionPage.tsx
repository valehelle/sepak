import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { AdminContactToggle } from '../components/AdminContact'
import { Button } from '../components/Button'
import { ClaimSheet } from '../components/ClaimSheet'
import { CopyButton } from '../components/CopyButton'
import { ListTeam } from '../components/ListTeam'
import { PitchTeam } from '../components/PitchTeam'
import { NotifySheet } from '../components/NotifySheet'
import { SessionMeta } from '../components/SessionMeta'
import type { SlotView } from '../components/SlotChip'
import { useToast } from '../components/Toast'
import { WaitlistSheet } from '../components/WaitlistSheet'
import { useAuthUser } from '../data/auth'
import { hasPushSubscription } from '../data/push'
import {
  SlotActionError,
  adminClearSlot,
  claimSlot,
  getSlot,
  moveSlot,
  releaseSlot,
  setSlotPaid,
} from '../data/slots'
import type { Slot } from '../data/types'
import { useSessionRealtime } from '../data/useSessionRealtime'
import { hasTelegramChat } from '../data/telegram'
import {
  WaitlistActionError,
  adminRemoveFromWaitlist,
  joinWaitlist,
  leaveWaitlist,
} from '../data/waitlist'
import { TEAM_KEYS, formatPositions, positionLabel, type Position, type TeamKey } from '../lib/positions'
import { rememberSession } from '../lib/lastSession'
import { rememberPlayer } from '../lib/playerMemory'
import { ShareChangeSheet } from '../components/ShareChangeSheet'
import { buildWhatsAppMessage, describeChange, type RosterChange } from '../lib/whatsapp'

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
  // Which queue entry the organiser has armed for removal, if any. One at a
  // time: the confirm replaces the button in place.
  const [removingFromQueue, setRemovingFromQueue] = useState<string | null>(null)
  // What to offer the group, after a change that makes the list already
  // pasted there wrong. Null the rest of the time.
  const [change, setChange] = useState<RosterChange | null>(null)
  const [pushOpen, setPushOpen] = useState(false)
  const [pushOn, setPushOn] = useState(true)

  useEffect(() => {
    setPendingName('')
  }, [selected])

  // The installed app's icon can only open one address, and that address is
  // the index. Remembering the session lets it land somewhere useful.
  useEffect(() => {
    if (session !== null) rememberSession(session.id)
  }, [session])

  const mySlot = slots.find((slot) => mySlotIds.has(slot.id)) ?? null
  const filled = slots.filter((slot) => slot.playerName !== null).length
  const open = slots.length - filled
  // The teams this session was built with: three for the older sessions,
  // four since 0016_four_teams.sql.
  const teams = TEAM_KEYS.filter((team) => slots.some((slot) => slot.team === team))
  const closed = session?.status === 'closed'

  // Only asked when there is something to ask about -- a device holding a
  // slot or a queue place. Either channel counts as notified, so both are
  // asked; `pushOn` starts true so the button never flashes into view before
  // the answers arrive.
  const mineId = mySlot?.id ?? myWaitlistEntry?.id ?? null
  useEffect(() => {
    if (mineId === null) return
    let cancelled = false
    Promise.all([hasPushSubscription(), hasTelegramChat()])
      .then(([push, telegram]) => { if (!cancelled) setPushOn(push || telegram) })
      .catch(() => { if (!cancelled) setPushOn(false) })
    return () => { cancelled = true }
  }, [mineId])

  const duplicateName =
    pendingName.trim() !== '' &&
    slots.some((slot) => slot.playerName?.toLowerCase() === pendingName.trim().toLowerCase())

  // Null when there is nothing worth telling the group -- an un-tick, say.
  const changeLine = change === null ? null : describeChange(change)

  /** The group message. `line` leads it when a change is being announced;
   *  the organiser's own copy button passes nothing and gets exactly the
   *  message it always did. */
  const buildMessage = useCallback(
    (line: string | null): string => {
      if (session === null) return ''
      return buildWhatsAppMessage({
        sessionNo: session.sessionNo,
        title: session.title,
        playDate: session.playDate,
        startTime: session.startTime,
        venue: session.venue,
        feeMyr: session.feeMyr,
        feeGkMyr: session.feeGkMyr,
        teamNames: session.teamNames,
        slots: slots.map(({ team, position, playerName, paid }) => ({ team, position, playerName, paid })),
        waitlist: waitlist.map(({ playerName, positions }) => ({ playerName, positions })),
        // The path form, not the fragment one in the address bar: only the
        // path has a page of its own carrying this session's Open Graph tags.
        shareUrl: `${window.location.origin}${import.meta.env.BASE_URL}s/${session.id}`,
        change: line ?? '',
      })
    },
    [session, slots, waitlist],
  )

  const whatsappText = useMemo(() => buildMessage(null), [buildMessage])
  const changeText = useMemo(() => buildMessage(changeLine), [buildMessage, changeLine])

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
    if (slot === undefined || slot === null || session === null) return
    const name = slot.playerName
    const released: Slot = { ...slot, playerName: null, claimedAt: null, paid: false }
    const at = {
      team: slot.team,
      teamName: session.teamNames[slot.team],
      position: slot.position,
    }
    void run(
      () => releaseSlot(slot.id),
      {
        slot: released,
        owned: [[slot.id, false]],
        revertSlot: slot,
        revertOwned: [[slot.id, true]],
      },
      () => {
        if (name === null) return
        // Offered straight away with "kosong", then corrected: the auto-fill
        // runs in the release's own transaction, but release_slot returns the
        // row from its UPDATE, which is always empty. Only a fresh read knows.
        setChange({ kind: 'release', at, playerName: name, takenBy: null })
        void getSlot(slot.id)
          .then((after) => {
            const taken = after?.playerName ?? null
            if (after === null || taken === null) return
            // The same read fixes the roster, not just the headline. The
            // promoted player would otherwise only appear when the realtime
            // event lands -- and until then the message offered for pasting
            // would show this position as empty, which is the one mistake
            // this whole prompt exists to prevent.
            applyLocal(after)
            setChange((current) =>
              current === null || current.kind !== 'release'
                ? current
                : { ...current, takenBy: taken },
            )
          })
          .catch(() => {
            // The sheet already says "kosong", which is what the roster
            // underneath will show too if the read failed for a real reason.
          })
      },
    )
  }

  /** The paid tick, unlike every other action here, leaves the sheet open:
   *  it is a toggle the player may want to correct straight away. `selected`
   *  carries its own snapshot of the slot, so it is updated alongside the
   *  list or the checkbox would not move until the sheet was reopened. */
  function onTogglePaid(paid: boolean) {
    const view = selected
    const slot = view?.slot
    if (view === null || view === undefined || slot === undefined || slot === null) return

    const withPaid = (next: Slot) => {
      applyLocal(next)
      setSelected((current) =>
        current === null || current.slot === null || current.slot.id !== next.id
          ? current
          : { ...current, slot: next },
      )
    }

    setBusy(true)
    withPaid({ ...slot, paid })
    setSlotPaid(slot.id, paid)
      .then((next) => {
        withPaid(next)
        const name = next.playerName
        if (name === null || session === null) return
        setChange({
          kind: paid ? 'paid' : 'unpaid',
          at: { team: next.team, teamName: session.teamNames[next.team], position: next.position },
          playerName: name,
        })
      })
      .catch((cause: unknown) => {
        withPaid(slot)
        show(cause instanceof SlotActionError ? cause.message : 'Gagal menanda bayaran.', 'error')
      })
      .finally(() => setBusy(false))
  }

  async function onAdminClear() {
    const slot = selected?.slot
    if (slot === undefined || slot === null) return
    setBusy(true)
    try {
      await adminClearSlot(slot.id)
      applyLocal({ ...slot, playerName: null, claimedAt: null, paid: false })
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

  /** Changing position, which is one transaction rather than a release and a
   *  claim -- see moveSlot. Both slots change at once, so this does not use
   *  `run`, which carries a single slot. */
  function onMove() {
    const to = selected?.slot
    const from = mySlot
    if (to === undefined || to === null || from === null) return

    const vacated: Slot = { ...from, playerName: null, claimedAt: null, paid: false }
    const filled: Slot = {
      ...to,
      playerName: from.playerName,
      claimedAt: new Date().toISOString(),
      // The tick travels with the player; move_slot restores it server-side.
      paid: from.paid,
    }

    setBusy(true)
    applyLocal(vacated)
    applyLocal(filled)
    setOwned(from.id, false)
    setOwned(to.id, true)
    setSelected(null)

    moveSlot(from.id, to.id)
      .then((result) => {
        applyLocal(result)
        if (from.playerName !== null && session !== null) {
          setChange({
            kind: 'move',
            playerName: from.playerName,
            at: { team: from.team, teamName: session.teamNames[from.team], position: from.position },
            to: { team: to.team, teamName: session.teamNames[to.team], position: to.position },
          })
        }
        // The slot left behind may already hold a promoted player, which
        // arrives over Realtime -- but a refetch is what makes the queue
        // panel and the pitch agree immediately.
        refetch()
      })
      .catch((cause: unknown) => {
        applyLocal(from)
        applyLocal(to)
        setOwned(from.id, true)
        setOwned(to.id, false)
        show(cause instanceof SlotActionError ? cause.message : 'Gagal menukar posisi.', 'error')
        refetch()
      })
      .finally(() => setBusy(false))
  }

  /** Organiser override, mirroring onAdminClear for the pitch: somebody who
   *  cleared their browser, or a duplicate, taken out of the queue. */
  async function onAdminRemoveFromWaitlist(waitlistId: string) {
    setBusy(true)
    try {
      await adminRemoveFromWaitlist(waitlistId)
      removeWaitlistLocal(waitlistId)
      // The organiser may be removing their own entry.
      if (myWaitlistEntry !== null && myWaitlistEntry.id === waitlistId) setMyWaitlistEntry(null)
    } catch (cause: unknown) {
      show(cause instanceof WaitlistActionError ? cause.message : 'Gagal membuang dari senarai.', 'error')
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
        // They have just told us they want a place they cannot have yet:
        // the one moment where offering to notify them is obviously useful.
        setPushOpen(true)
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
        <Link to="/" className="text-turf-lit underline">Balik ke laman utama</Link>
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
        <SessionMeta session={session} filled={filled} total={slots.length} />

        {mySlot !== null ? (
          <div className="space-y-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2">
            <p className="font-kit text-[15px]">
              {`Slot anda: Team ${mySlot.team} ${session.teamNames[mySlot.team]} — ${positionLabel(mySlot.position)}`}
            </p>
            {/* One slot per device (claim_slot raises already_in_slot), so
                the way to change position is to move, not to take a second
                one. The pitch is the picker: say where to tap. */}
            <p className="font-sans text-[13px] text-white/60">
              Nak tukar posisi? Tekan mana-mana slot kosong.
            </p>
            {/* Nothing else on the page says where the tick lives, so the
                panel that already names your slot points at it. */}
            <p className="font-sans text-[13px] text-white/60">
              {mySlot.paid
                ? '✓ Dah bayar.'
                : 'Belum bayar — tekan slot anda untuk tandakan bila dah bayar.'}
            </p>
          </div>
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
                <>
                  <p className="font-kit text-[15px] text-white">
                    {`Anda dalam senarai tunggu (${formatPositions(myWaitlistEntry.positions)}).`}
                  </p>
                  {/* Queueing is a standing preference, not a restriction:
                      claim_slot consumes this device's own queue entry, so
                      any open position can still be taken by hand -- even
                      one that was never on the list. Nothing else says so. */}
                  {open > 0 && (
                    <p className="font-sans text-[13px] text-white/60">
                      Tak perlu tunggu — anda boleh terus ambil mana-mana slot kosong, walaupun
                      posisi yang anda tak pilih.
                    </p>
                  )}
                </>
              ) : (
                <Button variant="primary" onClick={() => setWaitlistOpen(true)} className="w-full">
                  Sertai senarai tunggu
                </Button>
              )}
            </div>
          )
        )}

        {/* Its own row rather than living inside the queue panel: an iPhone
            user installs the app and comes back needing this, and somebody
            holding a slot today is in the queue next week -- the
            subscription belongs to the device, not to one booking. Hidden
            for a device with no place in the session, which is also what
            save_push_subscription refuses. */}
        {mineId !== null && (
          <div className="space-y-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            {pushOn ? (
              <p className="font-sans text-[13px] text-turf-lit">
                ✓ Notifikasi hidup untuk peranti ni.
              </p>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setPushOpen(true)} className="w-full">
                  Hidupkan notifikasi
                </Button>
                <p className="font-sans text-[12px] text-white/45">
                  Kami beritahu bila anda naik dari senarai tunggu.
                </p>
              </>
            )}
          </div>
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
        <div className={`grid gap-4 ${teams.length === 4 ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
          {teams.map((team: TeamKey) => (
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
                        size="sm"
                        disabled={busy}
                        onClick={onLeaveWaitlist}
                      >
                        Keluar dari senarai tunggu
                      </Button>
                    )}
                    {/* Organiser tools sit on one quiet line of text links,
                        matching "Lihat nombor": a queue is a list of rows, and
                        a solid button on each one would shout over the names
                        the organiser is actually reading. */}
                    {isAdmin && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <AdminContactToggle target={{ waitlistId: entry.id }} />
                        {removingFromQueue !== entry.id && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setRemovingFromQueue(entry.id)}
                            className="font-kit text-[13px] font-medium text-merah-soft underline decoration-merah-soft/40 underline-offset-4 disabled:opacity-50"
                          >
                            Buang dari senarai
                          </button>
                        )}
                      </div>
                    )}
                    {isAdmin && removingFromQueue === entry.id && (
                      <div className="rounded-lg border border-merah-soft/40 bg-merah/15 p-2">
                        <p className="mb-2 font-sans text-[13px] text-white/80">
                          {`Buang ${entry.playerName} dari senarai tunggu?`}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              setRemovingFromQueue(null)
                              void onAdminRemoveFromWaitlist(entry.id)
                            }}
                          >
                            Ya, buang
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => setRemovingFromQueue(null)}
                          >
                            Batal
                          </Button>
                        </div>
                      </div>
                    )}
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
        currentLabel={
          mySlot === null
            ? null
            : `Team ${mySlot.team} ${session.teamNames[mySlot.team]} — ${positionLabel(mySlot.position)}`
        }
        onClose={() => setSelected(null)}
        onClaim={onClaim}
        onRelease={onRelease}
        onTogglePaid={onTogglePaid}
        onMove={onMove}
        onAdminClear={() => void onAdminClear()}
        onNameChange={setPendingName}
      />

      {/* Queued behind the claim sheet rather than stacked on top of it.
          Releasing and moving close that sheet themselves, but the paid tick
          deliberately leaves it open so a mis-tap can be undone -- and a
          prompt covering the tick would take that away. Un-ticking before
          closing simply replaces the change with one that says nothing. */}
      <ShareChangeSheet
        change={selected === null ? change : null}
        message={changeText}
        onClose={() => setChange(null)}
      />

      <NotifySheet
        open={pushOpen}
        onClose={() => setPushOpen(false)}
        onSubscribed={() => setPushOn(true)}
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
