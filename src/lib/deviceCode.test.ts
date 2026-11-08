import { describe, expect, it } from 'vitest'
import { deviceCode } from './deviceCode'

describe('deviceCode', () => {
  // The same token and code supabase/tests/activity_device_test.sql checks
  // the database against: the two must agree for a player's code to match
  // their booking line.
  it('matches the code the database writes for the same token', async () => {
    expect(await deviceCode('66666666-6666-4666-8666-666666666666')).toBe('a9703d')
  })

  it('reads a token the same whatever its case', async () => {
    expect(await deviceCode('66666666-6666-4666-8666-666666666666'.toUpperCase())).toBe('a9703d')
  })
})
