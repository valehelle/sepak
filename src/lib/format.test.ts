import { describe, expect, it } from 'vitest'
import { formatEventTime, formatFee, formatFees, formatPlayDate, formatStartTime } from './format'

describe('formatPlayDate', () => {
  it('formats with the Malay day name', () => {
    expect(formatPlayDate('2026-09-16')).toBe('16/09/2026 (RABU)')
  })

  it('covers the whole week', () => {
    expect(formatPlayDate('2026-09-13')).toBe('13/09/2026 (AHAD)')
    expect(formatPlayDate('2026-09-14')).toBe('14/09/2026 (ISNIN)')
    expect(formatPlayDate('2026-09-15')).toBe('15/09/2026 (SELASA)')
    expect(formatPlayDate('2026-09-17')).toBe('17/09/2026 (KHAMIS)')
    expect(formatPlayDate('2026-09-18')).toBe('18/09/2026 (JUMAAT)')
    expect(formatPlayDate('2026-09-19')).toBe('19/09/2026 (SABTU)')
  })

  it('pads single-digit days and months', () => {
    expect(formatPlayDate('2026-01-05')).toBe('05/01/2026 (ISNIN)')
  })

  it('does not shift the date across timezones', () => {
    // Parsed as calendar parts, never as UTC — a naive `new Date('2026-09-16')`
    // is midnight UTC and reads as the 15th west of Greenwich.
    expect(formatPlayDate('2026-09-16')).toContain('16/09/2026')
  })
})

describe('formatStartTime', () => {
  it('converts 24h to 12h with meridiem', () => {
    expect(formatStartTime('20:00:00')).toBe('8:00 PM')
    expect(formatStartTime('08:30:00')).toBe('8:30 AM')
  })

  it('handles both midnight and noon', () => {
    expect(formatStartTime('00:00:00')).toBe('12:00 AM')
    expect(formatStartTime('12:00:00')).toBe('12:00 PM')
  })

  it('accepts times without seconds', () => {
    expect(formatStartTime('21:45')).toBe('9:45 PM')
  })
})

describe('formatFee', () => {
  it('drops a redundant decimal', () => {
    expect(formatFee(27)).toBe('RM 27/pax')
  })

  it('keeps real sen', () => {
    expect(formatFee(27.5)).toBe('RM 27.50/pax')
  })

  it('treats zero and null as free', () => {
    expect(formatFee(0)).toBeNull()
    expect(formatFee(null)).toBeNull()
  })
})

describe('formatFees', () => {
  it('reads as one price when the goalkeeper pays the same or nothing is set', () => {
    expect(formatFees(25, null)).toBe('RM 25/pax')
    expect(formatFees(25, 25)).toBe('RM 25/pax')
  })

  it('adds the goalkeeper price when it differs', () => {
    expect(formatFees(25, 15)).toBe('RM 25/pax (GK RM 15)')
    expect(formatFees(25, 12.5)).toBe('RM 25/pax (GK RM 12.50)')
    expect(formatFees(25, 0)).toBe('RM 25/pax (GK percuma)')
  })

  it('handles a free session where only the goalkeeper pays', () => {
    expect(formatFees(null, 10)).toBe('Percuma (GK RM 10)')
    expect(formatFees(null, null)).toBeNull()
    expect(formatFees(0, 0)).toBeNull()
  })
})

describe('formatEventTime', () => {
  // Built with the local-time constructor on both sides, so the assertion
  // holds wherever the test runs -- the formatter is deliberately local.
  it('reads as a date and a wall-clock time', () => {
    const evening = new Date(2026, 8, 17, 20, 14)
    expect(formatEventTime(evening.toISOString())).toBe('17 Sep, 8:14 PM')
  })

  it('handles midnight and noon the way people say them', () => {
    expect(formatEventTime(new Date(2026, 0, 1, 0, 5).toISOString())).toBe('1 Jan, 12:05 AM')
    expect(formatEventTime(new Date(2026, 11, 31, 12, 0).toISOString())).toBe('31 Dis, 12:00 PM')
  })

  it('throws on a timestamp it cannot read', () => {
    expect(() => formatEventTime('not a date')).toThrow(/invalid timestamp/)
  })
})
