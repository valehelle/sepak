import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { supabase } from '../../src/lib/supabase'
import { attachReceipt, receiptLink, uploadReceipt } from '../../src/data/receipts'
import { deleteSession as deleteSessionWithReceipts } from '../../src/data/sessions'
import {
  adminClient,
  deletePlayer,
  deleteSession,
  newPlayer,
  seedSession,
  signInAppClientAs,
  slotId,
  type Player,
} from '../helpers/localSupabase'

// Receipts against the real storage service: the policies in
// 0021_receipts.sql are only worth what storage actually enforces.

const IMAGE = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])], { type: 'image/jpeg' })

describe('receipts against local storage', () => {
  let sessionId = ''
  let ids: Record<string, string | undefined> = {}
  const players: Player[] = []
  const adminEmails: string[] = []

  async function player(label: string): Promise<Player> {
    const created = await newPlayer(label)
    players.push(created)
    return created
  }

  beforeEach(async () => {
    const seeded = await seedSession()
    sessionId = seeded.sessionId
    ids = seeded.slotIds
  })

  afterEach(async () => {
    await supabase.auth.signOut()
    for (const email of adminEmails.splice(0)) await adminClient().from('admins').delete().eq('email', email)
    await deleteSession(sessionId).catch(() => undefined)
    for (const created of players.splice(0)) await deletePlayer(created)
  })

  it('uploads into the owner\'s slot, ticks paid, and is readable by the owner', async () => {
    const amir = await player('amir')
    const gk = slotId(ids, 'A', 'GK')
    await signInAppClientAs(supabase, amir)
    const claimed = await supabase.rpc('claim_slot', { p_slot_id: gk, p_name: 'Amir', p_phone: '60123450001' })
    expect(claimed.error).toBeNull()

    const path = await uploadReceipt({ id: gk, sessionId }, IMAGE)
    const slot = await attachReceipt(gk, path)
    expect(slot.paid).toBe(true)
    expect(slot.receiptPath).toBe(path)

    const link = await receiptLink(path)
    const response = await fetch(link)
    expect(response.ok).toBe(true)
  })

  it('refuses another player both the upload and the download', async () => {
    const amir = await player('amir')
    const bella = await player('bella')
    const gk = slotId(ids, 'A', 'GK')
    await amir.client.rpc('claim_slot', { p_slot_id: gk, p_name: 'Amir', p_phone: '60123450002' })

    const intruding = await bella.client.storage
      .from('receipts')
      .upload(`${sessionId}/${gk}/sneaky.jpg`, IMAGE, { contentType: 'image/jpeg' })
    expect(intruding.error).not.toBeNull()

    const path = `${sessionId}/${gk}/real.jpg`
    const uploaded = await amir.client.storage.from('receipts').upload(path, IMAGE, { contentType: 'image/jpeg' })
    expect(uploaded.error).toBeNull()

    const peek = await bella.client.storage.from('receipts').createSignedUrl(path, 60)
    expect(peek.error).not.toBeNull()
  })

  it('lets an admin read any receipt, and deleting the session removes them', async () => {
    const amir = await player('amir')
    const organiser = await player('organiser')
    const inserted = await adminClient().from('admins').insert({ email: organiser.email, role: 'admin' })
    expect(inserted.error).toBeNull()
    adminEmails.push(organiser.email)

    const gk = slotId(ids, 'A', 'GK')
    await amir.client.rpc('claim_slot', { p_slot_id: gk, p_name: 'Amir', p_phone: '60123450003' })
    const path = `${sessionId}/${gk}/resit.jpg`
    await amir.client.storage.from('receipts').upload(path, IMAGE, { contentType: 'image/jpeg' })

    const signed = await organiser.client.storage.from('receipts').createSignedUrl(path, 60)
    expect(signed.error).toBeNull()

    await signInAppClientAs(supabase, organiser)
    await deleteSessionWithReceipts(sessionId)
    const left = await adminClient().storage.from('receipts').list(`${sessionId}/${gk}`)
    expect(left.data ?? []).toHaveLength(0)
  })
})
