import { supabase } from '../lib/supabase'
import { FALLBACK_ERROR_MESSAGE, RPC_MESSAGES, rpcErrorCode } from './types'

export class ContactError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message)
    this.name = 'ContactError'
  }
}

export type ContactRef = { slotId: string } | { waitlistId: string }

/** The phone behind a claim or queue entry, in stored form (60123456789),
 *  or null when none was recorded (claims made before contacts existed).
 *  Admin-only: contact_phone() checks sepak.is_admin() itself and raises
 *  not_admin for anyone else -- see 0009_contacts.sql. */
export async function getContactPhone(ref: ContactRef): Promise<string | null> {
  const { data, error } = await supabase.rpc(
    'contact_phone',
    'slotId' in ref ? { p_slot_id: ref.slotId } : { p_waitlist_id: ref.waitlistId },
  )
  if (error !== null) {
    const code = rpcErrorCode(error)
    throw new ContactError(code === null ? FALLBACK_ERROR_MESSAGE : RPC_MESSAGES[code], code)
  }
  if (data === null || data === undefined) return null
  if (typeof data !== 'string') throw new ContactError('contact_phone: expected text', null)
  return data
}
