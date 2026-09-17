import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getClaimToken, resetClaimTokenCache } from '../../src/lib/claimToken'
import {
  WaitlistActionError,
  getMyWaitlistEntry,
  joinWaitlist,
  leaveWaitlist,
  listWaitlist,
} from '../../src/data/waitlist'
import { adminClient, anonClient, deleteSession, seedSession, slotId } from '../helpers/localSupabase'

// A second "device": the wrapper functions always act as the current
// device (via getClaimToken()'s module-level cache), so a genuinely
// different claimant is modelled with a raw RPC call carrying an explicit
// token, exactly as slotActions.integration.test.ts does.
const OTHER_TOKEN = '77777777-7777-4777-8777-777777777777'

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

  beforeEach(async () => {
    resetClaimTokenCache()
    const seeded = await seedSession()
    sessionId = seeded.sessionId
    ids = seeded.slotIds
  })

  afterEach(async () => {
    await deleteSession(sessionId)
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

  it('rejects joining twice from the same device with already_waitlisted', async () => {
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
    // This device (the wrapper's cached token) claims a slot directly first.
    const claimed = await anonClient().rpc('claim_slot', { p_slot_id: gk, p_name: 'Hazmi', p_phone: '60123456789', p_token: getClaimToken() })
    expect(claimed.error).toBeNull()

    try {
      await joinWaitlist(sessionId, 'Hazmi', '60123456789', ['ST'])
      expect.unreachable('joinWaitlist should have thrown for a device already in a slot')
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
    const first = await anonClient().rpc('join_waitlist', {
      p_session_id: sessionId,
      p_name: 'Faiz',
      p_phone: '60133000002',
      p_positions: ['GK'],
      p_token: OTHER_TOKEN,
    })
    expect(first.error).toBeNull()

    // A short, real gap so created_at strictly orders the two rows even at
    // whatever timestamp precision the column stores.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await joinWaitlist(sessionId, 'Nabil', '60133000003', ['GK'])

    const list = await listWaitlist(sessionId)
    expect(list.map((e) => e.playerName)).toEqual(['Faiz', 'Nabil'])
  })
})
