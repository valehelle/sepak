import { useEffect, useState } from 'react'
import { ALL_POSITIONS, ALL_POSITIONS_EXCEPT_GK, POSITIONS, formatPositions, positionLabel, type Position } from '../lib/positions'
import { Sheet } from './Sheet'

type WaitlistSheetProps = {
  open: boolean
  busy: boolean
  onClose: () => void
  onJoin: (name: string, positions: Position[]) => void
}

export function WaitlistSheet({ open, busy, onClose, onJoin }: WaitlistSheetProps) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Position[]>([])
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setSelected([])
    setProblem(null)
  }, [open])

  if (!open) return null

  function toggle(position: Position) {
    setSelected((current) =>
      current.includes(position) ? current.filter((p) => p !== position) : [...current, position],
    )
    setProblem(null)
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
    if (selected.length === 0) {
      setProblem('Pilih sekurang-kurangnya satu posisi.')
      return
    }
    onJoin(trimmed, selected)
  }

  return (
    <Sheet open={open} title="Sertai senarai tunggu" onClose={onClose}>
      <label htmlFor="waitlist-name" className="mb-1 block font-kit text-[13px] text-white/60">
        Nama
      </label>
      <input
        id="waitlist-name"
        value={name}
        onChange={(event) => {
          setName(event.target.value)
          setProblem(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit()
        }}
        maxLength={40}
        autoComplete="name"
        className="mb-3 w-full rounded-lg border border-white/10 bg-night-2 px-4 py-3 font-sans text-base text-white outline-none focus:ring-2 focus:ring-turf-lit"
      />

      <p className="mb-2 font-kit text-[13px] text-white/60">Posisi</p>
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => {
            setSelected([...ALL_POSITIONS])
            setProblem(null)
          }}
          className="flex-1 rounded-lg border border-white/10 bg-night-2 px-3 py-2 font-kit text-[13px] font-semibold text-white active:bg-white/10"
        >
          Semua posisi
        </button>
        <button
          type="button"
          onClick={() => {
            setSelected([...ALL_POSITIONS_EXCEPT_GK])
            setProblem(null)
          }}
          className="flex-1 rounded-lg border border-white/10 bg-night-2 px-3 py-2 font-kit text-[13px] font-semibold text-white active:bg-white/10"
        >
          Semua kecuali GK
        </button>
      </div>

      <div className="mb-3 grid grid-cols-4 gap-2">
        {POSITIONS.map((position) => {
          const on = selected.includes(position)
          return (
            <button
              key={position}
              type="button"
              onClick={() => toggle(position)}
              aria-pressed={on}
              className={[
                'rounded-lg border px-2 py-2 font-kit text-[13px] font-bold transition',
                on ? 'border-turf-lit bg-turf-lit/25 text-white' : 'border-white/10 bg-night-2 text-white/70 active:bg-white/10',
              ].join(' ')}
            >
              {positionLabel(position)}
            </button>
          )
        })}
      </div>

      {selected.length > 0 && (
        <p className="mb-3 font-sans text-[13px] text-white/60">{formatPositions(selected)}</p>
      )}

      {problem !== null && <p className="mb-2 font-sans text-xs text-merah">{problem}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="w-full rounded-lg bg-turf-lit px-4 py-3 font-kit text-[15px] font-bold text-white active:opacity-80 disabled:opacity-60"
      >
        Sertai
      </button>
    </Sheet>
  )
}
