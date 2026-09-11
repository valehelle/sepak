const DAY_NAMES = ['AHAD', 'ISNIN', 'SELASA', 'RABU', 'KHAMIS', 'JUMAAT', 'SABTU'] as const

/** Splits the ISO date into calendar parts rather than using `new Date(iso)`,
 *  which parses date-only strings as midnight UTC and lands on the previous
 *  day for anyone west of Greenwich. */
export function formatPlayDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`invalid date: ${iso}`)
  }

  const dayName = DAY_NAMES[new Date(year, month - 1, day).getDay()]
  if (dayName === undefined) throw new Error(`invalid date: ${iso}`)

  const dd = String(day).padStart(2, '0')
  const mm = String(month).padStart(2, '0')
  return `${dd}/${mm}/${year} (${dayName})`
}

export function formatStartTime(time: string): string {
  const [rawHour, rawMinute] = time.split(':')
  const hour = Number(rawHour)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`invalid time: ${time}`)
  }

  const minute = (rawMinute ?? '00').padStart(2, '0')
  const meridiem = hour < 12 ? 'AM' : 'PM'
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return `${hour12}:${minute} ${meridiem}`
}

/** Null when there is nothing to collect, so callers can omit the line entirely. */
export function formatFee(fee: number | null): string | null {
  if (fee === null || fee === 0) return null
  const amount = Number.isInteger(fee) ? String(fee) : fee.toFixed(2)
  return `RM ${amount}/pax`
}
