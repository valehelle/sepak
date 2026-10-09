import { FunctionsHttpError } from '@supabase/supabase-js'
import { getClaimToken } from '../lib/claimToken'
import { supabase } from '../lib/supabase'
import { SlotActionError } from './slots'
import { FALLBACK_ERROR_MESSAGE, RPC_MESSAGES, RPC_ERROR_CODES, parseSlot, type Slot } from './types'

const BUCKET = 'receipts'

function asCode(value: unknown): (typeof RPC_ERROR_CODES)[number] | null {
  return RPC_ERROR_CODES.find((code) => code === value) ?? null
}

/** Sends the receipt to the `receipt` Edge Function with this browser's
 *  claim token. The function checks the token owns the slot, stores the
 *  file, and ticks paid; players never write to storage themselves
 *  (0021_receipts.sql). Returns the slot as the server now has it. */
export async function sendReceipt(slotId: string, image: Blob): Promise<Slot> {
  const form = new FormData()
  form.append('slot_id', slotId)
  form.append('token', getClaimToken())
  form.append('file', image, image.type === 'image/png' ? 'resit.png' : 'resit.jpg')

  const { data, error } = await supabase.functions.invoke('receipt', { body: form })
  if (error !== null) {
    let code: ReturnType<typeof asCode> = null
    if (error instanceof FunctionsHttpError) {
      const body: unknown = await error.context.json().catch(() => null)
      if (typeof body === 'object' && body !== null) code = asCode(Object.fromEntries(Object.entries(body))['error'])
    }
    throw new SlotActionError(code === null ? FALLBACK_ERROR_MESSAGE : RPC_MESSAGES[code], code)
  }
  return parseSlot(data)
}

/** A short-lived link to look at a receipt. Admins only; storage refuses
 *  anyone else. */
export async function receiptLink(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 10 * 60)
  if (error !== null) throw new SlotActionError('Resit tak dapat dibuka.', null)
  return data.signedUrl
}

/** Admin-only, best effort: a file left behind costs a little storage,
 *  never a booking. */
export async function removeReceipt(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path])
}

/** Every receipt under a session, for deleting the session. Admin-only. */
export async function removeSessionReceipts(sessionId: string): Promise<void> {
  const folders = await supabase.storage.from(BUCKET).list(sessionId, { limit: 1000 })
  if (folders.error !== null) return
  const paths: string[] = []
  for (const folder of folders.data) {
    const files = await supabase.storage.from(BUCKET).list(`${sessionId}/${folder.name}`, { limit: 100 })
    if (files.error !== null) continue
    for (const file of files.data) paths.push(`${sessionId}/${folder.name}/${file.name}`)
  }
  if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths)
}
