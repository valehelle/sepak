import { POSITIONS, positionLabel } from '../lib/positions'
import { SlotChip } from './SlotChip'
import { toViews, type TeamViewProps } from './PitchTeam'

const SWATCH = { A: 'bg-merah', B: 'bg-putih', C: 'bg-kuning' } as const

export function ListTeam({
  team,
  teamName,
  slots,
  mySlotIds,
  disabled,
  adminOverride = false,
  lockEmpty = false,
  onSelect,
}: TeamViewProps) {
  const views = toViews(slots, mySlotIds)

  return (
    <section className="rounded-lg bg-night-2 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-3 w-3 rounded-sm ${SWATCH[team]}`} aria-hidden="true" />
        <h3 className="font-kit text-base font-semibold tracking-wide text-white">
          {`Team ${team} ${teamName}`}
        </h3>
      </div>
      <ul className="grid grid-cols-4 gap-x-1 gap-y-3">
        {POSITIONS.map((position) => (
          <li key={position}>
            <SlotChip
              label={positionLabel(position)}
              team={team}
              disabled={disabled}
              adminOverride={adminOverride}
              lockEmpty={lockEmpty}
              onSelect={onSelect}
              view={views.get(position) ?? { slot: null, position, mine: false }}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
