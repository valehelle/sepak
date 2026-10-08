import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  adminClient,
  anonClient,
  deletePlayer,
  deleteSession,
  newPlayer,
  seedSession,
  slotId,
  type Player,
} from '../helpers/localSupabase'

// Bookings belong to a signed-in account (0019_accounts.sql). These tests are
// about that boundary itself: who is let in, and what an account can reach
// from more than one device.

const OLD_BROWSER_TOKEN = '33333333-3333-4333-8333-333333333333'

function asIds(data: unknown): string[] {
  if (!Array.isArray(data)) throw new Error('expected a list of ids')
  return data.map((row: unknown) => {
    if (typeof row !== 'string') throw new Error('expected an id')
    return row
  })
}

describe('accounts against local postgres', () => {
  let sessionId = ''
  let ids: Record<string, string | undefined> = {}
  const players: Player[] = []
  const adminEmails: string[] = []

  async function player(label: string): Promise<Player> {
    const created = await newPlayer(label)
    players.push(created)
    return created
  }

  beforeEach(async () => {
    const seeded = await seedSession()
    sessionId = seeded.sessionId
    ids = seeded.slotIds
  })

  afterEach(async () => {
    await deleteSession(sessionId)
    // The allowlist row first: deleting the account would only null its
    // user_id and leave the row behind.
    for (const email of adminEmails.splice(0)) {
      await adminClient().from('admins').delete().eq('email', email)
    }
    for (const created of players.splice(0)) await deletePlayer(created)
  })

  it('refuses a signed-out claim with not_signed_in', async () => {
    const { error } = await anonClient().rpc('claim_slot', {
      p_slot_id: slotId(ids, 'A', 'GK'),
      p_name: 'Hazmi',
      p_phone: '60123456789',
    })
    expect(error?.message ?? '').toContain('not_signed_in')
  })

  it('refuses a client that passes a browser token, since the 4-argument claim_slot is revoked', async () => {
    const hazmi = await player('hazmi')
    const gk = slotId(ids, 'A', 'GK')

    const { error } = await hazmi.client.rpc('claim_slot', {
      p_slot_id: gk,
      p_name: 'Hazmi',
      p_phone: '60123456789',
      p_token: OLD_BROWSER_TOKEN,
    })
    expect(error).not.toBeNull()

    const slot = await adminClient().from('slots').select('player_name').eq('id', gk).single()
    expect(slot.data).toEqual({ player_name: null })
  })

  it('shows one account the same slot from a second sign-in, and lets it tick paid from there', async () => {
    const hazmi = await player('hazmi')
    const gk = slotId(ids, 'A', 'GK')
    const claimed = await hazmi.client.rpc('claim_slot', { p_slot_id: gk, p_name: 'Hazmi', p_phone: '60123456789' })
    expect(claimed.error).toBeNull()

    // A second phone: its own client, the same account.
    const laptop = anonClient()
    const signedIn = await laptop.auth.signInWithPassword({ email: hazmi.email, password: hazmi.password })
    expect(signedIn.error).toBeNull()

    const mine = await laptop.rpc('my_slot_ids', { p_session_id: sessionId })
    expect(mine.error).toBeNull()
    expect(asIds(mine.data)).toEqual([gk])

    const ticked = await laptop.rpc('set_slot_paid', { p_slot_id: gk, p_paid: true })
    expect(ticked.error).toBeNull()
    const row = await adminClient().from('slots').select('paid').eq('id', gk).single()
    expect(row.data).toEqual({ paid: true })

    await laptop.auth.signOut()
  })

  it('moves a browser-token booking onto the account that adopts the device', async () => {
    const hazmi = await player('hazmi')
    const gk = slotId(ids, 'A', 'GK')

    // A booking made before sign-in existed. The 4-argument claim_slot is no
    // longer callable by clients, so the row is written the way it would
    // have been left: name, old key, claim time.
    const seeded = await adminClient()
      .from('slots')
      .update({ player_name: 'Hazmi', claim_token: OLD_BROWSER_TOKEN, claimed_at: new Date().toISOString() })
      .eq('id', gk)
    expect(seeded.error).toBeNull()

    const before = await hazmi.client.rpc('my_slot_ids', { p_session_id: sessionId })
    expect(asIds(before.data)).toEqual([])

    const adopted = await hazmi.client.rpc('adopt_device', { p_device_token: OLD_BROWSER_TOKEN })
    expect(adopted.error).toBeNull()
    expect(adopted.data).toBe(1)

    const after = await hazmi.client.rpc('my_slot_ids', { p_session_id: sessionId })
    expect(asIds(after.data)).toEqual([gk])

    // claim_token is never readable by a player, so ownership is checked
    // with the service role.
    const owner = await adminClient().from('slots').select('claim_token').eq('id', gk).single()
    expect(owner.data).toEqual({ claim_token: hazmi.userId })
  })

  it('lets an admin book somebody else with admin_claim_slot, and refuses a plain player', async () => {
    const organiser = await player('organiser')
    const plain = await player('plain')
    const gk = slotId(ids, 'A', 'GK')
    const st = slotId(ids, 'A', 'ST')

    // Refused before the account is on the allowlist, and nothing is booked.
    const refused = await organiser.client.rpc('admin_claim_slot', { p_slot_id: gk, p_name: 'Amir', p_phone: '60198765432' })
    expect(refused.error?.message ?? '').toContain('not_admin')

    // An admin is an account: the allowlist row binds to the account holding
    // the email, which already exists.
    const allowlisted = await adminClient().from('admins').insert({ email: organiser.email, role: 'admin' })
    expect(allowlisted.error).toBeNull()
    adminEmails.push(organiser.email)

    const booked = await organiser.client.rpc('admin_claim_slot', { p_slot_id: gk, p_name: 'Amir', p_phone: '60198765432' })
    expect(booked.error).toBeNull()
    const row = await adminClient().from('slots').select('player_name, claim_token').eq('id', gk).single()
    expect(row.data).toMatchObject({ player_name: 'Amir' })
    // Owned by an id no account has, so only admins manage it.
    expect(row.data).not.toMatchObject({ claim_token: organiser.userId })

    const plainTry = await plain.client.rpc('admin_claim_slot', { p_slot_id: st, p_name: 'Rogue', p_phone: '60111112222' })
    expect(plainTry.error?.message ?? '').toContain('not_admin')
    const untouched = await adminClient().from('slots').select('player_name').eq('id', st).single()
    expect(untouched.data).toEqual({ player_name: null })
  })
})
