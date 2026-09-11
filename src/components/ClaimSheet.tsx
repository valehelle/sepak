import { useEffect, useState } from 'react'
import { positionLabel } from '../lib/positions'
import type { SlotView } from './SlotChip'
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
        <p className="mb-4 text-sm text-slate-300">
          {view.mine ? `Slot anda: ${view.slot?.playerName ?? ''}` : view.slot?.playerName ?? ''}
        </p>
        <div className="space-y-2">
          {view.mine && (
            <button
              type="button"
              disabled={busy}
              onClick={onRelease}
              className="w-full rounded-2xl bg-red-500/90 px-4 py-3 text-sm font-semibold text-white active:bg-red-500"
            >
              Lepaskan slot
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              disabled={busy}
              onClick={onAdminClear}
              className="w-full rounded-2xl bg-amber-500/20 px-4 py-3 text-sm font-semibold text-amber-200"
            >
              Kosongkan slot (admin)
            </button>
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
      <label htmlFor="player-name" className="mb-1 block text-sm text-slate-300">Nama</label>
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
        className="mb-2 w-full rounded-2xl bg-slate-800 px-4 py-3 text-base outline-none ring-emerald-400 focus:ring-2"
      />
      {problem !== null && <p className="mb-2 text-xs text-red-400">{problem}</p>}
      {duplicateName && (
        <p className="mb-2 text-xs text-amber-300">
          Nama ini dah ada dalam sesi. Teruskan jika memang anda.
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950 active:bg-emerald-400 disabled:opacity-60"
      >
        Ambil slot
      </button>
    </Sheet>
  )
}
