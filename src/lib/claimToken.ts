export const CLAIM_TOKEN_KEY = 'sepak.claimToken'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let cached: string | null = null

/** The device's identity. Holding this token is what authorises releasing or
 *  moving a slot, which is how a player edits their own booking without an
 *  account. Storage can throw outright in private browsing, so a failure to
 *  persist degrades to a session-lived token rather than breaking the page. */
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
