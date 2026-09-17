import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { anonClient, deleteSession, seedSession, slotId } from '../helpers/localSupabase'
import { resetClaimTokenCache } from '../../src/lib/claimToken'
import { SlotActionError, claimSlot, getMySlotIds, releaseSlot } from '../../src/data/slots'

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

  it("getMySlotIds returns only this device's own slots, not another device's", async () => {
    const gk = slotId(ids, 'A', 'GK')
    const st = slotId(ids, 'A', 'ST')

    await claimSlot(gk, 'Hazmi', '60123456789')
    const other = await anonClient().rpc('claim_slot', { p_slot_id: st, p_name: 'Isaac', p_phone: '60123456789', p_token: OTHER_TOKEN })
    expect(other.error).toBeNull()

    const mine = await getMySlotIds(sessionId)
    expect(mine.has(gk)).toBe(true)
    expect(mine.has(st)).toBe(false)
  })
})
