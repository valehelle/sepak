import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WAITLIST_COLUMNS } from '../../src/data/waitlist'
import { adminClient, anonClient, deleteSession, seedSession, slotId } from '../helpers/localSupabase'

const TOKEN_A = '11111111-1111-4111-8111-111111111111'
const TOKEN_B = '22222222-2222-4222-8222-222222222222'
const FILLER_TOKEN = '99999999-9999-4999-8999-999999999999'

/** Fills every slot except the given one, so it becomes the sole free slot
 *  matching whatever position a test cares about. There are three GK slots
 *  (one per team) and so on for every position -- a preference like ['GK']
 *  only becomes genuinely scarce once all three are taken. */
async function fillAllExcept(sessionId: string, exceptSlotId: string): Promise<void> {
  const { error } = await adminClient()
    .from('slots')
    .update({ player_name: 'Filler', claim_token: FILLER_TOKEN, claimed_at: new Date().toISOString() })
    .eq('session_id', sessionId)
    .neq('id', exceptSlotId)
  if (error !== null) throw new Error(`fillAllExcept failed: ${error.message}`)
}

/** Fills every one of the 33 slots -- guarantees any join_waitlist call
 *  queues rather than claims, regardless of which positions it prefers. */
async function fillAll(sessionId: string): Promise<void> {
  const { error } = await adminClient()
    .from('slots')
    .update({ player_name: 'Filler', claim_token: FILLER_TOKEN, claimed_at: new Date().toISOString() })
    .eq('session_id', sessionId)
  if (error !== null) throw new Error(`fillAll failed: ${error.message}`)
}

/** Seeds a queue entry directly, bypassing join_waitlist -- used by the
 *  trigger-focused tests below, which are about fill_from_waitlist, not
 *  about join_waitlist's own immediate-claim-vs-queue decision. */
async function seedWaitlistEntry(sessionId: string, name: string, positions: string[], token: string): Promise<void> {
  const { error } = await adminClient()
    .from('waitlist')
    .insert({ session_id: sessionId, player_name: name, claim_token: token, positions })
  if (error !== null) throw new Error(`seedWaitlistEntry failed: ${error.message}`)
}

function join(client: ReturnType<typeof anonClient>, sessionId: string, name: string, positions: string[], token: string) {
  return client.rpc('join_waitlist', { p_session_id: sessionId, p_name: name, p_positions: positions, p_token: token })
}

