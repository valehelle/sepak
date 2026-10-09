import { supabase } from '../lib/supabase'
import { SlotActionError } from './slots'
import { FALLBACK_ERROR_MESSAGE, RPC_MESSAGES, parseSlot, rpcErrorCode, type Slot } from './types'

const BUCKET = 'receipts'

/** Uploads into the slot's own folder -- the only place storage lets its
 *  owner write (0021_receipts.sql) -- and returns the path. */
export async function uploadReceipt(slot: Pick<Slot, 'id' | 'sessionId'>, image: Blob): Promise<string> {
  const extension = image.type === 'image/png' ? 'png' : image.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${slot.sessionId}/${slot.id}/${crypto.randomUUID()}.${extension}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, image, {
    contentType: image.type === '' ? 'image/jpeg' : image.type,
    upsert: false,
  })
  if (error !== null) throw new SlotActionError('Gagal muat naik resit. Cuba lagi.', null)
  return path
}

/** Ticks paid and records the receipt, in one step. */
export async function attachReceipt(slotId: string, path: string): Promise<Slot> {
  const { data, error } = await supabase.rpc('attach_receipt', { p_slot_id: slotId, p_path: path })
  if (error !== null) {
    const code = rpcErrorCode(error)
    throw new SlotActionError(code === null ? FALLBACK_ERROR_MESSAGE : RPC_MESSAGES[code], code)
  }
  return parseSlot(data)
}

/** A short-lived link to look at a receipt. Only its owner and admins get
 *  one; anyone else is refused by storage. */
export async function receiptLink(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 10 * 60)
  if (error !== null) throw new SlotActionError('Resit tak dapat dibuka.', null)
  return data.signedUrl
}

/** Best effort: a file left behind costs a little storage, never a booking. */
export async function removeReceipt(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path])
}

/** Every receipt under a session, for deleting the session. */
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
