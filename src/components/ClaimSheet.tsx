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
  onClose: () => void
  /** `phone` arrives in stored form (60123456789), already validated. */
  onClaim: (name: string, phone: string) => void
  onRelease: () => void
  onAdminClear: () => void
  onNameChange: (name: string) => void
}

export function ClaimSheet({
  view,
  teamName,
  busy,
  duplicateName,
  isAdmin,
  onClose,
  onClaim,
  onRelease,
  onAdminClear,
  onNameChange,
}: ClaimSheetProps) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  // Prefill from the device's last booking so a regular only confirms. The
  // recalled name is reported upward too, or the duplicate-name warning
  // would only ever react to typing.
  useEffect(() => {
    const remembered = recallPlayer()
    setName(remembered.name)
    setPhone(remembered.phone === '' ? '' : formatPhone(remembered.phone))
    setProblem(null)
    if (remembered.name !== '') onNameChange(remembered.name)
    // onNameChange is a stable setter from the page; view is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  if (view === null) return null

  const label = positionLabel(view.position)
  const title = `${teamName} — ${label}`
  const occupiedByOther = view.slot?.playerName != null && !view.mine

  if (view.mine || occupiedByOther) {
    return (
      <Sheet open title={title} onClose={onClose}>
        <p className="mb-4 font-sans text-[15px] text-white/70">
          {view.mine ? `Slot anda: ${view.slot?.playerName ?? ''}` : view.slot?.playerName ?? ''}
        </p>
        {isAdmin && view.slot !== null && (
          <div className="mb-4 rounded-lg border border-white/10 bg-white/5 p-3">
            <AdminContact target={{ slotId: view.slot.id }} />
          </div>
        )}
        <div className="space-y-2">
          {view.mine && (
            <Button variant="destructive" disabled={busy} onClick={onRelease} className="w-full">
              Lepaskan slot
            </Button>
          )}
          {isAdmin && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={onAdminClear}
              className="w-full text-kuning"
            >
              Kosongkan slot (admin)
            </Button>
          )}
        </div>
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
