import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActivityError, listActivity } from '../../src/data/activity'
import { supabase } from '../../src/lib/supabase'
import { adminClient, anonClient, deleteSession, seedSession, slotId } from '../helpers/localSupabase'

const PLAYER_TOKEN = '66666666-6666-4666-8666-666666666666'

describe('activity against local postgres', () => {
  let sessionId = ''

  beforeEach(async () => {
    sessionId = (await seedSession()).sessionId
  })

  afterEach(async () => {
    await deleteSession(sessionId)
  })

  it('is refused for anon, which is what the app runs as by default', async () => {
    await expect(listActivity()).rejects.toBeInstanceOf(ActivityError)
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
  let userId: string | null = null
  let adminEmail: string | null = null

  beforeEach(async () => {
    const seeded = await seedSession()
    sessionId = seeded.sessionId
    ids = seeded.slotIds
  })

  afterEach(async () => {
    await supabase.auth.signOut()
    await deleteSession(sessionId)
    if (userId !== null) {
      await adminClient().auth.admin.deleteUser(userId)
      userId = null
    }
    if (adminEmail !== null) {
      await adminClient().from('admins').delete().eq('email', adminEmail)
      adminEmail = null
    }
  })

  it('reads back what a player did, newest first, with the number kept', async () => {
    const gk = slotId(ids, 'A', 'GK')

    // The player acts as a genuine visitor on its own anon client: doing this
    // through the signed-in singleton would log an admin, not a player.
    const anon = anonClient()
    const claimed = await anon.rpc('claim_slot', {
      p_slot_id: gk,
      p_name: 'Hazmi',
      p_phone: '60123456789',
      p_token: PLAYER_TOKEN,
    })
    expect(claimed.error).toBeNull()
    const ticked = await anon.rpc('set_slot_paid', { p_slot_id: gk, p_token: PLAYER_TOKEN, p_paid: true })
    expect(ticked.error).toBeNull()
    const released = await anon.rpc('release_slot', { p_slot_id: gk, p_token: PLAYER_TOKEN })
    expect(released.error).toBeNull()

    const email = `organiser-${randomUUID()}@example.test`
    const password = 'activity-test-password'
    const created = await adminClient().auth.admin.createUser({ email, password, email_confirm: true })
    expect(created.error).toBeNull()
    userId = created.data.user?.id ?? null
    adminEmail = email
    const allowlisted = await adminClient().from('admins').insert({ email, role: 'admin' })
    expect(allowlisted.error).toBeNull()
    const signedIn = await supabase.auth.signInWithPassword({ email, password })
    expect(signedIn.error).toBeNull()

    // The feed spans every session, so this one's lines are picked out.
    const mine = (await listActivity()).filter((e) => e.sessionId === sessionId)
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
    const claimed = await anonClient().rpc('claim_slot', {
      p_slot_id: st,
      p_name: 'Amir',
      p_phone: '60198765432',
      p_token: PLAYER_TOKEN,
    })
    expect(claimed.error).toBeNull()

    const email = `organiser-${randomUUID()}@example.test`
    const password = 'activity-test-password'
    const created = await adminClient().auth.admin.createUser({ email, password, email_confirm: true })
    userId = created.data.user?.id ?? null
    adminEmail = email
    await adminClient().from('admins').insert({ email, role: 'admin' })
    const signedIn = await supabase.auth.signInWithPassword({ email, password })
    expect(signedIn.error).toBeNull()

    // adminClearSlot's own write path: a direct update as the signed-in admin.
    const cleared = await supabase
      .from('slots')
      .update({ player_name: null, claim_token: null, claimed_at: null })
      .eq('id', st)
    expect(cleared.error).toBeNull()

    const mine = (await listActivity()).filter((e) => e.sessionId === sessionId)
    expect(mine[0]).toMatchObject({
      kind: 'admin_clear',
      actor: 'admin',
      playerName: 'Amir',
      phone: '60198765432',
    })
  })
})
