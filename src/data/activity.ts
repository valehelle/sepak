import { isPosition, isTeamKey, type Position, type TeamKey } from '../lib/positions'
import { supabase } from '../lib/supabase'

export const ACTIVITY_KINDS = [
  'claim',
  'autofill',
  'release',
  'admin_clear',
  'paid',
  'unpaid',
  'waitlist_join',
  'waitlist_leave',
] as const

export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

export const ACTIVITY_ACTORS = ['player', 'admin', 'system'] as const

export type ActivityActor = (typeof ACTIVITY_ACTORS)[number]

export type ActivityEvent = {
  id: number
  sessionId: string
  sessionNo: number
  kind: ActivityKind
  actor: ActivityActor
  playerName: string
  /** Null only for rows written before a number was recorded; the log
   *  otherwise keeps its own copy so a line stays actionable after the
   *  contacts row is gone. */
  phone: string | null
  /** Null for queue lines, which belong to no position yet. */
  team: TeamKey | null
  position: Position | null
  createdAt: string
}

export class ActivityError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message)
    this.name = 'ActivityError'
  }
}

function isKind(value: string): value is ActivityKind {
  return ACTIVITY_KINDS.some((kind) => kind === value)
}

function isActor(value: string): value is ActivityActor {
  return ACTIVITY_ACTORS.some((actor) => actor === value)
}

/** Rejects rather than casts, mirroring parseSession/parseSlot in ./types. */
function parseEvent(row: unknown): ActivityEvent {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new Error('activity: expected an object')
  }
  const r: Record<string, unknown> = Object.fromEntries(Object.entries(row))

  const id = typeof r.id === 'string' ? Number(r.id) : r.id
  if (typeof id !== 'number' || !Number.isFinite(id)) throw new Error('id: expected a number')

  const sessionNo = typeof r.session_no === 'string' ? Number(r.session_no) : r.session_no
  if (typeof sessionNo !== 'number' || !Number.isFinite(sessionNo)) {
    throw new Error('session_no: expected a number')
  }

  const sessionId = r.session_id
  const kind = r.kind
  const actor = r.actor
  const playerName = r.player_name
  const createdAt = r.created_at
  if (typeof sessionId !== 'string') throw new Error('session_id: expected a string')
  if (typeof kind !== 'string' || !isKind(kind)) throw new Error(`kind: unknown value ${String(kind)}`)
  if (typeof actor !== 'string' || !isActor(actor)) throw new Error(`actor: unknown value ${String(actor)}`)
  if (typeof playerName !== 'string') throw new Error('player_name: expected a string')
  if (typeof createdAt !== 'string') throw new Error('created_at: expected a string')

  const phone = r.phone
  if (phone !== null && phone !== undefined && typeof phone !== 'string') {
    throw new Error('phone: expected a string or null')
  }

  const team = r.team
  if (team !== null && team !== undefined && (typeof team !== 'string' || !isTeamKey(team))) {
    throw new Error(`team: unknown value ${String(team)}`)
  }
  const position = r.position
  if (
    position !== null &&
    position !== undefined &&
    (typeof position !== 'string' || !isPosition(position))
  ) {
    throw new Error(`position: unknown value ${String(position)}`)
  }

  return {
    id,
    sessionId,
    sessionNo,
    kind,
    actor,
    playerName,
    phone: phone ?? null,
    team: team ?? null,
    position: position ?? null,
    createdAt,
  }
}

/** The organiser's log, newest first. Admin-gated in the database
 *  (sepak.activity_feed raises not_admin), so this is safe to call from a
 *  page that merely believes it is an admin. */
export async function listActivity(limit = 100): Promise<ActivityEvent[]> {
  const { data, error } = await supabase.rpc('activity_feed', { p_limit: limit })
  if (error !== null) {
    const code = error.message.includes('not_admin') ? 'not_admin' : null
    throw new ActivityError(
      code === 'not_admin' ? 'Hanya admin boleh lihat aktiviti.' : 'Gagal memuatkan aktiviti.',
      code,
    )
  }

  const rows: unknown[] = data ?? []
  return rows.map(parseEvent)
}
