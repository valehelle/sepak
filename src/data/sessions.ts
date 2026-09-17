import { supabase } from '../lib/supabase'
import { parseSession, parseSlot, type Session, type SessionStatus, type SessionWithSlots } from './types'

export type NewSessionInput = {
  sessionNo: number
  title: string
  playDate: string
  startTime: string
  durationMins: number
  venue: string
  feeMyr: number | null
  teamAName: string
  teamBName: string
  teamCName: string
}

export type SessionPatch = Partial<Omit<NewSessionInput, 'sessionNo'>> & { sessionNo?: number }

/** Columns `anon` actually holds a select grant for on `sepak.slots` (see
 *  migration 0002): `claim_token` is deliberately excluded, so every read of
 *  `slots` — here and in tests — must name columns explicitly rather than
 *  use `select('*')`, which 401s for anon. Reads of `sessions` may keep
 *  `select('*')`: anon has table-wide select there. */
export const SLOT_COLUMNS = 'id, session_id, team, position, player_name, claimed_at, paid'

function boom(what: string, message: string): never {
  throw new Error(`${what}: ${message}`)
}

export async function listSessions(): Promise<Session[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .order('play_date', { ascending: false })
    .order('start_time', { ascending: false })
  if (error !== null) boom('listSessions', error.message)
  return (data ?? []).map(parseSession)
}

export async function getSessionWithSlots(id: string): Promise<SessionWithSlots | null> {
  const sessionResult = await supabase.from('sessions').select('*').eq('id', id).maybeSingle()
  if (sessionResult.error !== null) boom('getSession', sessionResult.error.message)
  if (sessionResult.data === null) return null

  const slotsResult = await supabase.from('slots').select(SLOT_COLUMNS).eq('session_id', id)
  if (slotsResult.error !== null) boom('getSlots', slotsResult.error.message)

  return {
    session: parseSession(sessionResult.data),
    slots: (slotsResult.data ?? []).map(parseSlot),
  }
}

/** Suggests the next number so the organiser rarely has to think about it. */
export async function nextSessionNo(): Promise<number> {
  const { data, error } = await supabase
    .from('sessions')
    .select('session_no')
    .order('session_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error !== null) boom('nextSessionNo', error.message)
  if (data === null) return 1

  const value = Object.fromEntries(Object.entries(data))['session_no']
  const current = typeof value === 'string' ? Number(value) : value
  return typeof current === 'number' && Number.isFinite(current) ? current + 1 : 1
}

export async function createSession(input: NewSessionInput): Promise<Session> {
  const { data, error } = await supabase.rpc('create_session', {
    p_session_no: input.sessionNo,
    p_title: input.title,
    p_play_date: input.playDate,
    p_start_time: input.startTime,
    p_duration_mins: input.durationMins,
    p_venue: input.venue,
    p_fee_myr: input.feeMyr,
    p_team_a_name: input.teamAName,
    p_team_b_name: input.teamBName,
    p_team_c_name: input.teamCName,
  })
  if (error !== null) boom('createSession', error.message)
  return parseSession(data)
}

export async function updateSession(id: string, patch: SessionPatch): Promise<Session> {
  const row: Record<string, string | number | null | undefined> = {}
  if (patch.sessionNo !== undefined) row['session_no'] = patch.sessionNo
  if (patch.title !== undefined) row['title'] = patch.title
  if (patch.playDate !== undefined) row['play_date'] = patch.playDate
  if (patch.startTime !== undefined) row['start_time'] = patch.startTime
  if (patch.durationMins !== undefined) row['duration_mins'] = patch.durationMins
  if (patch.venue !== undefined) row['venue'] = patch.venue
  if (patch.feeMyr !== undefined) row['fee_myr'] = patch.feeMyr
  if (patch.teamAName !== undefined) row['team_a_name'] = patch.teamAName
  if (patch.teamBName !== undefined) row['team_b_name'] = patch.teamBName
  if (patch.teamCName !== undefined) row['team_c_name'] = patch.teamCName

  const { data, error } = await supabase.from('sessions').update(row).eq('id', id).select('*').single()
  if (error !== null) boom('updateSession', error.message)
  return parseSession(data)
}

export async function setSessionStatus(id: string, status: SessionStatus): Promise<Session> {
  const { data, error } = await supabase.from('sessions').update({ status }).eq('id', id).select('*').single()
  if (error !== null) boom('setSessionStatus', error.message)
  return parseSession(data)
}

export async function deleteSession(id: string): Promise<void> {
  const { error } = await supabase.from('sessions').delete().eq('id', id)
  if (error !== null) boom('deleteSession', error.message)
}

/** Claimed-slot counts keyed by session id. One round trip for the whole list. */
export async function fillCounts(sessionIds: readonly string[]): Promise<Map<string, number>> {
  if (sessionIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('slots')
    .select('session_id')
    .in('session_id', [...sessionIds])
    .not('player_name', 'is', null)
  if (error !== null) boom('fillCounts', error.message)

  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    const id = Object.fromEntries(Object.entries(row))['session_id']
    if (typeof id === 'string') counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}
