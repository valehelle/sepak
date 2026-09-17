import { formatFee, formatPlayDate, formatStartTime } from './format'
import { POSITIONS, TEAM_KEYS, formatPositions, positionLabel, type Position, type TeamKey } from './positions'

export type WhatsAppSlot = {
  team: TeamKey
  position: Position
  playerName: string | null
  /** Optional and defaulting to false, so a caller that does not track
   *  payment still produces the message unchanged. */
  paid?: boolean
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
  /** The session's own path URL. This is the link the group should get:
   *  it is a real page carrying that session's date and venue in its Open
   *  Graph tags (scripts/sessionPages.mjs), so the chat renders a card for
   *  this fixture rather than the site-wide one. Optional, so a caller
   *  without an origin still produces the message unchanged. */
  shareUrl?: string
}

type RosterEntry = { name: string | null; paid: boolean }
type Roster = Map<string, RosterEntry>

const key = (team: TeamKey, position: Position): string => `${team}:${position}`

/** The tick the organiser reads down the right-hand edge of the list. An
 *  emoji rather than a bare ✓: WhatsApp renders it at name height on both
 *  phones and desktop, and it survives being pasted anywhere else. */
const PAID_MARK = '✅'

function rosterOf(slots: readonly WhatsAppSlot[]): Roster {
  const roster: Roster = new Map()
  for (const slot of slots) {
    roster.set(key(slot.team, slot.position), {
      name: slot.playerName?.trim() ?? null,
      paid: slot.paid === true,
    })
  }
  return roster
}

function teamBlock(team: TeamKey, teamName: string, roster: Roster): string {
  const lines = POSITIONS.map((position) => {
    const entry = roster.get(key(team, position))
    const name = entry?.name
    const label = positionLabel(position)
    if (!name) return `${label}-`
    return entry?.paid === true ? `${label}- ${name} ${PAID_MARK}` : `${label}- ${name}`
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
  const link = input.shareUrl === undefined || input.shareUrl === '' ? [] : [input.shareUrl]

  return [header, ...teams, ...(waitlist === null ? [] : [waitlist]), ...link].join('\n\n')
}
