/** Malay day names, Sunday first. */
const DAYS = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'] as const

/** Every session is in Malaysia, and so is its opening: shown and entered
 *  in Malaysia time whatever time zone the phone is set to, the same way
 *  the session's own date and start time are. Malaysia has no daylight
 *  saving, so a fixed offset is exact. */
const MYT_OFFSET_MS = 8 * 60 * 60 * 1000

const pad = (n: number): string => String(n).padStart(2, '0')

/** The wall-clock fields of an instant in Malaysia time. */
function myt(iso: string) {
  const at = new Date(Date.parse(iso) + MYT_OFFSET_MS)
  if (Number.isNaN(at.getTime())) throw new Error(`invalid timestamp: ${iso}`)
  return {
    year: at.getUTCFullYear(),
    month: at.getUTCMonth() + 1,
    day: at.getUTCDate(),
    weekday: at.getUTCDay(),
    hour: at.getUTCHours(),
    minute: at.getUTCMinutes(),
  }
}

/** "Khamis 25/09, 9:00 PM", in Malaysia time. */
export function formatOpensAt(iso: string): string {
  const t = myt(iso)
  const hour12 = t.hour % 12 === 0 ? 12 : t.hour % 12
  const meridiem = t.hour < 12 ? 'AM' : 'PM'
  return `${DAYS[t.weekday]} ${pad(t.day)}/${pad(t.month)}, ${hour12}:${pad(t.minute)} ${meridiem}`
}

/** The countdown's digits: "04:12:09", or "2h 04:12:09" when a day or more
 *  away ("h" for hari). Rounds up, so it never shows 00:00:00 while the
 *  slots are still locked. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  return days > 0 ? `${days}h ${clock}` : clock
}

/** An ISO timestamp as a `datetime-local` input's value, in Malaysia time. */
export function toLocalInput(iso: string): string {
  if (Number.isNaN(Date.parse(iso))) return ''
  const t = myt(iso)
  return `${t.year}-${pad(t.month)}-${pad(t.day)}T${pad(t.hour)}:${pad(t.minute)}`
}

/** A `datetime-local` value, read as Malaysia time, as an ISO timestamp.
 *  Null for an empty or unreadable value. */
export function fromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const at = Date.parse(`${value}:00+08:00`)
  return Number.isNaN(at) ? null : new Date(at).toISOString()
}
