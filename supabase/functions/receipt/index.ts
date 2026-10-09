// Stores a payment receipt for a slot, and ticks it paid.
//
// Players do not hold accounts: a booking belongs to the browser that made
// it, proven by its claim token. The storage service cannot check that
// token, so the photo comes here instead. This function asks the database
// whether the token owns the slot, stores the file as service_role in that
// slot's folder of the private `receipts` bucket, and attaches it -- see
// 0021_receipts.sql, where every decision is made.
//
// Deployed with "Verify JWT" off: the site calls it with the project's
// publishable key, which is not a JWT. The claim token is what authorises.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const MAX_BYTES = 5 * 1024 * 1024
const TYPES: Record<string, string | undefined> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Called from the site on github.io, so the browser asks first.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/** The database raises short codes (wrong_token, invalid_receipt...); the
 *  site maps them to Malay copy. */
function codeOf(message: string): string {
  const match = message.match(/[a-z_]+/)
  return match === null ? 'error' : match[0]
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed' })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return reply(400, { error: 'invalid_receipt' })
  }

  const slotId = form.get('slot_id')
  const token = form.get('token')
  const file = form.get('file')
  if (typeof slotId !== 'string' || !UUID.test(slotId)) return reply(400, { error: 'slot_not_found' })
  if (typeof token !== 'string' || !UUID.test(token)) return reply(400, { error: 'invalid_token' })
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) return reply(400, { error: 'invalid_receipt' })
  const extension = TYPES[file.type]
  if (extension === undefined) return reply(400, { error: 'invalid_receipt' })

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    db: { schema: 'sepak' },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Is this browser the slot's owner? Asked before anything is stored.
  const folder = await db.rpc('receipt_folder_for', { p_slot_id: slotId, p_token: token })
  if (folder.error !== null) return reply(403, { error: codeOf(folder.error.message) })
  if (typeof folder.data !== 'string') return reply(500, { error: 'error' })

  const path = `${folder.data}/${crypto.randomUUID()}.${extension}`
  const stored = await db.storage.from('receipts').upload(path, file, { contentType: file.type, upsert: false })
  if (stored.error !== null) return reply(500, { error: 'invalid_receipt' })

  const attached = await db.rpc('attach_receipt', { p_slot_id: slotId, p_token: token, p_path: path })
  if (attached.error !== null) {
    // The slot changed hands between the two calls: do not keep the file.
    await db.storage.from('receipts').remove([path])
    return reply(403, { error: codeOf(attached.error.message) })
  }
  return reply(200, attached.data)
})
