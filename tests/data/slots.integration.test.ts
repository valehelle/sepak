import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { anonClient, deleteSession, seedSession, slotId } from '../helpers/localSupabase'
import { SLOT_COLUMNS } from '../../src/data/sessions'

const TOKEN_A = '44444444-4444-4444-8444-444444444444'
const TOKEN_B = '55555555-5555-4555-8555-555555555555'

async function claim(client: ReturnType<typeof anonClient>, id: string, name: string, token: string) {
  return client.rpc('claim_slot', { p_slot_id: id, p_name: name, p_token: token })
}

describe('slot RPCs against local postgres', () => {
  let sessionId = ''
  let ids: Record<string, string | undefined> = {}
  const client = anonClient()

  beforeEach(async () => {
    const seeded = await seedSession()
    sessionId = seeded.sessionId
    ids = seeded.slotIds
  })

  afterEach(async () => {
    await deleteSession(sessionId)
  })

  it('claims an empty slot', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const { error } = await claim(client, gk, 'Hazmi', TOKEN_A)
    expect(error).toBeNull()

    const { data } = await client.from('slots').select('player_name').eq('id', gk).single()
    expect(data).toMatchObject({ player_name: 'Hazmi' })
  })

  it('lets exactly one of two simultaneous claims win', async () => {
    const gk = slotId(ids, 'A', 'GK')

    const [first, second] = await Promise.all([
      claim(anonClient(), gk, 'Hazmi', TOKEN_A),
      claim(anonClient(), gk, 'Isaac', TOKEN_B),
    ])

    const errors = [first.error, second.error].filter((e) => e !== null)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('slot_taken')

    const { data } = await client.from('slots').select('player_name').eq('id', gk).single()
    const row = Object.fromEntries(Object.entries(data ?? {}))
    expect(['Hazmi', 'Isaac']).toContain(row['player_name'])
  })

  it("refuses to release another device's slot", async () => {
    const gk = slotId(ids, 'A', 'GK')
    await claim(client, gk, 'Hazmi', TOKEN_A)

    const { error } = await client.rpc('release_slot', { p_slot_id: gk, p_token: TOKEN_B })
    expect(error?.message).toContain('wrong_token')

    const { data } = await client.from('slots').select('player_name').eq('id', gk).single()
    expect(data).toMatchObject({ player_name: 'Hazmi' })
  })

  it('releases with the right token', async () => {
    const gk = slotId(ids, 'A', 'GK')
    await claim(client, gk, 'Hazmi', TOKEN_A)

    const { error } = await client.rpc('release_slot', { p_slot_id: gk, p_token: TOKEN_A })
    expect(error).toBeNull()

    const { data } = await client.from('slots').select('player_name').eq('id', gk).single()
    expect(data).toMatchObject({ player_name: null })
  })

  it('moves a claim between positions atomically', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const st = slotId(ids, 'A', 'ST')
    await claim(client, gk, 'Hazmi', TOKEN_A)

    const { error } = await client.rpc('move_slot', { p_from: gk, p_to: st, p_token: TOKEN_A })
    expect(error).toBeNull()

    const { data } = await client.from('slots').select('id, player_name').in('id', [gk, st])
    const byId = new Map(
      (data ?? []).map((row) => {
        const r = Object.fromEntries(Object.entries(row))
        return [String(r['id']), r['player_name']]
      }),
    )
    expect(byId.get(gk)).toBeNull()
    expect(byId.get(st)).toBe('Hazmi')
  })

  it('cannot write slots directly as anon', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const { error } = await client
      .from('slots')
      .update({ player_name: 'Rogue', claim_token: TOKEN_B, claimed_at: new Date().toISOString() })
      .eq('id', gk)
    expect(error).not.toBeNull()
  })

  it('cannot read claim_token as anon, even with an explicit column list', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const wide = await client.from('slots').select(`${SLOT_COLUMNS}, claim_token`).eq('id', gk).single()
    expect(wide.error).not.toBeNull()
    expect(wide.status).toBe(401)
  })

  it("select('*') on slots is rejected for anon (column-level grant excludes claim_token)", async () => {
    const gk = slotId(ids, 'A', 'GK')
    const { error, status } = await client.from('slots').select('*').eq('id', gk).single()
    expect(error).not.toBeNull()
    expect(status).toBe(401)
    expect(error?.code).toBe('42501')
  })

  it('reads the allowed columns fine via the shared SLOT_COLUMNS list', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const { data, error } = await client.from('slots').select(SLOT_COLUMNS).eq('id', gk).single()
    expect(error).toBeNull()
    expect(data).toMatchObject({ id: gk })
  })
})
