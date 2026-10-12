import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { supabase } from '../../src/lib/supabase'
import { SlotActionError, adminReplaceWithWaitlist } from '../../src/data/slots'
import { adminClient, anonClient, deleteSession, seedSession, slotId } from '../helpers/localSupabase'

// The swap through the app's own wrapper, signed in as an admin the way the
// organiser is: the database decides everything (0022), so this checks the
// wrapper, the grants and the error mapping around it.

const AMIR = '66666666-6666-4666-8666-666666666666'
const ISAAC = '77777777-7777-4777-8777-777777777777'

describe('admin_replace_with_waitlist through the wrapper', () => {
  let sessionId = ''
  let ids: Record<string, string | undefined> = {}
  let organiser = { email: '', userId: '' }

  beforeEach(async () => {
    const seeded = await seedSession()
    sessionId = seeded.sessionId
    ids = seeded.slotIds

    const email = `organiser-${randomUUID()}@example.test`
    const password = 'organiser-test-password'
    const created = await adminClient().auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error !== null || created.data.user === null) throw new Error('createUser failed')
    organiser = { email, userId: created.data.user.id }
    const allowlisted = await adminClient().from('admins').insert({ email, role: 'admin' })
    if (allowlisted.error !== null) throw new Error(`allowlist failed: ${allowlisted.error.message}`)
    const signedIn = await supabase.auth.signInWithPassword({ email, password })
    if (signedIn.error !== null) throw new Error('sign-in failed')
  })

  afterEach(async () => {
    await supabase.auth.signOut()
    await adminClient().from('admins').delete().eq('email', organiser.email)
    await adminClient().auth.admin.deleteUser(organiser.userId)
    await deleteSession(sessionId)
  })

  it('puts the chosen queued player in, and the replaced one at the front of the queue', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const visitor = anonClient()
    await visitor.rpc('claim_slot', { p_slot_id: gk, p_name: 'Amir', p_phone: '60111110001', p_token: AMIR })
    // Every ST taken, so Isaac -- who only wants ST -- really is queued.
    for (const team of ['A', 'B', 'C']) {
      await adminClient()
        .from('slots')
        .update({ player_name: 'Filler', claim_token: randomUUID(), claimed_at: new Date().toISOString() })
        .eq('id', slotId(ids, team, 'ST'))
    }
    const joined = await visitor.rpc('join_waitlist', {
      p_session_id: sessionId,
      p_name: 'Isaac',
      p_phone: '60111110002',
      p_positions: ['ST'],
      p_token: ISAAC,
    })
    expect(joined.error).toBeNull()
    const queue = await adminClient().from('waitlist').select('id, player_name').eq('session_id', sessionId)
    const isaac = (queue.data ?? []).find((row) => row.player_name === 'Isaac')
    if (isaac === undefined || typeof isaac.id !== 'string') throw new Error('Isaac should be queued')

    const slot = await adminReplaceWithWaitlist(gk, isaac.id)
    expect(slot.playerName).toBe('Isaac')

    const after = await adminClient()
      .from('waitlist')
      .select('player_name, positions, claim_token')
      .eq('session_id', sessionId)
      .order('created_at')
    expect(after.data?.[0]).toMatchObject({ player_name: 'Amir', positions: ['GK'], claim_token: AMIR })
  })

  it('maps a refusal to its Malay copy', async () => {
    try {
      await adminReplaceWithWaitlist(slotId(ids, 'A', 'GK'), randomUUID())
      expect.unreachable('an empty slot must be refused')
    } catch (err) {
      expect(err).toBeInstanceOf(SlotActionError)
      if (err instanceof SlotActionError) {
        expect(err.code).toBe('slot_empty')
        expect(err.message).toBe('Slot ini kosong.')
      }
    }
  })
})
