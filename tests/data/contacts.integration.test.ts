import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { adminClient, anonClient, deleteSession, seedSession, slotId } from '../helpers/localSupabase'
import { resetClaimTokenCache } from '../../src/lib/claimToken'
import { SlotActionError, claimSlot } from '../../src/data/slots'
import { ContactError, getContactPhone } from '../../src/data/contacts'

describe('contacts against local postgres', () => {
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

  it('claimSlot stores the phone where only service_role can see it', async () => {
    const gk = slotId(ids, 'A', 'GK')
    await claimSlot(gk, 'Hazmi', '60123456789')

    const { data, error } = await adminClient().from('contacts').select('phone').eq('slot_id', gk).single()
    expect(error).toBeNull()
    expect(data).toEqual({ phone: '60123456789' })
  })

  it('rejects a phone that is not in stored form with the Malay copy', async () => {
    const gk = slotId(ids, 'A', 'GK')
    try {
      await claimSlot(gk, 'Hazmi', '012-345 6789')
      expect.unreachable('claimSlot should reject an unnormalised phone')
    } catch (cause: unknown) {
      expect(cause).toBeInstanceOf(SlotActionError)
      if (cause instanceof SlotActionError) {
        expect(cause.code).toBe('invalid_phone')
        expect(cause.message).toContain('Nombor telefon tak sah')
      }
    }
  })

  it('anon cannot read contacts at all, not even an empty list', async () => {
    const { error } = await anonClient().from('contacts').select('phone')
    expect(error).not.toBeNull()
  })

  it('anon cannot call contact_phone (no execute grant)', async () => {
    const gk = slotId(ids, 'A', 'GK')
    await claimSlot(gk, 'Hazmi', '60123456789')
    // The app's client is anon here: the RPC must be refused outright, so
    // the wrapper surfaces an error rather than a number.
    await expect(getContactPhone({ slotId: gk })).rejects.toBeInstanceOf(ContactError)
  })

  it('contact_phone is granted to authenticated only -- not even service_role', async () => {
    const { data, error } = await adminClient().rpc('contact_phone', { p_slot_id: slotId(ids, 'A', 'ST') })
    expect(error?.message ?? '').toContain('permission denied')
    expect(data).toBeNull()
  })
})
