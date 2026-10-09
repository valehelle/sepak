import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActivityError, listSessionActivity } from '../../src/data/activity'
import { supabase } from '../../src/lib/supabase'
import {
  adminClient,
  anonClient,
  deletePlayer,
  deleteSession,
  newPlayer,
  seedSession,
  signInAppClientAs,
  slotId,
  type Player,
} from '../helpers/localSupabase'

describe('activity against local postgres', () => {
  let sessionId = ''

  beforeEach(async () => {
    sessionId = (await seedSession()).sessionId
  })

  afterEach(async () => {
    await deleteSession(sessionId)
  })

  it('is refused for anon, which is what the app runs as by default', async () => {
    await expect(listSessionActivity('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(ActivityError)
  })

  it('anon cannot read the table directly either', async () => {
    const { error } = await anonClient().from('activity').select('kind')
    expect(error).not.toBeNull()
  })
})

// Signing in mutates the module-level client shared by the whole process, so
// this mirrors sessionActions.integration.test.ts: sign out in afterEach come
// what may, and rely on the integration project's single fork so no other
// file is running against the same singleton meanwhile.
describe('activity as an allowlisted admin', () => {
  let sessionId = ''
  let ids: Record<string, string | undefined> = {}
  let player: Player
  let organiser: Player

  beforeEach(async () => {
    const seeded = await seedSession()
    sessionId = seeded.sessionId
    ids = seeded.slotIds
    player = await newPlayer('player')
    organiser = await newPlayer('organiser')
  })

  /** An admin is an account: the allowlist row is bound to the account that
   *  holds the email (0019_accounts.sql), so the account must exist first. */
  async function signInAsOrganiser(): Promise<void> {
    const allowlisted = await adminClient().from('admins').insert({ email: organiser.email, role: 'admin' })
    expect(allowlisted.error).toBeNull()
    await signInAppClientAs(supabase, organiser)
  }

  afterEach(async () => {
    await supabase.auth.signOut()
    await deleteSession(sessionId)
    await adminClient().from('admins').delete().eq('email', organiser.email)
    await deletePlayer(player)
    await deletePlayer(organiser)
  })

  it('reads back what a player did, newest first, with the number kept', async () => {
    const gk = slotId(ids, 'A', 'GK')

    // The player acts on its own client: doing this through the app's
    // singleton, signed in below as the admin, would log an admin action.
    const claimed = await player.client.rpc('claim_slot', {
      p_slot_id: gk,
      p_name: 'Hazmi',
      p_phone: '60123456789',
    })
    expect(claimed.error).toBeNull()
    const ticked = await player.client.rpc('set_slot_paid', { p_slot_id: gk, p_paid: true })
    expect(ticked.error).toBeNull()
    const released = await player.client.rpc('release_slot', { p_slot_id: gk })
    expect(released.error).toBeNull()

    await signInAsOrganiser()

    // The feed spans every session, so this one's lines are picked out.
    const mine = await listSessionActivity(sessionId)
    expect(mine.map((e) => e.kind)).toEqual(['release', 'paid', 'claim'])

    const [release, , claim] = mine
    expect(claim).toMatchObject({
      actor: 'player',
      playerName: 'Hazmi',
      phone: '60123456789',
      team: 'A',
      position: 'GK',
    })
    // The contacts row is gone by now, so this proves the log kept its own.
    expect(release).toMatchObject({ actor: 'player', phone: '60123456789' })

    const contacts = await adminClient().from('contacts').select('phone').eq('slot_id', gk)
    expect(contacts.data).toEqual([])
  })

  it('records the organiser emptying a slot as an admin action', async () => {
    const st = slotId(ids, 'A', 'ST')
    const claimed = await player.client.rpc('claim_slot', {
      p_slot_id: st,
      p_name: 'Amir',
      p_phone: '60198765432',
    })
    expect(claimed.error).toBeNull()

    await signInAsOrganiser()

    // adminClearSlot's own write path: a direct update as the signed-in admin.
    const cleared = await supabase
      .from('slots')
      .update({ player_name: null, claim_token: null, claimed_at: null })
      .eq('id', st)
    expect(cleared.error).toBeNull()

    const mine = await listSessionActivity(sessionId)
    expect(mine[0]).toMatchObject({
      kind: 'admin_clear',
      actor: 'admin',
      playerName: 'Amir',
      phone: '60198765432',
    })
  })
})
