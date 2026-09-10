import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('expected an object')
  return Object.fromEntries(Object.entries(value))
}

function status(): { url: string; serviceKey: string } {
  // stderr is discarded: the CLI writes its "stopped services"/update-nag
  // text there even on success, and that text is not JSON.
  const raw = execFileSync('supabase', ['status', '-o', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const parsed: unknown = JSON.parse(raw)
  const record = asRecord(parsed)
  const url = record['API_URL']
  const serviceKey = record['SERVICE_ROLE_KEY']
  if (typeof url !== 'string' || typeof serviceKey !== 'string') {
    throw new Error('supabase status missing API_URL or SERVICE_ROLE_KEY')
  }
  return { url, serviceKey }
}

const { url, serviceKey } = status()

/** Service-role client used only by e2e fixtures to seed and tear down
 *  sessions. Read from the running local stack at import time, never
 *  written to disk and never referenced from `src/`. */
export function admin(): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

export async function createTestSession(sessionNo: number): Promise<string> {
  const { data, error } = await admin().rpc('create_session', {
    p_session_no: sessionNo,
    p_title: 'E2E Geng',
    p_play_date: '2026-12-16',
    p_start_time: '20:00:00',
    p_duration_mins: 120,
    p_venue: 'Padang E2E',
    p_fee_myr: 27,
    p_team_a_name: 'Merah',
    p_team_b_name: 'Putih',
    p_team_c_name: 'Kuning',
  })
  if (error !== null) throw new Error(`create_session failed: ${error.message}`)

  const row = asRecord(data)
  const id = row['id']
  if (typeof id !== 'string') throw new Error('create_session returned no id')
  return id
}

export async function dropTestSession(id: string): Promise<void> {
  await admin().from('sessions').delete().eq('id', id)
}
