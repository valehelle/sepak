import type { Position } from '../lib/positions'
import type { Slot } from '../data/types'

export type SlotView = { slot: Slot | null; position: Position; mine: boolean }

type SlotChipProps = {
  view: SlotView
  label: string
  disabled: boolean
  onSelect: (view: SlotView) => void
}

export function SlotChip({ view, label, disabled, onSelect }: SlotChipProps) {
  const name = view.slot?.playerName ?? null
  const taken = name !== null
  // Someone else's slot is inert: only its owner or the organiser can change it.
  const inert = disabled || (taken && !view.mine)

  const accessibleName = [label, name ?? 'kosong', view.mine ? 'slot anda' : null]
    .filter((part) => part !== null)
    .join(' — ')

  return (
    <button
      type="button"
      disabled={inert}
      aria-label={accessibleName}
      onClick={() => onSelect(view)}
      className={[
        'flex min-h-14 w-full flex-col items-center justify-center rounded-xl px-1 py-2 text-center transition',
        'disabled:cursor-default',
        view.mine
          ? 'bg-amber-400 text-slate-900 ring-2 ring-amber-200'
          : taken
            ? 'bg-slate-800/90 text-slate-200'
            : 'bg-emerald-600/25 text-emerald-100 ring-1 ring-emerald-400/50 active:bg-emerald-600/40',
      ].join(' ')}
    >
      <span className="text-[10px] font-bold tracking-wide opacity-80">{label}</span>
      <span className="w-full truncate text-xs font-medium">{name ?? '+'}</span>
    </button>
  )
}
