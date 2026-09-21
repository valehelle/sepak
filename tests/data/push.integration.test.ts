import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hasPushSubscription } from '../../src/data/push'
import { claimSlot } from '../../src/data/slots'
import { getClaimToken, resetClaimTokenCache } from '../../src/lib/claimToken'
import { adminClient, anonClient, deleteSession, seedSession, slotId } from '../helpers/localSupabase'

// subscribeToPush() itself cannot run here -- it needs Notification,
// a service worker and a real push service, none of which exist in node.
// What is testable, and worth testing, is the layer underneath it: the RPCs
// it calls, and who is allowed to call them.
const ENDPOINT = 'https://push.example.test/integration-1'

describe('push subscriptions against local postgres', () => {
  let sessionId = ''
  let ids: Record<string, string | undefined> = {}

  beforeEach(async () => {
    resetClaimTokenCache()
    const seeded = await seedSession()
    sessionId = seeded.sessionId
    ids = seeded.slotIds
  })

  afterEach(async () => {
    await adminClient().from('push_subscriptions').delete().eq('endpoint', ENDPOINT)
    await deleteSession(sessionId)
  })

  it('reports no subscription for a fresh device', async () => {
    expect(await hasPushSubscription()).toBe(false)
  })

  it('stores a subscription for a device that holds a slot, and reads it back', async () => {
    await claimSlot(slotId(ids, 'A', 'GK'), 'Hazmi', '60123456789')

    const saved = await anonClient().rpc('save_push_subscription', {
      p_token: getClaimToken(),
      p_endpoint: ENDPOINT,
      p_p256dh: 'p256dh-key',
      p_auth: 'auth-key',
      p_user_agent: 'vitest',
    })
    expect(saved.error).toBeNull()

    expect(await hasPushSubscription()).toBe(true)
  })

  it('refuses a device that has booked nothing', async () => {
    const { error } = await anonClient().rpc('save_push_subscription', {
      p_token: '55555555-5555-4555-8555-555555555555',
      p_endpoint: ENDPOINT,
      p_p256dh: 'k',
      p_auth: 'a',
    })
    expect(error?.message ?? '').toContain('not_in_session')
  })

  it('never lets anon read an endpoint back, which is a push capability', async () => {
    const { error } = await anonClient().from('push_subscriptions').select('endpoint')
    expect(error).not.toBeNull()
  })

  it('never lets anon read push targets or drop a subscription', async () => {
    const targets = await anonClient().rpc('push_targets', { p_activity_id: 1 })
    expect(targets.error?.message ?? '').toContain('permission denied')

    const dropped = await anonClient().rpc('drop_push_subscription', { p_endpoint: ENDPOINT })
    expect(dropped.error?.message ?? '').toContain('permission denied')
  })

  it('lets service_role read targets, which is how the Edge Function works', async () => {
    // No promotion here, so no rows -- the point is that the call is allowed
    // at all. The message it builds is asserted in supabase/tests/push_test.sql.
    const { data, error } = await adminClient().rpc('push_targets', { p_activity_id: 1 })
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})
