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

export const TEAM_KEYS = ['A', 'B', 'C'] as const

export type TeamKey = (typeof TEAM_KEYS)[number]

/** Two centre-backs share a display label; the keys differ so the
 *  (session, team, position) unique constraint can tell them apart. */
export function positionLabel(position: Position): string {
  return position === 'CB1' || position === 'CB2' ? 'CB' : position
}

/** Back to front, so the rendered pitch matches where players stand. */
export const PITCH_ROWS = [
  ['GK'],
  ['LB', 'CB1', 'CB2', 'RB'],
  ['DM', 'MC', 'AM'],
  ['LWF', 'RWF', 'ST'],
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
