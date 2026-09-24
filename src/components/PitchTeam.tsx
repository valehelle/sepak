import { bibFor, teamLabel, type Bib } from '../lib/bibs'
import { PITCH_ROWS, positionLabel, type Position, type TeamKey } from '../lib/positions'
import type { Slot } from '../data/types'
import { SlotChip, type SlotView } from './SlotChip'

export type TeamViewProps = {
  team: TeamKey
  teamName: string
  slots: readonly Slot[]
  mySlotIds: ReadonlySet<string>
  disabled: boolean
  adminOverride?: boolean
  /** True once this device holds a slot in the session — see SlotChip. */
  onSelect: (view: SlotView) => void
}

/** The swatch beside the team name, so the heading and the bibs on the pitch
 *  below it are obviously the same team. */
export const SWATCH: Record<Bib, string | undefined> = {
  merah: 'bg-merah',
  putih: 'bg-putih',
  kuning: 'bg-kuning',
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

export function PitchTeam({
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
  const filled = slots.filter((slot) => slot.playerName !== null).length

  return (
    <section>
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className={`h-3 w-3 rounded-sm ${SWATCH[bib] ?? ''}`} aria-hidden="true" />
        <h3 className="font-kit text-base font-semibold tracking-wide text-white">
          {teamLabel(teamName)}
        </h3>
        <span className="ml-auto font-kit text-sm text-white/45">{`${filled}/11`}</span>
      </div>

      {/* Half a pitch, goal at the top. A 4-3-3 laid over it puts the keeper in
          the six-yard box and the front three on the halfway line. */}
      <div className="turf relative overflow-hidden rounded-lg px-3 pb-4 pt-4 shadow-[0_6px_20px_rgba(0,0,0,0.5)]">
        {/* Penalty box, six-yard box, goal, centre circle, halfway line. */}
        <div className="mark mark-box h-[34%] w-[80%]" aria-hidden="true" />
        <div className="mark mark-box h-[15%] w-[46%]" aria-hidden="true" />
        <div className="mark mark-goal" aria-hidden="true" />
        <div className="mark mark-circle" aria-hidden="true" />
        <div className="mark mark-halfway" aria-hidden="true" />

        <div className="relative space-y-3.5">
          {PITCH_ROWS.map((row, index) => (
            <div
              key={index}
              className="mx-auto grid gap-1"
              style={{
                gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`,
                // A lone player is central — the keeper in his goal, and AM
                // as the No. 10. The back four spread the full width; the
                // pivot and the front three sit inside them.
                maxWidth: row.length === 1 ? '32%' : row.length === 2 ? '58%' : row.length === 3 ? '84%' : '100%',
              }}
            >
              {row.map((position) => (
                <SlotChip
                  key={position}
                  label={positionLabel(position)}
                  bib={bib}
                  disabled={disabled}
                  adminOverride={adminOverride}
                  onSelect={onSelect}
                  view={views.get(position) ?? { slot: null, position, mine: false }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
