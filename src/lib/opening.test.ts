import { describe, expect, it } from 'vitest'
import { formatCountdown, formatOpensAt, fromLocalInput, toLocalInput } from './opening'

describe('formatCountdown', () => {
  it('shows hours, minutes and seconds', () => {
    expect(formatCountdown((4 * 3600 + 12 * 60 + 9) * 1000)).toBe('04:12:09')
  })

  it('adds days when a day or more away', () => {
    expect(formatCountdown((2 * 86_400 + 4 * 3600 + 12 * 60 + 9) * 1000)).toBe('2h 04:12:09')
  })

  it('rounds up, so it never reads zero while still locked', () => {
    expect(formatCountdown(1)).toBe('00:00:01')
    expect(formatCountdown(999)).toBe('00:00:01')
  })

  it('stops at zero rather than counting negative', () => {
    expect(formatCountdown(0)).toBe('00:00:00')
    expect(formatCountdown(-5000)).toBe('00:00:00')
  })
})

describe('formatOpensAt', () => {
  it('names the day in Malay, in Malaysia time whatever the phone is set to', () => {
    expect(formatOpensAt('2026-09-24T13:00:00Z')).toBe('Khamis 24/09, 9:00 PM')
    // 16:05 UTC on the Saturday is already Sunday in Malaysia.
    expect(formatOpensAt('2026-09-26T16:05:00Z')).toBe('Ahad 27/09, 12:05 AM')
  })
})

describe('local datetime inputs', () => {
  it('reads the form as Malaysia time, and round-trips a whole minute', () => {
    const iso = fromLocalInput('2026-09-25T21:00')
    expect(iso).toBe('2026-09-25T13:00:00.000Z')
    expect(toLocalInput(iso ?? '')).toBe('2026-09-25T21:00')
  })

  it('drops seconds, which the form cannot show', () => {
    expect(toLocalInput('2026-09-25T13:00:42Z')).toBe('2026-09-25T21:00')
  })

  it('reads an empty or malformed value as nothing', () => {
    expect(fromLocalInput('')).toBeNull()
    expect(fromLocalInput('tomorrow')).toBeNull()
    expect(toLocalInput('not a date')).toBe('')
  })
})
