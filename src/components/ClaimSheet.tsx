import { useEffect, useState } from 'react'
import { positionLabel } from '../lib/positions'
import type { SlotView } from './SlotChip'
import { Button } from './Button'
import { inputClass } from './Input'
import { Sheet } from './Sheet'

type ClaimSheetProps = {
  view: SlotView | null
  teamName: string
  busy: boolean
  duplicateName: boolean
  isAdmin: boolean
  onClose: () => void
  onClaim: (name: string) => void
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
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    setName('')
    setProblem(null)
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
    onClaim(trimmed)
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
        className={`mb-2 ${inputClass}`}
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
