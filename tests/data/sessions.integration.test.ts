import { afterEach, describe, expect, it } from 'vitest'
import { adminClient, anonClient, deleteSession } from '../helpers/localSupabase'

describe('session access as anon', () => {
  const created: string[] = []

  afterEach(async () => {
    for (const id of created.splice(0)) await deleteSession(id)
  })

  it('reads sessions and slots', async () => {
    const admin = adminClient()
    const { data, error } = await admin.rpc('create_session', {
      p_session_no: 900,
      p_title: 'Integration',
      p_play_date: '2026-10-01',
      p_start_time: '20:00:00',
      p_duration_mins: 120,
      p_venue: 'Padang Integration',
      p_fee_myr: 27,
      p_team_a_name: 'Merah',
      p_team_b_name: 'Putih',
      p_team_c_name: 'Kuning',
    })
    expect(error).toBeNull()

    const row = Object.fromEntries(Object.entries(data ?? {}))
    const id = String(row['id'])
    created.push(id)

    const client = anonClient()
    const slots = await client.from('slots').select('id').eq('session_id', id)
    expect(slots.error).toBeNull()
    expect(slots.data).toHaveLength(44)

    const sessions = await client.from('sessions').select('*').eq('id', id)
    expect(sessions.error).toBeNull()
    expect(sessions.data).toHaveLength(1)
  })

  it('cannot create a session as anon', async () => {
    const { error } = await anonClient().rpc('create_session', {
      p_session_no: 901,
      p_title: 'Rogue',
      p_play_date: '2026-10-08',
      p_start_time: '20:00:00',
      p_duration_mins: 120,
      p_venue: 'Nowhere',
      p_fee_myr: 10,
      p_team_a_name: 'Merah',
      p_team_b_name: 'Putih',
      p_team_c_name: 'Kuning',
    })
    expect(error).not.toBeNull()
  })
})
