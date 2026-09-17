import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { anonClient, deleteSession, seedSession, slotId } from '../helpers/localSupabase'
import { resetClaimTokenCache } from '../../src/lib/claimToken'
import { SlotActionError, claimSlot, getMySlotIds, releaseSlot, setSlotPaid } from '../../src/data/slots'

// A second "device": the wrapper functions always act as the current
// device (via getClaimToken()'s module-level cache), so a genuinely
// different claimant is modelled with a raw RPC call carrying an explicit
// token, exactly as the raw-RPC test file does.
const OTHER_TOKEN = '88888888-8888-4888-8888-888888888888'

describe('slot action wrappers against local postgres', () => {
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

  it('refuses a second slot on the same device, whatever name is used', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const st = slotId(ids, 'A', 'ST')
    await claimSlot(gk, 'Hazmi', '60123456789')

    try {
      await claimSlot(st, 'Someone Else', '60111112222')
      expect.unreachable('claimSlot should refuse a device that already holds a slot')
    } catch (cause: unknown) {
      expect(cause).toBeInstanceOf(SlotActionError)
      if (cause instanceof SlotActionError) expect(cause.code).toBe('already_in_slot')
    }

    const { data } = await anonClient().from('slots').select('player_name').eq('id', st).single()
    expect(data).toEqual({ player_name: null })
  })

  it('refuses a phone number that already holds a slot, even from a fresh device', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const st = slotId(ids, 'A', 'ST')
    await claimSlot(gk, 'Hazmi', '60123456789')

    // A second browser mints its own token, so the phone is the real guard.
    const second = await anonClient().rpc('claim_slot', {
      p_slot_id: st,
      p_name: 'Hazmi On Laptop',
      p_phone: '60123456789',
      p_token: OTHER_TOKEN,
    })
    expect(second.error?.message ?? '').toContain('phone_in_use')
  })

  it('lets the device claim again after releasing', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const st = slotId(ids, 'A', 'ST')
    await claimSlot(gk, 'Hazmi', '60123456789')
    await releaseSlot(gk)
    const second = await claimSlot(st, 'Hazmi', '60123456789')
    expect(second.playerName).toBe('Hazmi')
  })

  it('releaseSlot with a mismatched token rejects with wrong_token', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const claimed = await anonClient().rpc('claim_slot', { p_slot_id: gk, p_name: 'Isaac', p_phone: '60123456789', p_token: OTHER_TOKEN })
    expect(claimed.error).toBeNull()

    try {
      // This device's own (different) token does not match OTHER_TOKEN.
      await releaseSlot(gk)
      expect.unreachable('releaseSlot should have thrown for the wrong token')
    } catch (err) {
      expect(err).toBeInstanceOf(SlotActionError)
      if (err instanceof SlotActionError) expect(err.code).toBe('wrong_token')
    }
  })

  it('releaseSlot with the right token empties the slot', async () => {
    const gk = slotId(ids, 'A', 'GK')
    await claimSlot(gk, 'Hazmi', '60123456789')

    const released = await releaseSlot(gk)
    expect(released.playerName).toBeNull()
    expect(released.claimedAt).toBeNull()

    const mine = await getMySlotIds(sessionId)
    expect(mine.has(gk)).toBe(false)
  })

  it('setSlotPaid ticks and unticks this device\'s own slot', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const claimed = await claimSlot(gk, 'Hazmi', '60123456789')
    expect(claimed.paid).toBe(false)

    expect((await setSlotPaid(gk, true)).paid).toBe(true)
    const { data } = await anonClient().from('slots').select('paid').eq('id', gk).single()
    expect(data).toEqual({ paid: true })

    expect((await setSlotPaid(gk, false)).paid).toBe(false)
  })

  it('setSlotPaid on another device\'s slot rejects with wrong_token', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const claimed = await anonClient().rpc('claim_slot', { p_slot_id: gk, p_name: 'Isaac', p_phone: '60198765432', p_token: OTHER_TOKEN })
    expect(claimed.error).toBeNull()

    try {
      await setSlotPaid(gk, true)
      expect.unreachable('setSlotPaid should have thrown for the wrong token')
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

    const next = await anonClient().rpc('claim_slot', { p_slot_id: gk, p_name: 'Isaac', p_phone: '60198765432', p_token: OTHER_TOKEN })
    expect(next.error).toBeNull()
    const { data } = await anonClient().from('slots').select('paid').eq('id', gk).single()
    expect(data).toEqual({ paid: false })
  })

  it("getMySlotIds returns only this device's own slots, not another device's", async () => {
    const gk = slotId(ids, 'A', 'GK')
    const st = slotId(ids, 'A', 'ST')

    await claimSlot(gk, 'Hazmi', '60123456789')
    // Isaac is a different person, so a different number: one booking per
    // phone per session (0010_one_booking_per_person.sql).
    const other = await anonClient().rpc('claim_slot', { p_slot_id: st, p_name: 'Isaac', p_phone: '60198765432', p_token: OTHER_TOKEN })
    expect(other.error).toBeNull()

    const mine = await getMySlotIds(sessionId)
    expect(mine.has(gk)).toBe(true)
    expect(mine.has(st)).toBe(false)
  })
})
