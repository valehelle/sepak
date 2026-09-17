import type { Position, TeamKey } from '../lib/positions'
import type { Slot } from '../data/types'

export type SlotView = { slot: Slot | null; position: Position; mine: boolean }

/** Bib colours carry team identity, so the chip needs to know whose pitch it
 *  is standing on. Dark text on every bib: red at this saturation and yellow
 *  both fail white text at small sizes. */
const BIB: Record<TeamKey, string> = {
  A: 'bg-merah text-white',
  B: 'bg-putih text-night',
  C: 'bg-kuning text-night',
}

type SlotChipProps = {
  view: SlotView
  label: string
  team: TeamKey
  disabled: boolean
  adminOverride?: boolean
  /** The device already holds a slot in this session, so it cannot take
   *  another (claim_slot raises already_in_slot). Empty slots go inert
   *  rather than opening a form that can only fail. */
  lockEmpty?: boolean
  onSelect: (view: SlotView) => void
}

export function SlotChip({
  view,
  label,
  team,
  disabled,
  adminOverride = false,
  lockEmpty = false,
  onSelect,
}: SlotChipProps) {
  const name = view.slot?.playerName ?? null
  const taken = name !== null
  // Someone else's slot is inert for players; the organiser can still open it
  // to clear an orphaned or joke entry.
  const inert = disabled || (taken && !view.mine && !adminOverride) || (!taken && lockEmpty)

  const accessibleName = [label, name ?? 'kosong', view.mine ? 'slot anda' : null]
    .filter((part) => part !== null)
    .join(' — ')

  return (
    <button
      type="button"
      disabled={inert}
      aria-label={accessibleName}
      onClick={() => onSelect(view)}
      className="group flex w-full flex-col items-center gap-1 disabled:cursor-default"
    >
      <span
        className={[
          'grid h-9 w-9 place-items-center rounded-lg font-kit text-[13px] font-bold leading-none tracking-tight',
          'shadow-[0_2px_6px_rgba(0,0,0,0.45)] transition',
          taken
            ? BIB[team]
            : // An open slot is the only thing a player can act on, so it is
              // drawn to be found: bright, dashed, and the one thing on the
              // pitch that is lighter than the turf.
              'border-2 border-dashed border-white/85 bg-white/20 text-lg text-white group-active:bg-white/35',
          view.mine ? 'ring-2 ring-white ring-offset-2 ring-offset-black/40' : '',
        ].join(' ')}
      >
        {taken ? label : '+'}
      </span>

      <span className="w-full text-center font-sans text-[11px] font-medium leading-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
        {name ?? label}
      </span>
    </button>
  )
}
