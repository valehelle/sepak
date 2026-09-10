import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type Status = { API_URL: string; ANON_KEY: string; SERVICE_ROLE_KEY: string; DB_URL: string }

// SLOT_COLUMNS lives in src/data/sessions.ts, the single source for the
// anon column-level grant on `slots` — import it from there, not a second
// hand-written copy here.

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('expected an object')
  return Object.fromEntries(Object.entries(value))
}

function readStatus(): Status {
  // stderr is discarded: the CLI writes its "stopped services"/update-nag
  // text there even on success, and it would otherwise leak into every test
  // run's output (execFileSync inherits stderr by default).
  const raw = execFileSync('supabase', ['status', '-o', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const parsed: unknown = JSON.parse(raw)
  const record = asRecord(parsed)

  const field = (name: keyof Status): string => {
    const value = record[name]
    if (typeof value !== 'string' || value === '') {
      throw new Error(`supabase status: missing ${name}. Is the local stack running?`)
    }
    return value
  }

  return {
    API_URL: field('API_URL'),
    ANON_KEY: field('ANON_KEY'),
    SERVICE_ROLE_KEY: field('SERVICE_ROLE_KEY'),
    DB_URL: field('DB_URL'),
  }
}

export const localStatus = readStatus()

/** The anon client — the same privileges a real visitor has. */
export function anonClient(): SupabaseClient {
  return createClient(localStatus.API_URL, localStatus.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Service role, used only to seed and tear down fixtures. Local-only, read
 *  from the running stack, never written to disk. */
export function adminClient(): SupabaseClient {
  return createClient(localStatus.API_URL, localStatus.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function seedSession(
  overrides: Partial<{ sessionNo: number; playDate: string; status: 'open' | 'closed'; feeMyr: number | null }> = {},
): Promise<{ sessionId: string; slotIds: Record<string, string | undefined> }> {
  const admin = adminClient()
  const { data, error } = await admin
    .from('sessions')
    .insert({
      session_no: overrides.sessionNo ?? 1,
      title: 'Geng Turun Peluh',
      play_date: overrides.playDate ?? '2026-09-16',
      start_time: '20:00:00',
      venue: 'Padang Presint 8',
      fee_myr: overrides.feeMyr === undefined ? 27 : overrides.feeMyr,
      status: overrides.status ?? 'open',
    })
    .select('id')
    .single()

  if (error !== null) throw new Error(`seed session failed: ${error.message}`)
  const sessionId = parseId(data)

  const positions = ['GK', 'LB', 'CB1', 'CB2', 'RB', 'DM', 'MC', 'AM', 'LWF', 'RWF', 'ST'] as const
  const rows = ['A', 'B', 'C'].flatMap((team) => positions.map((position) => ({ session_id: sessionId, team, position })))

  const inserted = await admin.from('slots').insert(rows).select('id, team, position')
  if (inserted.error !== null) throw new Error(`seed slots failed: ${inserted.error.message}`)

  const slotIds: Record<string, string | undefined> = {}
  for (const row of inserted.data ?? []) {
    const r = asRecord(row)
    const id = r['id']
    const team = r['team']
    const position = r['position']
    if (typeof id === 'string' && typeof team === 'string' && typeof position === 'string') {
      slotIds[`${team}:${position}`] = id
    }
  }

  return { sessionId, slotIds }
}

function parseId(row: unknown): string {
  const id = asRecord(row)['id']
  if (typeof id !== 'string') throw new Error('expected an id')
  return id
}

export async function deleteSession(sessionId: string): Promise<void> {
  const { error } = await adminClient().from('sessions').delete().eq('id', sessionId)
  if (error !== null) throw new Error(`cleanup failed: ${error.message}`)
}

export function slotId(ids: Record<string, string | undefined>, team: string, position: string): string {
  const id = ids[`${team}:${position}`]
  if (id === undefined) throw new Error(`no seeded slot for ${team}:${position}`)
  return id
}