describe('waitlist RPCs against local postgres', () => {
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

  it('lets exactly one of two concurrent join_waitlist calls claim the one free slot; the other queues', async () => {
    const gk = slotId(ids, 'A', 'GK')
    await fillAllExcept(sessionId, gk)

    const [first, second] = await Promise.all([
      join(anonClient(), sessionId, 'Hazmi', ['GK'], TOKEN_A),
      join(anonClient(), sessionId, 'Isaac', ['GK'], TOKEN_B),
    ])

    expect(first.error).toBeNull()
    expect(second.error).toBeNull()

    const results = [first.data, second.data] as { placed: boolean; slot_id?: string; waitlist_id?: string }[]
    const placed = results.filter((r) => r.placed === true)
    const queued = results.filter((r) => r.placed === false)

    // Exactly one placed, exactly one queued -- never both, never neither.
    expect(placed).toHaveLength(1)
    expect(queued).toHaveLength(1)
    expect(placed[0]?.slot_id).toBe(gk)

    const { data: slotRow } = await client.from('slots').select('player_name').eq('id', gk).single()
    expect(['Hazmi', 'Isaac']).toContain((slotRow as { player_name: string | null } | null)?.player_name)

    const { data: waitlistRows } = await adminClient().from('waitlist').select('player_name').eq('session_id', sessionId)
    expect(waitlistRows).toHaveLength(1)
  })

  it('claims immediately when a preferred position is already free, earliest in pitch order', async () => {
    const cb1 = slotId(ids, 'A', 'CB1')
    const cb2 = slotId(ids, 'A', 'CB2')
    await fillAllExcept(sessionId, cb1)
    // Free CB2 too, so both CB1 and CB2 match -- pitch order (CB1 before
    // CB2) must pick CB1.
    await adminClient().from('slots').update({ player_name: null, claim_token: null, claimed_at: null }).eq('id', cb2)

    const result = await join(client, sessionId, 'Hazmi', ['CB1', 'CB2'], TOKEN_A)
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({ placed: true, slot_id: cb1 })
  })

  it('respects FIFO order: the earliest matching entry is placed first', async () => {
    const gk = slotId(ids, 'A', 'GK')
    await fillAll(sessionId)

    const first = await join(client, sessionId, 'Faiz', ['GK'], TOKEN_A)
    expect(first.data).toMatchObject({ placed: false })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await join(anonClient(), sessionId, 'Nabil', ['GK'], TOKEN_B)
    expect(second.data).toMatchObject({ placed: false })

    // Release GK: the trigger must place Faiz, not Nabil.
    await adminClient().from('slots').update({ player_name: null, claim_token: null, claimed_at: null }).eq('id', gk)

    const { data: slotRow } = await client.from('slots').select('player_name').eq('id', gk).single()
    expect(slotRow).toMatchObject({ player_name: 'Faiz' })

    const { data: remaining } = await adminClient().from('waitlist').select('player_name').eq('session_id', sessionId)
    expect(remaining).toEqual([{ player_name: 'Nabil' }])
  })

  it('does not let a narrower-but-later entry jump an earlier broader one', async () => {
    const gk = slotId(ids, 'A', 'GK')
    await fillAll(sessionId)

    // Faiz is broad (any position, GK included) and first; Nabil is
    // GK-specific and later.
    const first = await join(client, sessionId, 'Faiz', ['GK', 'ST', 'MC'], TOKEN_A)
    expect(first.data).toMatchObject({ placed: false })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await join(anonClient(), sessionId, 'Nabil', ['GK'], TOKEN_B)
    expect(second.data).toMatchObject({ placed: false })

    await adminClient().from('slots').update({ player_name: null, claim_token: null, claimed_at: null }).eq('id', gk)

    const { data: slotRow } = await client.from('slots').select('player_name').eq('id', gk).single()
    expect(slotRow).toMatchObject({ player_name: 'Faiz' })
  })

  it('cannot read claim_token as anon, even with an explicit column list', async () => {
    const wide = await client.from('waitlist').select(`${WAITLIST_COLUMNS}, claim_token`).eq('session_id', sessionId)
    expect(wide.error).not.toBeNull()
  })

  it("select('*') on waitlist is rejected for anon (column-level grant excludes claim_token)", async () => {
    const { error, status } = await client.from('waitlist').select('*').eq('session_id', sessionId)
    expect(error).not.toBeNull()
    expect(status).toBe(401)
    expect(error?.code).toBe('42501')
  })

  it('reads the allowed columns fine via the shared WAITLIST_COLUMNS list', async () => {
    await seedWaitlistEntry(sessionId, 'Hazmi', ['GK'], TOKEN_A)
    const { data, error } = await client.from('waitlist').select(WAITLIST_COLUMNS).eq('session_id', sessionId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('cannot write waitlist directly as anon', async () => {
    const { error: insertError } = await client
      .from('waitlist')
      .insert({ session_id: sessionId, player_name: 'Rogue', claim_token: TOKEN_A, positions: ['GK'] })
    expect(insertError).not.toBeNull()

    await seedWaitlistEntry(sessionId, 'Hazmi', ['GK'], TOKEN_A)
    const { data: rows } = await adminClient().from('waitlist').select('id').eq('session_id', sessionId)
    const row = (rows ?? [])[0] as { id: string } | undefined
    if (row === undefined) throw new Error('expected a seeded waitlist row')

    const { error: updateError } = await client.from('waitlist').update({ player_name: 'Rogue' }).eq('id', row.id)
    expect(updateError).not.toBeNull()

    const { error: deleteError } = await client.from('waitlist').delete().eq('id', row.id)
    expect(deleteError).not.toBeNull()
  })

  it('rejects a positions array outside the eleven positions or empty (table check constraints)', async () => {
    const admin = adminClient()
    const empty = await admin.from('waitlist').insert({
      session_id: sessionId,
      player_name: 'Rogue',
      claim_token: TOKEN_A,
      positions: [],
    })
    expect(empty.error).not.toBeNull()

    const bogus = await admin.from('waitlist').insert({
      session_id: sessionId,
      player_name: 'Rogue',
      claim_token: TOKEN_A,
      positions: ['SWEEPER'],
    })
    expect(bogus.error).not.toBeNull()

    const tooMany = await admin.from('waitlist').insert({
      session_id: sessionId,
      player_name: 'Rogue',
      claim_token: TOKEN_A,
      positions: ['GK', 'GK', 'GK', 'GK', 'GK', 'GK', 'GK', 'GK', 'GK', 'GK', 'GK', 'LB'],
    })
    expect(tooMany.error).not.toBeNull()
  })

  it('join_waitlist rejects an invalid positions array with invalid_positions', async () => {
    const result = await join(client, sessionId, 'Hazmi', [], TOKEN_A)
    expect(result.error?.message).toContain('invalid_positions')

    const bogus = await join(client, sessionId, 'Hazmi', ['SWEEPER'], TOKEN_A)
    expect(bogus.error?.message).toContain('invalid_positions')
  })

  it('join_waitlist rejects a closed session with session_closed', async () => {
    await adminClient().from('sessions').update({ status: 'closed' }).eq('id', sessionId)
    const result = await join(client, sessionId, 'Hazmi', ['GK'], TOKEN_A)
    expect(result.error?.message).toContain('session_closed')
  })

  it('auto-fill does not fire on a closed session', async () => {
    const gk = slotId(ids, 'A', 'GK')
    await fillAllExcept(sessionId, gk)
    await adminClient()
      .from('slots')
      .update({ player_name: 'Holder', claim_token: TOKEN_A, claimed_at: new Date().toISOString() })
      .eq('id', gk)
    await seedWaitlistEntry(sessionId, 'Faiz', ['GK'], TOKEN_B)

    await adminClient().from('sessions').update({ status: 'closed' }).eq('id', sessionId)
    // The admin path: a direct table update, same as adminClearSlot in the app.
    await adminClient().from('slots').update({ player_name: null, claim_token: null, claimed_at: null }).eq('id', gk)

    const { data: slotRow } = await adminClient().from('slots').select('player_name').eq('id', gk).single()
    expect(slotRow).toMatchObject({ player_name: null })

    const { data: waitlistRows } = await adminClient().from('waitlist').select('id').eq('session_id', sessionId)
    expect(waitlistRows).toHaveLength(1)
  })

  it("auto-fill fires on release_slot, on move_slot's vacated source, and on an admin clear", async () => {
    const gk = slotId(ids, 'A', 'GK')
    const st = slotId(ids, 'A', 'ST')
    const lb = slotId(ids, 'A', 'LB')
    const rb = slotId(ids, 'A', 'RB')

    async function occupy(id: string, token: string) {
      await adminClient()
        .from('slots')
        .update({ player_name: 'Holder', claim_token: token, claimed_at: new Date().toISOString() })
        .eq('id', id)
    }

    // release_slot
    const releaseToken = '55555555-5555-4555-8555-555555555555'
    await occupy(gk, releaseToken)
    await seedWaitlistEntry(sessionId, 'Faiz', ['GK'], TOKEN_A)
    const released = await client.rpc('release_slot', { p_slot_id: gk, p_token: releaseToken })
    expect(released.error).toBeNull()
    const { data: gkRow } = await adminClient().from('slots').select('player_name').eq('id', gk).single()
    expect(gkRow).toMatchObject({ player_name: 'Faiz' })

    // move_slot's vacated source
    const moveToken = '66666666-6666-4666-8666-666666666666'
    await occupy(st, moveToken)
    await seedWaitlistEntry(sessionId, 'Nabil', ['ST'], TOKEN_B)
    const moved = await client.rpc('move_slot', { p_from: st, p_to: lb, p_token: moveToken })
    expect(moved.error).toBeNull()
    const { data: stRow } = await adminClient().from('slots').select('player_name').eq('id', st).single()
    expect(stRow).toMatchObject({ player_name: 'Nabil' })

    // admin clear (a direct table update, not an RPC)
    const clearToken = '88888888-8888-4888-8888-888888888888'
    await occupy(rb, clearToken)
    await seedWaitlistEntry(sessionId, 'Amir', ['RB'], '77777777-7777-4777-8777-777777777777')
    await adminClient().from('slots').update({ player_name: null, claim_token: null, claimed_at: null }).eq('id', rb)
    const { data: rbRow } = await adminClient().from('slots').select('player_name').eq('id', rb).single()
    expect(rbRow).toMatchObject({ player_name: 'Amir' })
  })

  it('does not recurse: the trigger fires once per release even with two matching queued entries', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const holderToken = '55555555-5555-4555-8555-555555555555'
    await adminClient()
      .from('slots')
      .update({ player_name: 'Holder', claim_token: holderToken, claimed_at: new Date().toISOString() })
      .eq('id', gk)

    await seedWaitlistEntry(sessionId, 'Faiz', ['GK'], TOKEN_A)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await seedWaitlistEntry(sessionId, 'Nabil', ['GK'], TOKEN_B)

    await client.rpc('release_slot', { p_slot_id: gk, p_token: holderToken })

    // If the trigger recursed, its own write (null -> non-null) would fire
    // itself again looking for a second match, and Nabil would also be
    // consumed (or the statement would error with runaway recursion). It
    // must not: exactly Faiz is placed, and Nabil is still queued.
    const { data: gkRow } = await adminClient().from('slots').select('player_name').eq('id', gk).single()
    expect(gkRow).toMatchObject({ player_name: 'Faiz' })

    const { data: remaining } = await adminClient().from('waitlist').select('player_name').eq('session_id', sessionId)
    expect(remaining).toEqual([{ player_name: 'Nabil' }])
  })
})
