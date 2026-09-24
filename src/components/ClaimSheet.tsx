import { useEffect, useState } from 'react'
import { formatPhone, normalisePhone } from '../lib/phone'
import { recallPlayer } from '../lib/playerMemory'
import { positionLabel } from '../lib/positions'
import type { SlotView } from './SlotChip'
import { AdminContact } from './AdminContact'
import { Button } from './Button'
import { inputClass } from './Input'
import { PhoneField } from './PhoneField'
import { Sheet } from './Sheet'

type ClaimSheetProps = {
  view: SlotView | null
  teamName: string
  busy: boolean
  duplicateName: boolean
  isAdmin: boolean
  /** Where this device already is, as "Team Merah A — GK", when it holds a
   *  slot in this session. Set only then, and only that changes what an
   *  empty slot offers: moving there instead of claiming it. */
  currentLabel: string | null
  onClose: () => void
  /** `phone` arrives in stored form (60123456789), already validated. */
  onClaim: (name: string, phone: string) => void
  onRelease: () => void
  onTogglePaid: (paid: boolean) => void
  onMove: () => void
  onAdminClear: () => void
  onNameChange: (name: string) => void
}

export function ClaimSheet({
  view,
  teamName,
  busy,
  duplicateName,
  isAdmin,
  currentLabel,
  onClose,
  onClaim,
  onRelease,
  onTogglePaid,
  onMove,
  onAdminClear,
  onNameChange,
}: ClaimSheetProps) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  // Emptying a slot is one tap away from a mis-tap, and the slot can be gone
  // to someone else a second later, so both destructive buttons arm first.
  const [confirming, setConfirming] = useState<'release' | 'clear' | null>(null)

  // Prefill from the device's last booking so a regular only confirms. The
  // recalled name is reported upward too, or the duplicate-name warning
  // would only ever react to typing.
  useEffect(() => {
    const remembered = recallPlayer()
    setName(remembered.name)
    setPhone(remembered.phone === '' ? '' : formatPhone(remembered.phone))
    setProblem(null)
    setConfirming(null)
    if (remembered.name !== '') onNameChange(remembered.name)
    // onNameChange is a stable setter from the page; view is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  if (view === null) return null

  const label = positionLabel(view.position)
  const title = `${teamName} — ${label}`
  const occupiedByOther = view.slot?.playerName != null && !view.mine

  if (view.mine || occupiedByOther) {
    const paid = view.slot?.paid === true
    return (
      <Sheet open title={title} onClose={onClose}>
        <p className="mb-4 font-sans text-[15px] text-white/70">
          {view.mine ? `Slot anda: ${view.slot?.playerName ?? ''}` : view.slot?.playerName ?? ''}
        </p>

        {/* The tick is a self-declaration -- the player ticks it after
            handing over the fee. Admin may tick or untick anyone's, to fix
            a mis-tap. */}
        {(view.mine || isAdmin) && view.slot !== null && (
          <div className="mb-4">
            <button
              type="button"
              aria-pressed={paid}
              disabled={busy}
              onClick={() => onTogglePaid(!paid)}
              className="flex w-full items-center gap-3 rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-left active:bg-white/10 disabled:opacity-60"
            >
              <span
                aria-hidden="true"
                className={[
                  'grid h-6 w-6 shrink-0 place-items-center rounded-md text-[13px] font-bold leading-none',
                  paid ? 'bg-turf-lit text-night' : 'border-2 border-white/35 text-transparent',
                ].join(' ')}
              >
                ✓
              </span>
              <span className="font-kit text-[15px] text-white">Dah bayar</span>
            </button>
            <p className="mt-1 font-sans text-xs text-white/45">
              Tekan selepas bayar pada admin. Untuk rekod admin je.
            </p>
          </div>
        )}

        {isAdmin && view.slot !== null && (
          <div className="mb-4 rounded-lg border border-white/10 bg-white/5 p-3">
            <AdminContact target={{ slotId: view.slot.id }} />
          </div>
        )}

        <div className="space-y-2">
          {view.mine &&
            (confirming === 'release' ? (
              <div className="space-y-2 rounded-lg border border-merah-soft/40 bg-merah/15 p-3">
                <p className="font-sans text-[13px] text-white/80">
                  Slot ini jadi kosong dan orang lain boleh ambil serta-merta.
                </p>
                <Button variant="destructive" disabled={busy} onClick={onRelease} className="w-full">
                  Ya, lepaskan slot
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setConfirming(null)}
                  className="w-full"
                >
                  Batal
                </Button>
              </div>
            ) : (
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => setConfirming('release')}
                className="w-full"
              >
                Lepaskan slot
              </Button>
            ))}

          {isAdmin &&
            (confirming === 'clear' ? (
              <div className="space-y-2 rounded-lg border border-kuning/40 bg-kuning/10 p-3">
                <p className="font-sans text-[13px] text-white/80">
                  {`Buang ${view.slot?.playerName ?? 'pemain ini'} dari posisi ini?`}
                </p>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={onAdminClear}
                  className="w-full"
                >
                  Ya, kosongkan slot
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setConfirming(null)}
                  className="w-full"
                >
                  Batal
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirming('clear')}
                className="w-full text-kuning"
              >
                Kosongkan slot (admin)
              </Button>
            ))}
        </div>
      </Sheet>
    )
  }

  // An empty slot, opened by a device that already holds one. Claiming is not
  // on the table -- one booking per person per session -- so the only thing
  // to offer is the move, and the form would fail if it were shown.
  if (currentLabel !== null) {
    return (
      <Sheet open title={title} onClose={onClose}>
        <p className="mb-1 font-sans text-[15px] text-white/70">Anda sekarang di</p>
        <p className="mb-4 font-kit text-[17px] font-semibold text-white">{currentLabel}</p>
        {/* Said before the button, not after: leaving a position hands it to
            whoever is queued for it straight away, so a move can be the last
            move somebody makes. */}
        <p className="mb-4 font-sans text-[13px] leading-relaxed text-kuning">
          Posisi lama anda jadi kosong serta-merta. Kalau ada orang dalam senarai tunggu untuk
          posisi tu, dia terus dapat — jadi anda tak boleh pindah balik.
        </p>
        <Button variant="primary" disabled={busy} onClick={onMove} className="mb-2 w-full">
          Pindah ke sini
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onClose} className="w-full">
          Batal
        </Button>
      </Sheet>
    )
  }

  function submit() {
    const trimmed = name.trim()
    if (trimmed === '') {
      setProblem('Isi nama anda dulu.')
      return
    }
    if (trimmed.length > 40) {
      setProblem('Nama terlalu panjang (maksimum 40 aksara).')
      return
    }
    if (phone.trim() === '') {
      setProblem('Isi nombor telefon anda.')
      return
    }
    const stored = normalisePhone(phone)
    if (stored === null) {
      setProblem('Nombor telefon tak sah. Contoh: 012-345 6789.')
      return
    }
    onClaim(trimmed, stored)
  }

  return (
    <Sheet open title={title} onClose={onClose}>
      <label htmlFor="player-name" className="mb-1 block font-kit text-[13px] text-white/45">Nama</label>
      <input
        id="player-name"
        value={name}
        onChange={(event) => {
          setName(event.target.value)
          setProblem(null)
          onNameChange(event.target.value)
        }}
        onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
        maxLength={40}
        autoComplete="name"
        className={`mb-3 ${inputClass}`}
      />
      <PhoneField
        id="player-phone"
        value={phone}
        onChange={(value) => {
          setPhone(value)
          setProblem(null)
        }}
        onEnter={submit}
      />
      {problem !== null && <p className="mb-2 font-sans text-xs text-merah-soft">{problem}</p>}
      {duplicateName && (
        <p className="mb-2 font-sans text-xs text-kuning">
          Nama ini dah ada dalam sesi. Teruskan jika memang anda.
        </p>
      )}
      <Button variant="primary" disabled={busy} onClick={submit} className="w-full">
        Ambil slot
      </Button>
    </Sheet>
  )
}
