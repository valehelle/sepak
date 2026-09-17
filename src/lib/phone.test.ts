import { describe, expect, it } from 'vitest'
import { formatPhone, normalisePhone, telLink, whatsappLink } from './phone'

describe('normalisePhone', () => {
  it('accepts the ways people actually type a Malaysian mobile', () => {
    expect(normalisePhone('012-345 6789')).toBe('60123456789')
    expect(normalisePhone('0123456789')).toBe('60123456789')
    expect(normalisePhone('+60 12-345 6789')).toBe('60123456789')
    expect(normalisePhone('60123456789')).toBe('60123456789')
    expect(normalisePhone('  012 345 6789  ')).toBe('60123456789')
    expect(normalisePhone('(012) 3456789')).toBe('60123456789')
  })

  it('handles the longer 011 numbers', () => {
    expect(normalisePhone('011-2345 6789')).toBe('601123456789')
    expect(normalisePhone('+6011 2345 6789')).toBe('601123456789')
  })

  it('rejects anything that is not a Malaysian mobile', () => {
    expect(normalisePhone('')).toBeNull()
    expect(normalisePhone('abc')).toBeNull()
    expect(normalisePhone('03-1234 5678')).toBeNull() // landline
    expect(normalisePhone('012-345')).toBeNull() // too short
    expect(normalisePhone('012-3456 78901')).toBeNull() // too long
    expect(normalisePhone('+65 9123 4567')).toBeNull() // Singapore
    expect(normalisePhone('123456789')).toBeNull() // no leading 0 or 60
  })
})

describe('formatPhone', () => {
  it('renders a stored number the way it is written on a business card', () => {
    expect(formatPhone('60123456789')).toBe('012-345 6789')
    expect(formatPhone('601123456789')).toBe('011-2345 6789')
  })

  it('falls back to the raw value for anything unexpected', () => {
    expect(formatPhone('12345')).toBe('12345')
  })
})

describe('links', () => {
  it('builds a wa.me link from the stored digits', () => {
    expect(whatsappLink('60123456789')).toBe('https://wa.me/60123456789')
  })

  it('builds a tel: link with the plus', () => {
    expect(telLink('60123456789')).toBe('tel:+60123456789')
  })
})
