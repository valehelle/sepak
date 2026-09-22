import { getClaimToken } from '../lib/claimToken'
import { isPosition, type Position } from '../lib/positions'
import { supabase } from '../lib/supabase'
import { FALLBACK_ERROR_MESSAGE, RPC_MESSAGES, rpcErrorCode } from './types'

/** Columns `anon` actually holds a select grant for on `sepak.waitlist`
 *  (see migration 0007): `claim_token` is deliberately excluded, mirroring
 *  `SLOT_COLUMNS` in ../data/sessions.ts. */
export const WAITLIST_COLUMNS = 'id, session_id, player_name, positions, created_at'

/** A queue entry as anyone (including anon) may read it -- the queue is
 *  public, like the booking list itself. */
export type WaitlistEntry = {
  id: string
  sessionId: string
  playerName: string
  positions: Position[]
  createdAt: string
}

/** What `my_waitlist_entry` returns: just enough for a device to recognise
 *  its own row without ever reading `claim_token` back off the table. */
export type MyWaitlistEntry = {
  id: string
  positions: Position[]
  createdAt: string
}

export type JoinWaitlistResult =
  | { placed: true; slotId: string }
  | { placed: false; waitlistId: string }

export class WaitlistActionError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message)
    this.name = 'WaitlistActionError'
  }
}

function fail(error: unknown): never {
  const code = rpcErrorCode(error)
  throw new WaitlistActionError(code === null ? FALLBACK_ERROR_MESSAGE : RPC_MESSAGES[code], code)
}

function asRecord(row: unknown, what: string): Record<string, unknown> {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new Error(`${what}: expected an object, got ${typeof row}`)
  }
  return Object.fromEntries(Object.entries(row))
}

function str(row: Record<string, unknown>, field: string): string {
  const value = row[field]
  if (typeof value !== 'string') throw new Error(`${field}: expected a string`)
  return value
}

function parsePositions(value: unknown): Position[] {
  if (!Array.isArray(value)) throw new Error('positions: expected an array')
  return value.map((entry) => {
    if (typeof entry !== 'string' || !isPosition(entry)) {
      throw new Error(`positions: unknown value ${JSON.stringify(entry)}`)
    }
    return entry
  })
}

/** Rejects rather than casts, mirroring `parseSession`/`parseSlot` in
 *  ./types.ts -- a malformed row must never silently become a wrong-shaped
 *  object the rest of the app then trusts. */
export function parseWaitlistEntry(row: unknown): WaitlistEntry {
  const r = asRecord(row, 'waitlistEntry')
  return {
    id: str(r, 'id'),
    sessionId: str(r, 'session_id'),
    playerName: str(r, 'player_name'),
    positions: parsePositions(r['positions']),
    createdAt: str(r, 'created_at'),
  }
}

export function parseMyWaitlistEntry(row: unknown): MyWaitlistEntry {
  const r = asRecord(row, 'myWaitlistEntry')
  return {
    id: str(r, 'id'),
    positions: parsePositions(r['positions']),
    createdAt: str(r, 'created_at'),
  }
}

function parseJoinResult(data: unknown): JoinWaitlistResult {
  const r = asRecord(data, 'joinWaitlistResult')
  const placed = r['placed']
  if (placed === true) {
    return { placed: true, slotId: str(r, 'slot_id') }
  }
  if (placed === false) {
    return { placed: false, waitlistId: str(r, 'waitlist_id') }
  }
  throw new Error('joinWaitlistResult: expected a boolean placed field')
}

/** The full public queue for a session, in FIFO order -- the order
 *  auto-fill itself reads. */
export async function listWaitlist(sessionId: string): Promise<WaitlistEntry[]> {
  const { data, error } = await supabase
    .from('waitlist')
    .select(WAITLIST_COLUMNS)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
  if (error !== null) fail(error)
  return (data ?? []).map(parseWaitlistEntry)
}

/** Claims a matching free slot immediately when one exists (earliest in
 *  pitch order), otherwise queues. See join_waitlist in 0007_waitlist.sql. */
export async function joinWaitlist(
  sessionId: string,
  playerName: string,
  phone: string,
  positions: readonly Position[],
): Promise<JoinWaitlistResult> {
  const { data, error } = await supabase.rpc('join_waitlist', {
    p_session_id: sessionId,
    p_name: playerName,
    p_phone: phone,
    p_positions: [...positions],
    p_token: getClaimToken(),
  })
  if (error !== null) fail(error)
  return parseJoinResult(data)
}

export async function leaveWaitlist(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_waitlist', {
    p_session_id: sessionId,
    p_token: getClaimToken(),
  })
  if (error !== null) fail(error)
}

/** This device's own queue entry, proven by presenting the token rather
 *  than by reading it back -- mirrors `getMySlotIds` in ./slots.ts. */
export async function getMyWaitlistEntry(sessionId: string): Promise<MyWaitlistEntry | null> {
  const { data, error } = await supabase.rpc('my_waitlist_entry', {
    p_session_id: sessionId,
    p_token: getClaimToken(),
  })
  if (error !== null) fail(error)

  const rows: unknown[] = data ?? []
  const [first] = rows
  return first === undefined ? null : parseMyWaitlistEntry(first)
}

/** Organiser override: take somebody out of the queue. A player leaves by
 *  presenting their token (leaveWaitlist above); the organiser has no token,
 *  so this writes the table directly, which the waitlist_write policy allows
 *  an admin and nobody else (0007_waitlist.sql). The activity line is written
 *  by the delete trigger and attributed to 'admin' on its own. */
export async function adminRemoveFromWaitlist(waitlistId: string): Promise<void> {
  const { error } = await supabase.from('waitlist').delete().eq('id', waitlistId)
  if (error !== null) fail(error)
}
