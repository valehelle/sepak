export const CLAIM_TOKEN_KEY = 'sepak.claimToken'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let cached: string | null = null

/** The key this browser booked with before players signed in. Bookings now
 *  belong to accounts (0019_accounts.sql); the key's only remaining use is
 *  adopt_device, which moves whatever this browser booked onto the account
 *  that signs in here. Storage can throw outright in private browsing, so a
 *  failure to persist degrades to a session-lived key rather than breaking
 *  the page. */
export function getClaimToken(): string {
  if (cached !== null) return cached

  try {
    const stored = localStorage.getItem(CLAIM_TOKEN_KEY)
    if (stored !== null && UUID_RE.test(stored)) {
      cached = stored
      return stored
    }
  } catch {
    // storage unavailable; fall through and mint a fresh token
  }

  const token = crypto.randomUUID()
  try {
    localStorage.setItem(CLAIM_TOKEN_KEY, token)
  } catch {
    // unpersisted: the token still works for this page's lifetime
  }

  cached = token
  return token
}

/** Test seam: clears the in-memory cache so each test starts clean. */
export function resetClaimTokenCache(): void {
  cached = null
}
