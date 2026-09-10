import { POSITIONS, positionLabel } from '../lib/positions'
import { SlotChip } from './SlotChip'
import { toViews, type TeamViewProps } from './PitchTeam'

export function ListTeam({ team, teamName, slots, mySlotIds, disabled, adminOverride = false, onSelect }: TeamViewProps) {
  const views = toViews(slots, mySlotIds)

  return (
    <section className="rounded-3xl bg-slate-900/70 p-3">
      <h3 className="mb-3 text-sm font-bold tracking-wide text-slate-200">
        {`Team ${team} ${teamName}`}
      </h3>
      <ul className="space-y-1.5">
        {POSITIONS.map((position) => (
          <li key={position}>
            <SlotChip
              label={positionLabel(position)}
              disabled={disabled}
              adminOverride={adminOverride}
              onSelect={onSelect}
              view={views.get(position) ?? { slot: null, position, mine: false }}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
