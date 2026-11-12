import { describe, expect, it } from 'vitest'
import { normalisePhone } from './phone'
import { isSusPhone } from './susDog'

describe('isSusPhone', () => {
  it.each(['0172562694', '017-256 2694', '+60172562694', '+60 17-256 2694', '60172562694'])(
    'matches %s once normalised',
    async (typed) => {
      const stored = normalisePhone(typed)
      expect(stored).not.toBeNull()
      expect(await isSusPhone(stored ?? '')).toBe(true)
    },
  )

  it('ignores everyone else', async () => {
    expect(await isSusPhone('60123456789')).toBe(false)
  })
})
