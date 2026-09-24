import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { adminClient, deleteSession, seedSession, slotId } from '../helpers/localSupabase'
import { resetClaimTokenCache } from '../../src/lib/claimToken'
import { measureClockOffset } from '../../src/data/clock'
import { SlotActionError, claimSlot } from '../../src/data/slots'
import { WaitlistActionError, joinWaitlist } from '../../src/data/waitlist'

describe('the opening time, against local postgres', () => {
  let sessionId = ''
  let ids: Record<string, string | undefined> = {}

  beforeEach(async () => {
    resetClaimTokenCache()
    const seeded = await seedSession({ opensAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
    sessionId = seeded.sessionId
    ids = seeded.slotIds
  })

  afterEach(async () => {
    await deleteSession(sessionId)
  })

  it('refuses a player claim before it, with the Malay copy', async () => {
    try {
      await claimSlot(slotId(ids, 'A', 'GK'), 'Early', '60123456789')
      expect.unreachable('a claim before opening should have been refused')
    } catch (err) {
      expect(err).toBeInstanceOf(SlotActionError)
      if (err instanceof SlotActionError) {
        expect(err.code).toBe('not_open_yet')
        expect(err.message).toBe('Belum dibuka. Tunggu kiraan tamat.')
      }
    }
  })

  it('refuses joining the queue before it', async () => {
    try {
      await joinWaitlist(sessionId, 'Early', '60123456789', ['GK'])
      expect.unreachable('joining the queue before opening should have been refused')
    } catch (err) {
      expect(err).toBeInstanceOf(WaitlistActionError)
      if (err instanceof WaitlistActionError) expect(err.code).toBe('not_open_yet')
    }
  })

  it('accepts the claim once the time is reached, with nothing run in between', async () => {
    const moved = await adminClient()
      .from('sessions')
      .update({ opens_at: new Date(Date.now() - 1000).toISOString() })
      .eq('id', sessionId)
    expect(moved.error).toBeNull()
    const slot = await claimSlot(slotId(ids, 'A', 'GK'), 'OnTime', '60123456789')
    expect(slot.playerName).toBe('OnTime')
  })

  it('refuses to move the time once it has passed, even for service_role', async () => {
    await adminClient().from('sessions').update({ opens_at: new Date(Date.now() - 1000).toISOString() }).eq('id', sessionId)
    const again = await adminClient()
      .from('sessions')
      .update({ opens_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
      .eq('id', sessionId)
    expect(again.error?.message).toContain('opens_locked')
  })

  it('answers the countdown clock for anyone', async () => {
    const offset = await measureClockOffset()
    // Same machine: the two clocks agree to well within a second.
    expect(Math.abs(offset)).toBeLessThan(1000)
  })
})
