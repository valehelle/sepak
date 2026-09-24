import { teamLabel } from './bibs'
import { formatFees, formatPlayDate, formatStartTime } from './format'
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
  /** Optional, so a caller with one price produces the message unchanged. */
  feeGkMyr?: number | null
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
  /** One line naming what just happened, from describeChange below. It leads
   *  the message rather than trailing it: WhatsApp's chat list previews the
   *  first line, so a change announced anywhere else is invisible until
   *  somebody opens a message that looks like every other paste. Optional,
   *  so the organiser's plain copy is unchanged. */
  change?: string
}

/** Where a change happened, as the message says it. */
export type ChangeAt = { team: TeamKey; teamName: string; position: Position }

/** What one person just did, in the terms the group cares about. Not the
 *  activity log: that records everything, and this is deliberately only the
 *  action being announced. */
export type RosterChange =
  | { kind: 'release'; at: ChangeAt; playerName: string; takenBy: string | null }
  | { kind: 'move'; at: ChangeAt; to: ChangeAt; playerName: string }
  | { kind: 'paid'; at: ChangeAt; playerName: string }
  | { kind: 'unpaid'; at: ChangeAt; playerName: string }

const where = (at: ChangeAt): string => `${teamLabel(at.teamName)} — ${positionLabel(at.position)}`
const bare = (at: ChangeAt): string => `${teamLabel(at.teamName)} ${positionLabel(at.position)}`

/** The one line, or null when there is nothing worth telling the group.
 *
 *  A plain arrow rather than an emoji one: WhatsApp draws ➡️ at emoji size,
 *  which makes the line look like a button. */
export function describeChange(change: RosterChange): string | null {
  switch (change.kind) {
    case 'release':
      return change.takenBy === null
        ? `🔴 ${where(change.at)}: ${change.playerName} → kosong`
        : `🔄 ${where(change.at)}: ${change.playerName} → ${change.takenBy} (naik dari senarai tunggu)`
    case 'move':
      return `🔄 ${change.playerName}: ${bare(change.at)} → ${bare(change.to)}`
    case 'paid':
      return `✅ ${where(change.at)}: ${change.playerName} dah bayar`
    // Taking a tick back is a correction to the organiser's own bookkeeping.
    // Nobody needs a message saying somebody un-paid.
    case 'unpaid':
      return null
  }
}

type RosterEntry = { name: string | null; paid: boolean }
type Roster = Map<string, RosterEntry>

const key = (team: TeamKey, position: Position): string => `${team}:${position}`

/** The tick the organiser reads down the right-hand edge of the list. An
 *  emoji rather than a bare ✓: WhatsApp renders it at name height on both
 *  phones and desktop, and it survives being pasted anywhere else. */
const PAID_MARK = '✅'

/** Sent with every announced change, because the list in the group is a
 *  copy and the site is the original -- somebody editing the copy by hand
 *  is how the two drift apart. */
const NO_EDIT_WARNING =
  '⚠️ Jangan edit senarai ni terus — update kat website, lepas tu copy senarai baru.'

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
  return [teamLabel(teamName), ...lines].join('\n')
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
  const fee = formatFees(input.feeMyr, input.feeGkMyr ?? null)

  const header = [
    `Sesi ${String(input.sessionNo).padStart(3, '0')} ${input.title}`,
    `📅 Tarikh : *${formatPlayDate(input.playDate)}*`,
    `🕒 Masa: ${formatStartTime(input.startTime)}`,
    `🏟️ Tempat: ${input.venue}`,
    ...(fee === null ? [] : [`💵 Yuran: ${fee}`]),
  ].join('\n')

  // Only the teams the session has: an older session has three, and an
  // empty Team D block would read as eleven open places.
  const present = new Set(input.slots.map((slot) => slot.team))
  const teams = TEAM_KEYS.filter((team) => present.has(team)).map((team) =>
    teamBlock(team, input.teamNames[team], roster),
  )
  const waitlist = waitlistBlock(input.waitlist ?? [])
  const link = input.shareUrl === undefined || input.shareUrl === '' ? [] : [input.shareUrl]
  // The warning rides with the change, not with every copy: the organiser
  // pasting a fresh list has not been told off, and telling the group every
  // time would wear out fast.
  const announced = input.change === undefined || input.change === ''
  const lead = announced ? [] : [input.change]
  const warning = announced ? [] : [NO_EDIT_WARNING]

  return [
    ...lead,
    header,
    ...teams,
    ...(waitlist === null ? [] : [waitlist]),
    ...warning,
    ...link,
  ].join('\n\n')
}
