import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { anonClient, deletePlayer, deleteSession, newPlayer, seedSession, slotId, type Player } from '../helpers/localSupabase'
import { SLOT_COLUMNS } from '../../src/data/sessions'

/** One booking per phone per session (0010_one_booking_per_person.sql), so
 *  every test player needs its own number. Derived from the account id,
 *  which is what the rule now treats as the person, keeping the two
 *  consistent without a lookup table to forget to update. */
function phoneFor(player: Player): string {
  return `601${player.userId.replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`
}

async function claim(player: Player, id: string, name: string) {
  return player.client.rpc('claim_slot', { p_slot_id: id, p_name: name, p_phone: phoneFor(player) })
}

describe('slot RPCs against local postgres', () => {
  let sessionId = ''
  let ids: Record<string, string | undefined> = {}
  const client = anonClient()
  let hazmi: Player
  let isaac: Player

  beforeEach(async () => {
    hazmi = await newPlayer('hazmi')
    isaac = await newPlayer('isaac')
    const seeded = await seedSession()
    sessionId = seeded.sessionId
    ids = seeded.slotIds
  })

  afterEach(async () => {
    await deleteSession(sessionId)
    await deletePlayer(hazmi)
    await deletePlayer(isaac)
  })

  it('claims an empty slot', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const { error } = await claim(hazmi, gk, 'Hazmi')
    expect(error).toBeNull()

    const { data } = await client.from('slots').select('player_name').eq('id', gk).single()
    expect(data).toMatchObject({ player_name: 'Hazmi' })
  })

  it('lets exactly one of two simultaneous claims win', async () => {
    const gk = slotId(ids, 'A', 'GK')

    const [first, second] = await Promise.all([
      claim(hazmi, gk, 'Hazmi'),
      claim(isaac, gk, 'Isaac'),
    ])

    const errors = [first.error, second.error].filter((e) => e !== null)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('slot_taken')

    const { data } = await client.from('slots').select('player_name').eq('id', gk).single()
    const row = Object.fromEntries(Object.entries(data ?? {}))
    expect(['Hazmi', 'Isaac']).toContain(row['player_name'])
  })

  it("refuses to release another account's slot", async () => {
    const gk = slotId(ids, 'A', 'GK')
    await claim(hazmi, gk, 'Hazmi')

    const { error } = await isaac.client.rpc('release_slot', { p_slot_id: gk })
    expect(error?.message).toContain('wrong_token')

    const { data } = await client.from('slots').select('player_name').eq('id', gk).single()
    expect(data).toMatchObject({ player_name: 'Hazmi' })
  })

  it('releases for the account that holds it', async () => {
    const gk = slotId(ids, 'A', 'GK')
    await claim(hazmi, gk, 'Hazmi')

    const { error } = await hazmi.client.rpc('release_slot', { p_slot_id: gk })
    expect(error).toBeNull()

    const { data } = await client.from('slots').select('player_name').eq('id', gk).single()
    expect(data).toMatchObject({ player_name: null })
  })

  it('cannot write slots directly as anon', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const { error } = await client
      .from('slots')
      .update({ player_name: 'Rogue', claim_token: isaac.userId, claimed_at: new Date().toISOString() })
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
