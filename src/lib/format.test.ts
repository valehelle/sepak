import { describe, expect, it } from 'vitest'
import { formatFee, formatPlayDate, formatStartTime } from './format'

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
