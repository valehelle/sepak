export const POSITIONS = [
  'GK',
  'LB',
  'CB1',
  'CB2',
  'RB',
  'DM',
  'MC',
  'AM',
  'LWF',
  'RWF',
  'ST',
] as const

export type Position = (typeof POSITIONS)[number]

export const TEAM_KEYS = ['A', 'B', 'C', 'D'] as const

export type TeamKey = (typeof TEAM_KEYS)[number]

/** Two centre-backs share a display label; the keys differ so the
 *  (session, team, position) unique constraint can tell them apart. */
export function positionLabel(position: Position): string {
  return position === 'CB1' || position === 'CB2' ? 'CB' : position
}

/** Back to front, so the rendered pitch matches where players stand. */
/** A 4-2-1-3, in screen order top to bottom: the team attacks upwards with
 *  their own goal at the bottom, which is how every lineup graphic is drawn
 *  and what puts the left-back on the left.
 *
 *  The front three are LWF-ST-RWF — the striker is central, between the
 *  wingers. DM and MC are the double pivot, side by side in front of the back
 *  four, with AM the lone playmaker ahead of them. */
export const PITCH_ROWS = [
  ['LWF', 'ST', 'RWF'],
  ['AM'],
  ['DM', 'MC'],
  ['LB', 'CB1', 'CB2', 'RB'],
  ['GK'],
] as const satisfies readonly (readonly Position[])[]

export function isPosition(value: string): value is Position {
  // Widening cast: `includes` requires matching element types, but the
  // input is an arbitrary string being checked against the literal union.
  return (POSITIONS as readonly string[]).includes(value)
}

export function isTeamKey(value: string): value is TeamKey {
  // Same widening as isPosition, for the same reason.
  return (TEAM_KEYS as readonly string[]).includes(value)
}

/** The waitlist sheet's two one-tap presets. The database only ever stores
 *  the expanded set (see 0007_waitlist.sql) -- these exist purely to fill
 *  the tappable grid in, not as a stored concept. */
export const ALL_POSITIONS: readonly Position[] = POSITIONS
export const ALL_POSITIONS_EXCEPT_GK: readonly Position[] = POSITIONS.filter((position) => position !== 'GK')

/** Canonical pitch order, de-duplicating along the way: the eleven-element
 *  POSITIONS array visited once each, keeping only the ones present. */
function inPitchOrder(positions: readonly Position[]): Position[] {
  const set = new Set(positions)
  return POSITIONS.filter((position) => set.has(position))
}

function sameSet(a: readonly Position[], b: readonly Position[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((position) => set.has(position))
}

/** The queue list and WhatsApp text both need a one-line summary of a
 *  waitlist entry's acceptable positions: the two presets collapse to their
 *  name, anything else is a plain comma list in pitch order. */
export function formatPositions(positions: readonly Position[]): string {
  const ordered = inPitchOrder(positions)
  if (sameSet(ordered, ALL_POSITIONS)) return 'Semua'
  if (sameSet(ordered, ALL_POSITIONS_EXCEPT_GK)) return 'Semua kecuali GK'
  return ordered.map(positionLabel).join(', ')
}
