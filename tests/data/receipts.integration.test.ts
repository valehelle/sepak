import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetClaimTokenCache } from '../../src/lib/claimToken'
import { sendReceipt } from '../../src/data/receipts'
import { SlotActionError, claimSlot } from '../../src/data/slots'
import { adminClient, anonClient, deleteSession, localStatus, seedSession, slotId } from '../helpers/localSupabase'

// Receipts through the real `receipt` Edge Function and storage service:
// what 0021_receipts.sql promises is only worth what those two enforce.
// Needs the functions served locally (`supabase functions serve`).

const IMAGE = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])], { type: 'image/jpeg' })

async function signedInAdmin(): Promise<{ client: ReturnType<typeof anonClient>; email: string; userId: string }> {
  const email = `organiser-${randomUUID()}@example.test`
  const password = 'organiser-test-password'
  const created = await adminClient().auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error !== null || created.data.user === null) throw new Error('createUser failed')
  const allowlisted = await adminClient().from('admins').insert({ email, role: 'admin' })
  if (allowlisted.error !== null) throw new Error(`allowlist failed: ${allowlisted.error.message}`)
  const client = anonClient()
  const signedIn = await client.auth.signInWithPassword({ email, password })
  if (signedIn.error !== null) throw new Error('sign-in failed')
  return { client, email, userId: created.data.user.id }
}

describe('receipts through the Edge Function', () => {
  let sessionId = ''
  let ids: Record<string, string | undefined> = {}
  const cleanups: (() => Promise<unknown>)[] = []

  beforeEach(async () => {
    resetClaimTokenCache()
    const seeded = await seedSession()
    sessionId = seeded.sessionId
    ids = seeded.slotIds
  })

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup()
    const folders = await adminClient().storage.from('receipts').list(sessionId)
    for (const folder of folders.data ?? []) {
      const files = await adminClient().storage.from('receipts').list(`${sessionId}/${folder.name}`)
      const paths = (files.data ?? []).map((file) => `${sessionId}/${folder.name}/${file.name}`)
      if (paths.length > 0) await adminClient().storage.from('receipts').remove(paths)
    }
    await deleteSession(sessionId)
  })

  it('stores the receipt for the slot\'s own browser, and ticks paid', async () => {
    const gk = slotId(ids, 'A', 'GK')
    await claimSlot(gk, 'Hazmi', '60123456789')
    const slot = await sendReceipt(gk, IMAGE)
    expect(slot.paid).toBe(true)
    expect(slot.receiptPath?.startsWith(`${sessionId}/${gk}/`)).toBe(true)

    const stored = await adminClient().storage.from('receipts').list(`${sessionId}/${gk}`)
    expect(stored.data ?? []).toHaveLength(1)
  })

  it('refuses another browser, and stores nothing', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const owner = anonClient()
    await owner.rpc('claim_slot', {
      p_slot_id: gk,
      p_name: 'Amir',
      p_phone: '60123456780',
      p_token: '44444444-4444-4444-8444-444444444444',
    })

    try {
      await sendReceipt(gk, IMAGE)
      expect.unreachable('another browser must not attach a receipt')
    } catch (err) {
      expect(err).toBeInstanceOf(SlotActionError)
      if (err instanceof SlotActionError) expect(err.code).toBe('wrong_token')
    }
    const stored = await adminClient().storage.from('receipts').list(`${sessionId}/${gk}`)
    expect(stored.data ?? []).toHaveLength(0)
  })

  it('refuses something that is not an image', async () => {
    const gk = slotId(ids, 'A', 'GK')
    await claimSlot(gk, 'Hazmi', '60123456789')
    const response = await fetch(`${localStatus.API_URL}/functions/v1/receipt`, {
      method: 'POST',
      headers: { apikey: localStatus.ANON_KEY },
      body: (() => {
        const form = new FormData()
        form.append('slot_id', gk)
        form.append('token', '55555555-5555-4555-8555-555555555555')
        form.append('file', new Blob(['<script>'], { type: 'text/html' }), 'x.html')
        return form
      })(),
    })
    expect(response.status).toBe(400)
  })

  it('lets an admin open a receipt, and nobody else', async () => {
    const gk = slotId(ids, 'A', 'GK')
    await claimSlot(gk, 'Hazmi', '60123456789')
    const slot = await sendReceipt(gk, IMAGE)
    const path = slot.receiptPath ?? ''

    const visitor = await anonClient().storage.from('receipts').createSignedUrl(path, 60)
    expect(visitor.error).not.toBeNull()

    const organiser = await signedInAdmin()
    cleanups.push(async () => adminClient().from('admins').delete().eq('email', organiser.email))
    cleanups.push(async () => adminClient().auth.admin.deleteUser(organiser.userId))
    const signed = await organiser.client.storage.from('receipts').createSignedUrl(path, 60)
    expect(signed.error).toBeNull()
    const response = await fetch(signed.data?.signedUrl ?? '')
    expect(response.ok).toBe(true)
  })
})
