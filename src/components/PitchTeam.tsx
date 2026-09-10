import { PITCH_ROWS, positionLabel, type Position, type TeamKey } from '../lib/positions'
import type { Slot } from '../data/types'
import { SlotChip, type SlotView } from './SlotChip'

export type TeamViewProps = {
  team: TeamKey
  teamName: string
  slots: readonly Slot[]
  mySlotIds: ReadonlySet<string>
  disabled: boolean
  onSelect: (view: SlotView) => void
}

export function toViews(
  slots: readonly Slot[],
  mySlotIds: ReadonlySet<string>,
): Map<Position, SlotView> {
  const views = new Map<Position, SlotView>()
  for (const slot of slots) {
    views.set(slot.position, {
      slot,
      position: slot.position,
      mine: mySlotIds.has(slot.id),
    })
  }
  return views
}

export function PitchTeam({ team, teamName, slots, mySlotIds, disabled, onSelect }: TeamViewProps) {
  const views = toViews(slots, mySlotIds)

  return (
    <section className="rounded-3xl bg-pitch p-3 shadow-inner">
      <h3 className="mb-3 text-center text-sm font-bold tracking-wide text-white/90">
        {`Team ${team} ${teamName}`}
      </h3>

      <div className="space-y-2 rounded-2xl border border-pitch-line/40 bg-black/10 p-2">
        {PITCH_ROWS.map((row, index) => (
          <div
            key={index}
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
          >
            {row.map((position) => (
              <SlotChip
                key={position}
                label={positionLabel(position)}
                disabled={disabled}
                onSelect={onSelect}
                view={views.get(position) ?? { slot: null, position, mine: false }}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
