import { POSITIONS, positionLabel } from '../lib/positions'
import { SlotChip } from './SlotChip'
import { bibFor } from '../lib/bibs'
import { SWATCH, toViews, type TeamViewProps } from './PitchTeam'

export function ListTeam({
  team,
  teamName,
  slots,
  mySlotIds,
  disabled,
  adminOverride = false,
  onSelect,
}: TeamViewProps) {
  const views = toViews(slots, mySlotIds)
  const bib = bibFor(team, teamName)

  return (
    <section className="rounded-lg bg-night-2 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-3 w-3 rounded-sm ${SWATCH[bib] ?? ''}`} aria-hidden="true" />
        <h3 className="font-kit text-base font-semibold tracking-wide text-white">
          {`Team ${team} ${teamName}`}
        </h3>
      </div>
      <ul className="grid grid-cols-4 gap-x-1 gap-y-3">
        {POSITIONS.map((position) => (
          <li key={position}>
            <SlotChip
              label={positionLabel(position)}
              bib={bib}
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
