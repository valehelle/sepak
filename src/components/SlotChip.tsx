import type { Bib } from '../lib/bibs'
import type { Position } from '../lib/positions'
import type { Slot } from '../data/types'

export type SlotView = { slot: Slot | null; position: Position; mine: boolean }

/** Bib colours carry team identity, so the chip needs to know which bib its
 *  team is wearing. White text on red; dark text on white and on yellow,
 *  where white fails at small sizes. */
const BIB_CLASS: Record<Bib, string | undefined> = {
  merah: 'bg-merah text-white',
  putih: 'bg-putih text-night',
  kuning: 'bg-kuning text-night',
}

type SlotChipProps = {
  view: SlotView
  label: string
  bib: Bib
  disabled: boolean
  /** Not bookable at all right now (not open yet, or closed), as opposed to
   *  briefly disabled while an action is in flight: only this dims it. */
  locked?: boolean
  adminOverride?: boolean
  onSelect: (view: SlotView) => void
}

export function SlotChip({
  view,
  label,
  bib,
  disabled,
  locked = false,
  adminOverride = false,
  onSelect,
}: SlotChipProps) {
  const name = view.slot?.playerName ?? null
  const taken = name !== null
  // Someone else's slot is inert for players; the organiser can still open it
  // to clear an orphaned or joke entry. An empty slot is always live: a device
  // that already holds one opens it to move there (see move_slot), which is
  // why there is no longer a lock for that case.
  const inert = disabled || (taken && !view.mine && !adminOverride)

  const paid = view.slot?.paid === true

  const accessibleName = [label, name ?? 'kosong', paid ? 'dah bayar' : null, view.mine ? 'slot anda' : null]
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
          'relative grid h-9 w-9 place-items-center rounded-lg font-kit text-[13px] font-bold leading-none tracking-tight',
          'shadow-[0_2px_6px_rgba(0,0,0,0.45)] transition',
          taken
            ? (BIB_CLASS[bib] ?? '')
            : // An open slot is the only thing a player can act on, so it is
              // drawn to be found: bright, dashed, and the one thing on the
              // pitch that is lighter than the turf.
              // Unless it is locked (not open yet, or closed): then it must
              // not look like the thing to tap.
              locked
                ? 'border-2 border-dashed border-white/30 bg-white/5 text-lg text-white/40'
                : 'border-2 border-dashed border-white/85 bg-white/20 text-lg text-white group-active:bg-white/35',
          view.mine ? 'ring-2 ring-white ring-offset-2 ring-offset-black/40' : '',
        ].join(' ')}
      >
        {taken ? label : '+'}
        {/* The paid tick rides the bib rather than the name line: the name
            is already the widest thing on a 390px pitch, and the badge has
            to read at a glance from across three pitches. */}
        {paid && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-turf-lit text-[10px] font-bold leading-none text-night shadow-[0_1px_3px_rgba(0,0,0,0.6)]"
          >
            ✓
          </span>
        )}
      </span>

      <span className="w-full text-center font-sans text-[11px] font-medium leading-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
        {name ?? label}
      </span>
    </button>
  )
}
