import { getClaimToken } from './claimToken'

/** A short, public name for this browser's claim token: the first six hex
 *  digits of its SHA-256. The activity log stores the same code on every
 *  line (sepak.device_code in 0023_activity_device.sql), so a player who
 *  cannot edit their booking can read theirs out to the organiser, and a
 *  mismatch shows they are in a different browser from the one they booked
 *  in. A hash, so showing it gives away nothing that authorises an edit.
 *
 *  Null where the page cannot hash (crypto.subtle needs a secure context). */
export async function deviceCode(token: string = getClaimToken()): Promise<string | null> {
  if (typeof crypto === 'undefined' || crypto.subtle === undefined) return null
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token.toLowerCase()))
    return Array.from(new Uint8Array(digest).slice(0, 3), (byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}
