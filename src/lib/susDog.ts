/** A joke for one regular who keeps saying he will skip next week, then
 *  books anyway. His number is kept as a SHA-256 of its stored form
 *  (601…), not in the clear, because this file ships to every browser. */
const SUS_PHONE_SHA256 = '9690ee4fcaa862827a43df1db6e04c226554615e469b70e9243b657459238a63'

/** `stored` is the normalised number from the claim form (lib/phone). */
export async function isSusPhone(stored: string): Promise<boolean> {
  if (typeof crypto === 'undefined' || crypto.subtle === undefined) return false
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stored))
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    return hex === SUS_PHONE_SHA256
  } catch {
    return false
  }
}
