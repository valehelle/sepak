export const PLAYER_MEMORY_KEY = 'sepak.player'

export type RememberedPlayer = { name: string; phone: string }

const EMPTY: RememberedPlayer = { name: '', phone: '' }

/** What this device last booked with, so a regular never types their name
 *  and number twice. Same posture as the claim token: storage may be
 *  unavailable or tampered with, and either case degrades to an empty form,
 *  never a broken page. */
export function recallPlayer(): RememberedPlayer {
  try {
    const raw = localStorage.getItem(PLAYER_MEMORY_KEY)
    if (raw === null) return EMPTY
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY
    const record = Object.fromEntries(Object.entries(parsed))
    const name = record['name']
    const phone = record['phone']
    if (typeof name !== 'string' || typeof phone !== 'string') return EMPTY
    return { name, phone }
  } catch {
    return EMPTY
  }
}

export function rememberPlayer(player: RememberedPlayer): void {
  try {
    localStorage.setItem(PLAYER_MEMORY_KEY, JSON.stringify(player))
  } catch {
    // a remembered form is a convenience, not a requirement
  }
}
