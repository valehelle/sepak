import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  anonClient,
  deletePlayer,
  deleteSession,
  newPlayer,
  seedSession,
  signInAppClientAs,
  slotId,
  type Player,
} from '../helpers/localSupabase'
import { supabase } from '../../src/lib/supabase'
import {
  SlotActionError,
  claimSlot,
  getMySlotIds,
  moveSlot,
  releaseSlot,
  setSlotPaid,
} from '../../src/data/slots'

// The wrapper functions always act as whoever the app's singleton client
// is signed in as, so a genuinely different claimant is a second account
// on its own client, calling the RPCs directly.
describe('slot action wrappers against local postgres', () => {
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
    await deleteSession(sessionId)
    await deletePlayer(me)
    await deletePlayer(other)
  })

  it('claimSlot succeeds and returns a parsed Slot', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const slot = await claimSlot(gk, 'Hazmi', '60123456789')
    expect(slot).toMatchObject({ id: gk, sessionId, team: 'A', position: 'GK', playerName: 'Hazmi' })
    expect(slot.claimedAt).not.toBeNull()
  })

  it('claimSlot on an occupied slot rejects with slot_taken and its Malay copy', async () => {
    const gk = slotId(ids, 'A', 'GK')
    await claimSlot(gk, 'Hazmi', '60123456789')

    try {
      await claimSlot(gk, 'Isaac', '60123456789')
      expect.unreachable('claimSlot should have thrown on an occupied slot')
    } catch (err) {
      expect(err).toBeInstanceOf(SlotActionError)
      if (err instanceof SlotActionError) {
        expect(err.code).toBe('slot_taken')
        expect(err.message).toBe('Slot dah diambil.')
      }
    }
  })

  it('refuses a second slot on the same account, whatever name is used', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const st = slotId(ids, 'A', 'ST')
    await claimSlot(gk, 'Hazmi', '60123456789')

    try {
      await claimSlot(st, 'Someone Else', '60111112222')
      expect.unreachable('claimSlot should refuse an account that already holds a slot')
    } catch (cause: unknown) {
      expect(cause).toBeInstanceOf(SlotActionError)
      if (cause instanceof SlotActionError) expect(cause.code).toBe('already_in_slot')
    }

    const { data } = await anonClient().from('slots').select('player_name').eq('id', st).single()
    expect(data).toEqual({ player_name: null })
  })

  it('refuses a phone number that already holds a slot, even from another account', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const st = slotId(ids, 'A', 'ST')
    await claimSlot(gk, 'Hazmi', '60123456789')

    // A second account has its own id, so the phone is the real guard.
    const second = await other.client.rpc('claim_slot', {
      p_slot_id: st,
      p_name: 'Hazmi On Laptop',
      p_phone: '60123456789',
    })
    expect(second.error?.message ?? '').toContain('phone_in_use')
  })

  it('lets the account claim again after releasing', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const st = slotId(ids, 'A', 'ST')
    await claimSlot(gk, 'Hazmi', '60123456789')
    await releaseSlot(gk)
    const second = await claimSlot(st, 'Hazmi', '60123456789')
    expect(second.playerName).toBe('Hazmi')
  })

  it("releaseSlot on another account's slot rejects with wrong_token", async () => {
    const gk = slotId(ids, 'A', 'GK')
    const claimed = await other.client.rpc('claim_slot', { p_slot_id: gk, p_name: 'Isaac', p_phone: '60123456789' })
    expect(claimed.error).toBeNull()

    try {
      // The signed-in account is not the one that holds it.
      await releaseSlot(gk)
      expect.unreachable('releaseSlot should have thrown for a slot held by another account')
    } catch (err) {
      expect(err).toBeInstanceOf(SlotActionError)
      if (err instanceof SlotActionError) expect(err.code).toBe('wrong_token')
    }
  })

  it("releaseSlot on the account's own slot empties the slot", async () => {
    const gk = slotId(ids, 'A', 'GK')
    await claimSlot(gk, 'Hazmi', '60123456789')

    const released = await releaseSlot(gk)
    expect(released.playerName).toBeNull()
    expect(released.claimedAt).toBeNull()

    const mine = await getMySlotIds(sessionId)
    expect(mine.has(gk)).toBe(false)
  })

  it('setSlotPaid ticks and unticks this account\'s own slot', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const claimed = await claimSlot(gk, 'Hazmi', '60123456789')
    expect(claimed.paid).toBe(false)

    expect((await setSlotPaid(gk, true)).paid).toBe(true)
    const { data } = await anonClient().from('slots').select('paid').eq('id', gk).single()
    expect(data).toEqual({ paid: true })

    expect((await setSlotPaid(gk, false)).paid).toBe(false)
  })

  it('setSlotPaid on another account\'s slot rejects with wrong_token', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const claimed = await other.client.rpc('claim_slot', { p_slot_id: gk, p_name: 'Isaac', p_phone: '60198765432' })
    expect(claimed.error).toBeNull()

    try {
      await setSlotPaid(gk, true)
      expect.unreachable('setSlotPaid should have thrown for a slot held by another account')
    } catch (err) {
      expect(err).toBeInstanceOf(SlotActionError)
      if (err instanceof SlotActionError) expect(err.code).toBe('wrong_token')
    }
  })

  it('releasing clears the tick, so the next occupant starts unpaid', async () => {
    const gk = slotId(ids, 'A', 'GK')
    await claimSlot(gk, 'Hazmi', '60123456789')
    await setSlotPaid(gk, true)
    await releaseSlot(gk)

    const next = await other.client.rpc('claim_slot', { p_slot_id: gk, p_name: 'Isaac', p_phone: '60198765432' })
    expect(next.error).toBeNull()
    const { data } = await anonClient().from('slots').select('paid').eq('id', gk).single()
    expect(data).toEqual({ paid: false })
  })

  it("getMySlotIds returns only this account's own slots, not another account's", async () => {
    const gk = slotId(ids, 'A', 'GK')
    const st = slotId(ids, 'A', 'ST')

    await claimSlot(gk, 'Hazmi', '60123456789')
    // Isaac is a different person, so a different number: one booking per
    // phone per session (0010_one_booking_per_person.sql).
    const isaacClaim = await other.client.rpc('claim_slot', { p_slot_id: st, p_name: 'Isaac', p_phone: '60198765432' })
    expect(isaacClaim.error).toBeNull()

    const mine = await getMySlotIds(sessionId)
    expect(mine.has(gk)).toBe(true)
    expect(mine.has(st)).toBe(false)
  })

  it('moveSlot changes position and leaves the old one empty', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const st = slotId(ids, 'C', 'ST')
    await claimSlot(gk, 'Hazmi', '60123456789')

    const moved = await moveSlot(gk, st)
    expect(moved).toMatchObject({ id: st, team: 'C', position: 'ST', playerName: 'Hazmi' })

    const mine = await getMySlotIds(sessionId)
    expect(mine.has(st)).toBe(true)
    expect(mine.has(gk)).toBe(false)
    const { data } = await anonClient().from('slots').select('player_name').eq('id', gk).single()
    expect(data).toEqual({ player_name: null })
  })

  it('moveSlot keeps the paid tick, because the same person is still playing', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const st = slotId(ids, 'C', 'ST')
    await claimSlot(gk, 'Hazmi', '60123456789')
    await setSlotPaid(gk, true)

    const moved = await moveSlot(gk, st)
    expect(moved.paid).toBe(true)
  })

  it('moveSlot refuses a slot somebody else holds, with its Malay copy', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const st = slotId(ids, 'A', 'ST')
    await claimSlot(gk, 'Hazmi', '60123456789')
    const isaacClaim = await other.client.rpc('claim_slot', { p_slot_id: st, p_name: 'Isaac', p_phone: '60198765432' })
    expect(isaacClaim.error).toBeNull()

    try {
      await moveSlot(gk, st)
      expect.unreachable('moveSlot should have thrown on an occupied destination')
    } catch (err) {
      expect(err).toBeInstanceOf(SlotActionError)
      if (err instanceof SlotActionError) {
        expect(err.code).toBe('slot_taken')
        expect(err.message).toBe('Slot dah diambil.')
      }
    }
  })

  it('moveSlot refuses to move a slot this account does not hold', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const st = slotId(ids, 'A', 'ST')
    const isaacClaim = await other.client.rpc('claim_slot', { p_slot_id: gk, p_name: 'Isaac', p_phone: '60198765432' })
    expect(isaacClaim.error).toBeNull()

    try {
      await moveSlot(gk, st)
      expect.unreachable('moveSlot should have thrown on somebody else\'s slot')
    } catch (err) {
      expect(err).toBeInstanceOf(SlotActionError)
      if (err instanceof SlotActionError) expect(err.code).toBe('wrong_token')
    }
  })
})
