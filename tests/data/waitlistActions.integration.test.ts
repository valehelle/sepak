import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { supabase } from '../../src/lib/supabase'
import {
  WaitlistActionError,
  adminRemoveFromWaitlist,
  getMyWaitlistEntry,
  joinWaitlist,
  leaveWaitlist,
  listWaitlist,
} from '../../src/data/waitlist'
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

// The wrapper functions always act as whoever the app's singleton client
// is signed in as, so a genuinely different claimant is a second account
// on its own client, calling the RPCs directly, exactly as
// slotActions.integration.test.ts does.

/** Fills every slot except the given one, so it becomes the sole free slot
 *  matching whatever position a test cares about. There are three GK slots
 *  (one per team) and so on for every position -- a preference like ['GK']
 *  only becomes genuinely scarce once all three are taken. */
async function fillAllExcept(sessionId: string, exceptSlotId: string): Promise<void> {
  const { error } = await adminClient()
    .from('slots')
    .update({ player_name: 'Filler', claim_token: '99999999-9999-4999-8999-999999999999', claimed_at: new Date().toISOString() })
    .eq('session_id', sessionId)
    .neq('id', exceptSlotId)
  if (error !== null) throw new Error(`fillAllExcept failed: ${error.message}`)
}

/** Fills every one of the 33 slots -- guarantees any join_waitlist call
 *  queues rather than claims, regardless of which positions it prefers. */
async function fillAll(sessionId: string): Promise<void> {
  const { error } = await adminClient()
    .from('slots')
    .update({ player_name: 'Filler', claim_token: '99999999-9999-4999-8999-999999999999', claimed_at: new Date().toISOString() })
    .eq('session_id', sessionId)
  if (error !== null) throw new Error(`fillAll failed: ${error.message}`)
}

describe('waitlist wrappers against local postgres', () => {
  let sessionId = ''
  let ids: Record<string, string | undefined> = {}

  let me: Player
  let other: Player

  beforeEach(async () => {
    me = await newPlayer('me')
    other = await newPlayer('other')
    await signInAppClientAs(supabase, me)
    const seeded = await seedSession()
    sessionId = seeded.sessionId
    ids = seeded.slotIds
  })

  afterEach(async () => {
    await supabase.auth.signOut()
    await adminClient().from('admins').delete().eq('email', me.email)
    await deleteSession(sessionId)
    await deletePlayer(me)
    await deletePlayer(other)
  })

  it('places immediately when a preferred position is already free', async () => {
    const gk = slotId(ids, 'A', 'GK')
    await fillAllExcept(sessionId, gk)

    const result = await joinWaitlist(sessionId, 'Hazmi', '60123456789', ['GK', 'ST'])
    expect(result).toEqual({ placed: true, slotId: gk })

    const { data } = await anonClient().from('slots').select('player_name').eq('id', gk).single()
    expect(data).toMatchObject({ player_name: 'Hazmi' })

    // Placing must not also create a queue entry -- the invariant holds.
    const mine = await getMyWaitlistEntry(sessionId)
    expect(mine).toBeNull()
  })

  it('queues when no preferred position is free', async () => {
    const gk = slotId(ids, 'A', 'GK')
    await fillAllExcept(sessionId, gk)

    const result = await joinWaitlist(sessionId, 'Hazmi', '60123456789', ['ST'])
    expect(result.placed).toBe(false)

    const mine = await getMyWaitlistEntry(sessionId)
    expect(mine).toMatchObject({ positions: ['ST'] })
  })

  it('rejects joining twice from the same account with already_waitlisted', async () => {
    await fillAll(sessionId)
    await joinWaitlist(sessionId, 'Hazmi', '60123456789', ['GK'])

    try {
      await joinWaitlist(sessionId, 'Hazmi', '60123456789', ['ST'])
      expect.unreachable('joinWaitlist should have thrown on a second join')
    } catch (err) {
      expect(err).toBeInstanceOf(WaitlistActionError)
      if (err instanceof WaitlistActionError) {
        expect(err.code).toBe('already_waitlisted')
        expect(err.message).toBe('Anda dah dalam senarai tunggu.')
      }
    }
  })

  it('rejects joining while already holding a slot in the session (both directions of the invariant)', async () => {
    const gk = slotId(ids, 'A', 'GK')
    // This account claims a slot directly first.
    const claimed = await me.client.rpc('claim_slot', { p_slot_id: gk, p_name: 'Hazmi', p_phone: '60123456789' })
    expect(claimed.error).toBeNull()

    try {
      await joinWaitlist(sessionId, 'Hazmi', '60123456789', ['ST'])
      expect.unreachable('joinWaitlist should have thrown for an account already in a slot')
    } catch (err) {
      expect(err).toBeInstanceOf(WaitlistActionError)
      if (err instanceof WaitlistActionError) {
        expect(err.code).toBe('already_in_slot')
        expect(err.message).toBe('Anda dah ada slot dalam sesi ini.')
      }
    }

    // And the invariant's other direction: no waitlist row was created.
    expect(await getMyWaitlistEntry(sessionId)).toBeNull()
  })

  it('leaveWaitlist removes the entry, and a second leave reports not_waitlisted', async () => {
    await fillAll(sessionId)
    await joinWaitlist(sessionId, 'Hazmi', '60123456789', ['GK'])
    expect(await getMyWaitlistEntry(sessionId)).not.toBeNull()

    await leaveWaitlist(sessionId)
    expect(await getMyWaitlistEntry(sessionId)).toBeNull()

    try {
      await leaveWaitlist(sessionId)
      expect.unreachable('leaveWaitlist should have thrown the second time')
    } catch (err) {
      expect(err).toBeInstanceOf(WaitlistActionError)
      if (err instanceof WaitlistActionError) expect(err.code).toBe('not_waitlisted')
    }
  })

  it('listWaitlist returns the public queue in FIFO order', async () => {
    await fillAll(sessionId)
    const first = await other.client.rpc('join_waitlist', {
      p_session_id: sessionId,
      p_name: 'Faiz',
      p_phone: '60133000002',
      p_positions: ['GK'],
    })
    expect(first.error).toBeNull()

    // A short, real gap so created_at strictly orders the two rows even at
    // whatever timestamp precision the column stores.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await joinWaitlist(sessionId, 'Nabil', '60133000003', ['GK'])

    const list = await listWaitlist(sessionId)
    expect(list.map((e) => e.playerName)).toEqual(['Faiz', 'Nabil'])
  })

  it('an admin removes somebody else from the queue; a player cannot', async () => {
    await fillAll(sessionId)
    const joined = await other.client.rpc('join_waitlist', {
      p_session_id: sessionId, p_name: 'Amir', p_phone: '60198765432',
      p_positions: ['GK'],
    })
    expect(joined.error).toBeNull()

    // As a signed-in player who is not an admin: the delete is filtered out
    // by the admin-only RLS policy, so it matches no row and the entry
    // stays. (Authenticated holds the table grant; the policy is the guard.)
    await adminRemoveFromWaitlist(String(joined.data.waitlist_id))
    expect(await listWaitlist(sessionId)).toHaveLength(1)

    // An admin is an account: the allowlist row binds to the account that
    // holds the email (0019_accounts.sql). Removed again in afterEach.
    const allowlisted = await adminClient().from('admins').insert({ email: me.email, role: 'admin' })
    expect(allowlisted.error).toBeNull()

    await adminRemoveFromWaitlist(String(joined.data.waitlist_id))
    expect(await listWaitlist(sessionId)).toHaveLength(0)
  })
})
