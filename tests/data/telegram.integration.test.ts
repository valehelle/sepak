import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claimSlot } from '../../src/data/slots'
import { TelegramError, createTelegramLink, hasTelegramChat } from '../../src/data/telegram'
import { supabase } from '../../src/lib/supabase'
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

describe('telegram linking against local postgres', () => {
  let sessionId = ''
  let ids: Record<string, string | undefined> = {}

  let me: Player

  beforeEach(async () => {
    me = await newPlayer('me')
    await signInAppClientAs(supabase, me)
    const seeded = await seedSession()
    sessionId = seeded.sessionId
    ids = seeded.slotIds
  })

  afterEach(async () => {
    await supabase.auth.signOut()
    await adminClient().from('telegram_chats').delete().eq('claim_token', me.userId)
    await deleteSession(sessionId)
    await deletePlayer(me)
  })

  it('refuses an account with no place in a session', async () => {
    await expect(createTelegramLink()).rejects.toBeInstanceOf(TelegramError)
  })

  it('builds a t.me link carrying a code that is not the account id', async () => {
    await claimSlot(slotId(ids, 'A', 'GK'), 'Hazmi', '60123456789')

    const link = await createTelegramLink()
    expect(link).toMatch(/^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=[0-9a-f-]{36}$/)
    expect(link).not.toContain(me.userId)
  })

  it('reports the account as linked only after the code is claimed', async () => {
    await claimSlot(slotId(ids, 'A', 'GK'), 'Hazmi', '60123456789')
    const link = await createTelegramLink()
    const code = link.split('start=')[1] ?? ''

    expect(await hasTelegramChat()).toBe(false)

    // Standing in for the webhook, which is the only caller with this grant.
    const claimed = await adminClient().rpc('claim_telegram_link', { p_code: code, p_chat_id: 424242 })
    expect(claimed.error).toBeNull()
    expect(claimed.data).toBe(true)

    expect(await hasTelegramChat()).toBe(true)
  })

  it('never lets anon reach the webhook side of it', async () => {
    const linked = await anonClient().rpc('claim_telegram_link', {
      p_code: '00000000-0000-4000-8000-000000000000',
      p_chat_id: 1,
    })
    expect(linked.error?.message ?? '').toContain('permission denied')

    const targets = await anonClient().rpc('telegram_targets', { p_activity_id: 1 })
    expect(targets.error?.message ?? '').toContain('permission denied')
  })
})
