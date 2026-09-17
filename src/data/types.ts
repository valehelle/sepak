import { isPosition, isTeamKey, type Position, type TeamKey } from '../lib/positions'

export type SessionStatus = 'open' | 'closed'

export type Session = {
  id: string
  sessionNo: number
  title: string
  playDate: string
  startTime: string
  durationMins: number
  venue: string
  feeMyr: number | null
  teamNames: Record<TeamKey, string>
  status: SessionStatus
  createdAt: string
}

// claim_token is intentionally absent: anon's column-level grant on
// `slots` no longer includes it (a Task 5 security fix — anon reading
// another player's token would let them release or move that slot), and
// ownership is now proven server-side via the `my_slot_ids` RPC instead of
// comparing tokens client-side.
export type Slot = {
  id: string
  sessionId: string
  team: TeamKey
  position: Position
  playerName: string | null
  claimedAt: string | null
  /** Player-declared: the fee reached the organiser. Bookkeeping only —
   *  nothing in the app is gated on it (0011_paid.sql). */
  paid: boolean
}

export type SessionWithSlots = { session: Session; slots: Slot[] }

function asRecord(row: unknown, what: string): Record<string, unknown> {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new Error(`${what}: expected an object, got ${typeof row}`)
  }
  // Object.entries loses nothing and gives an index-signature type without a cast.
  return Object.fromEntries(Object.entries(row))
}

function str(row: Record<string, unknown>, field: string): string {
  const value = row[field]
  if (typeof value !== 'string') throw new Error(`${field}: expected a string`)
  return value
}

function nullableStr(row: Record<string, unknown>, field: string): string | null {
  const value = row[field]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`${field}: expected a string or null`)
  return value
}

function bool(row: Record<string, unknown>, field: string): boolean {
  const value = row[field]
  if (typeof value !== 'boolean') throw new Error(`${field}: expected a boolean`)
  return value
}

function int(row: Record<string, unknown>, field: string): number {
  const value = row[field]
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new Error(`${field}: expected a number`)
  }
  return parsed
}

/** Postgres `numeric` arrives over the wire as a string, so the fee is parsed
 *  rather than assumed, and a genuine null stays null (free) instead of
 *  collapsing to 0. */
function nullableNumeric(row: Record<string, unknown>, field: string): number | null {
  const value = row[field]
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new Error(`${field}: expected a numeric or null`)
  }
  return parsed
}

function isSessionStatus(value: string): value is SessionStatus {
  return value === 'open' || value === 'closed'
}

export function parseSession(row: unknown): Session {
  const r = asRecord(row, 'session')
  const status = str(r, 'status')
  if (!isSessionStatus(status)) throw new Error(`status: unknown value ${status}`)

  return {
    id: str(r, 'id'),
    sessionNo: int(r, 'session_no'),
    title: str(r, 'title'),
    playDate: str(r, 'play_date'),
    startTime: str(r, 'start_time'),
    durationMins: int(r, 'duration_mins'),
    venue: str(r, 'venue'),
    feeMyr: nullableNumeric(r, 'fee_myr'),
    teamNames: {
      A: str(r, 'team_a_name'),
      B: str(r, 'team_b_name'),
      C: str(r, 'team_c_name'),
    },
    status,
    createdAt: str(r, 'created_at'),
  }
}

export function parseSlot(row: unknown): Slot {
  const r = asRecord(row, 'slot')
  const team = str(r, 'team')
  if (!isTeamKey(team)) throw new Error(`team: unknown value ${team}`)
  const position = str(r, 'position')
  if (!isPosition(position)) throw new Error(`position: unknown value ${position}`)

  return {
    id: str(r, 'id'),
    sessionId: str(r, 'session_id'),
    team,
    position,
    playerName: nullableStr(r, 'player_name'),
    claimedAt: nullableStr(r, 'claimed_at'),
    paid: bool(r, 'paid'),
  }
}

export const RPC_ERROR_CODES = [
  'slot_taken',
  'session_closed',
  'invalid_name',
  'invalid_token',
  'wrong_token',
  'slot_empty',
  'slot_not_found',
  // Waitlist (0007_waitlist.sql): invalid_name, session_closed and
  // invalid_token are shared with the slot RPCs above.
  'invalid_positions',
  'already_in_slot',
  'already_waitlisted',
  'not_waitlisted',
  // Contacts (0009_contacts.sql): invalid_phone is shared by claim_slot and
  // join_waitlist; not_admin comes from contact_phone.
  'invalid_phone',
  'not_admin',
  // One booking per person (0010_one_booking_per_person.sql).
  'phone_in_use',
  // Payment tick (0011_paid.sql).
  'invalid_paid',
] as const

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number]

/** Supabase wraps a raised postgres exception in its own message text, so the
 *  code is matched inside the string rather than compared to it. */
export function rpcErrorCode(error: unknown): RpcErrorCode | null {
  if (typeof error !== 'object' || error === null) return null
  const message = Object.entries(error).find(([k]) => k === 'message')?.[1]
  if (typeof message !== 'string') return null
  return RPC_ERROR_CODES.find((code) => message.includes(code)) ?? null
}

export const RPC_MESSAGES: Record<RpcErrorCode, string> = {
  slot_taken: 'Slot dah diambil.',
  session_closed: 'Sesi dah ditutup.',
  invalid_name: 'Nama tak sah. Isi 1 hingga 40 aksara.',
  invalid_token: 'Peranti tak dikenali. Muat semula halaman.',
  wrong_token: 'Slot ini bukan milik anda.',
  slot_empty: 'Slot ini kosong.',
  slot_not_found: 'Slot tak dijumpai.',
  invalid_positions: 'Pilih sekurang-kurangnya satu posisi.',
  already_in_slot: 'Anda dah ada slot dalam sesi ini.',
  already_waitlisted: 'Anda dah dalam senarai tunggu.',
  not_waitlisted: 'Anda tak dalam senarai tunggu.',
  invalid_phone: 'Nombor telefon tak sah. Guna nombor mobile Malaysia, cth. 012-345 6789.',
  not_admin: 'Hanya admin boleh lihat nombor telefon.',
  phone_in_use: 'Nombor ini dah daftar untuk sesi ini. Satu tempat untuk satu orang.',
  invalid_paid: 'Status bayaran tak sah.',
}

export const FALLBACK_ERROR_MESSAGE = 'Ada masalah. Cuba lagi.'
