import type { TeamKey } from './positions'

/** The three bib colours the game owns. Team identity is the bib, and two
 *  teams can share one: a four-team night is two in red and two in yellow. */
export type Bib = 'merah' | 'putih' | 'kuning'

/** Read off the team's name, so renaming Team B to "Merah" in the admin form
 *  is what puts Team B in red. Matches Malay and English, anywhere in the
 *  name, so "Merah 2" and "Red" work too. */
const BY_NAME: readonly (readonly [RegExp, Bib])[] = [
  [/merah|red/i, 'merah'],
  [/kuning|yellow/i, 'kuning'],
  [/putih|white/i, 'putih'],
]

/** For a name that is not a colour at all ("Harimau"): the colour each team
 *  wore before names decided it. */
const BY_TEAM: Record<TeamKey, Bib | undefined> = {
  A: 'merah',
  B: 'putih',
  C: 'kuning',
  D: 'kuning',
}

export function bibFor(team: TeamKey, teamName: string): Bib {
  return BY_NAME.find(([pattern]) => pattern.test(teamName))?.[1] ?? BY_TEAM[team] ?? 'merah'
}

/** What people read for a team: its name, never its letter. The letter is
 *  only the slot key, and on a four-team night "Team B" and "Team C" say
 *  nothing about who is in red. Names are what the admin form sets, and it
 *  keeps them distinct. */
export function teamLabel(teamName: string): string {
  return `Team ${teamName}`
}
