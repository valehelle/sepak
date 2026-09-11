import { formatFee, formatPlayDate, formatStartTime } from './format'
import { POSITIONS, TEAM_KEYS, formatPositions, positionLabel, type Position, type TeamKey } from './positions'

export type WhatsAppSlot = {
  team: TeamKey
  position: Position
  playerName: string | null
}

export type WhatsAppWaitlistEntry = {
  playerName: string
  positions: readonly Position[]
}

export type WhatsAppInput = {
  sessionNo: number
  title: string
  playDate: string
  startTime: string
  venue: string
  feeMyr: number | null
  teamNames: Record<TeamKey, string>
  slots: readonly WhatsAppSlot[]
  // Optional and defaulting to empty so every existing call site -- and the
  // message for a session with no queue -- stays byte-identical.
  waitlist?: readonly WhatsAppWaitlistEntry[]
}

type Roster = Map<string, string | null>

const key = (team: TeamKey, position: Position): string => `${team}:${position}`

function rosterOf(slots: readonly WhatsAppSlot[]): Roster {
  const roster: Roster = new Map()
  for (const slot of slots) {
    roster.set(key(slot.team, slot.position), slot.playerName?.trim() ?? null)
  }
  return roster
}

function teamBlock(team: TeamKey, teamName: string, roster: Roster): string {
  const lines = POSITIONS.map((position) => {
    const name = roster.get(key(team, position))
    const label = positionLabel(position)
    return name ? `${label}- ${name}` : `${label}-`
  })
  return [`Team ${team} ${teamName}`, ...lines].join('\n')
}

/** Appended only when the queue is non-empty -- omitted entirely otherwise,
 *  so the message for a session with no waitlist is unchanged. */
function waitlistBlock(waitlist: readonly WhatsAppWaitlistEntry[]): string | null {
  if (waitlist.length === 0) return null
  const lines = waitlist.map(
    (entry, index) => `${index + 1}. ${entry.playerName} (${formatPositions(entry.positions)})`,
  )
  return ['Senarai Tunggu', ...lines].join('\n')
}

/** Regenerates the organiser's existing WhatsApp message so the site
 *  complements the group rather than competing with it. */
export function buildWhatsAppMessage(input: WhatsAppInput): string {
  const roster = rosterOf(input.slots)
  const fee = formatFee(input.feeMyr)

  const header = [
    `Sesi ${String(input.sessionNo).padStart(3, '0')} ${input.title}`,
    `📅 Tarikh : *${formatPlayDate(input.playDate)}*`,
    `🕒 Masa: ${formatStartTime(input.startTime)}`,
    `🏟️ Tempat: ${input.venue}`,
    ...(fee === null ? [] : [`💵 Yuran: ${fee}`]),
  ].join('\n')

  const teams = TEAM_KEYS.map((team) => teamBlock(team, input.teamNames[team], roster))
  const waitlist = waitlistBlock(input.waitlist ?? [])

  return [header, ...teams, ...(waitlist === null ? [] : [waitlist])].join('\n\n')
}
