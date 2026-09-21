/** The session this device last looked at.
 *
 *  Needed because the app is installable now: the home-screen icon can only
 *  open one fixed address, and that address is the index, which deliberately
 *  lists nothing. Without this, the icon somebody just installed opens a
 *  page telling them to go and find a WhatsApp link -- which reads as
 *  broken. */
export const LAST_SESSION_KEY = 'sepak.lastSession'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function rememberSession(id: string): void {
  if (!UUID_RE.test(id)) return
  try {
    localStorage.setItem(LAST_SESSION_KEY, id)
  } catch {
    // a convenience, not a requirement
  }
}

export function recallSession(): string | null {
  try {
    const stored = localStorage.getItem(LAST_SESSION_KEY)
    return stored !== null && UUID_RE.test(stored) ? stored : null
  } catch {
    return null
  }
}
