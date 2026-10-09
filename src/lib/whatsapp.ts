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
  /** One line naming what just happened, from describeChange below. It sits
   *  right under the warning at the top, where it is seen on opening the
   *  message rather than after scrolling past the list. Optional: the plain
   *  copy has no change to announce. */
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

/** The first line of every copy. The list in the group is a copy and the
 *  site is the original, and people were still editing the copy by hand --
 *  which is how the two drift apart. First, because WhatsApp's chat list
 *  previews the first line, and because whoever goes to edit the list
 *  starts reading at the top. */
const NO_EDIT_WARNING =
  '⚠️ Jangan copy & edit mesej ni — daftar, tukar posisi & tanda bayar kat link.'

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

function headerBlock(input: WhatsAppInput): string {
  const fee = formatFees(input.feeMyr, input.feeGkMyr ?? null)
  return [
    `Sesi ${String(input.sessionNo).padStart(3, '0')} ${input.title}`,
    `📅 Tarikh : *${formatPlayDate(input.playDate)}*`,
    `🕒 Masa: ${formatStartTime(input.startTime)}`,
    `🏟️ Tempat: ${input.venue}`,
    ...(fee === null ? [] : [`💵 Yuran: ${fee}`]),
  ].join('\n')
}

/** The warning, and under it the change being announced, if any. */
function topBlock(input: WhatsAppInput): string {
  const change = input.change === undefined || input.change === '' ? [] : [input.change]
  return [NO_EDIT_WARNING, ...change].join('\n')
}

/** "GK, CB ×2, ST": one team's open positions, in pitch order, by the label
 *  people use. */
function openPositions(slots: readonly WhatsAppSlot[]): string {
  const counts = new Map<string, number>()
  for (const position of POSITIONS) {
    const open = slots.filter((slot) => slot.position === position && !slot.playerName?.trim()).length
    if (open === 0) continue
    const label = positionLabel(position)
    counts.set(label, (counts.get(label) ?? 0) + open)
  }
  return [...counts].map(([label, count]) => (count === 1 ? label : `${label} ×${count}`)).join(', ')
}

/** One line per team that still has room, so people can see where they
 *  would play: "Team Merah A — GK, CB". A team with nobody in it yet says
 *  so in two words rather than eleven. */
function openSlotLines(input: WhatsAppInput): string[] {
  return TEAM_KEYS.flatMap((team) => {
    const slots = input.slots.filter((slot) => slot.team === team)
    const open = slots.filter((slot) => !slot.playerName?.trim())
    if (open.length === 0) return []
    const label = teamLabel(input.teamNames[team])
    return [open.length === slots.length ? `${label} — semua kosong` : `${label} — ${openPositions(open)}`]
  })
}

/** What the group gets: the state of the session, not the list. A pasted
 *  list of names looked like the record and got edited by hand; this has
 *  nothing in it to edit, and sends people to the link for the real one. */
export function buildSummaryMessage(input: WhatsAppInput): string {
  const filled = input.slots.filter((slot) => slot.playerName?.trim()).length
  const total = input.slots.length
  const open = total - filled
  const paid = input.slots.filter((slot) => slot.playerName?.trim() && slot.paid === true).length
  const fee = formatFees(input.feeMyr, input.feeGkMyr ?? null)
  const queued = input.waitlist?.length ?? 0

  const status = [
    `📋 ${filled}/${total} penuh`,
    ...(open === 0 ? [] : ['🟢 Slot kosong:', ...openSlotLines(input)]),
    ...(fee !== null && filled > 0
      ? [`💵 ${paid}/${filled} dah bayar — dah transfer? Buka link, tekan "Tandakan dah bayar"`]
      : []),
    ...(queued > 0 ? [`⏳ Senarai tunggu: ${queued} orang`] : []),
  ].join('\n')

  const link = input.shareUrl === undefined || input.shareUrl === '' ? [] : [`Senarai penuh & daftar 👉 ${input.shareUrl}`]

  return [topBlock(input), headerBlock(input), status, ...link].join('\n\n')
}

/** The full list, names and ticks included. Admin-only on the page now: the
 *  group gets buildSummaryMessage. */
export function buildWhatsAppMessage(input: WhatsAppInput): string {
  const roster = rosterOf(input.slots)
  const header = headerBlock(input)

  // Only the teams the session has: an older session has three, and an
  // empty Team D block would read as eleven open places.
  const present = new Set(input.slots.map((slot) => slot.team))
  const teams = TEAM_KEYS.filter((team) => present.has(team)).map((team) =>
    teamBlock(team, input.teamNames[team], roster),
  )
  const waitlist = waitlistBlock(input.waitlist ?? [])
  const link = input.shareUrl === undefined || input.shareUrl === '' ? [] : [input.shareUrl]
  return [
    topBlock(input),
    header,
    ...teams,
    ...(waitlist === null ? [] : [waitlist]),
    ...link,
  ].join('\n\n')
}

/** For an admin chasing payment: who has a place and has not ticked paid,
 *  numbered, with where they play so two Amirs are told apart. */
export function buildUnpaidMessage(input: WhatsAppInput): string {
  const title = `Sesi ${String(input.sessionNo).padStart(3, '0')}, ${formatShortDate(input.playDate)}`
  const unpaid = TEAM_KEYS.flatMap((team) =>
    POSITIONS.flatMap((position) =>
      input.slots
        .filter((slot) => slot.team === team && slot.position === position && slot.playerName?.trim() && slot.paid !== true)
        .map((slot) => `${slot.playerName?.trim() ?? ''} (${teamLabel(input.teamNames[team])} — ${positionLabel(position)})`),
    ),
  )
  if (unpaid.length === 0) return `✅ Semua dah bayar — ${title}`

  const link = input.shareUrl === undefined || input.shareUrl === '' ? '' : ` 👉 ${input.shareUrl}`
  return [
    `💵 Belum bayar — ${title}`,
    unpaid.map((line, index) => `${index + 1}. ${line}`).join('\n'),
    `Dah transfer? Buka link, tekan "Tandakan dah bayar"${link}`,
  ].join('\n\n')
}

/** "14/10", from the session's YYYY-MM-DD. */
function formatShortDate(playDate: string): string {
  const [, month, day] = playDate.split('-')
  return month === undefined || day === undefined ? playDate : `${day}/${month}`
}
