import { describe, expect, it } from 'vitest'
import { parseAdmin } from './admins'

const ADMIN_ROW = {
  email: 'hazmiirfan92@gmail.com',
  role: 'super',
  added_by: null,
  created_at: '2026-09-10T04:00:00Z',
}

describe('parseAdmin', () => {
  it('narrows a valid row', () => {
    const admin = parseAdmin(ADMIN_ROW)
    expect(admin).toEqual({
      email: 'hazmiirfan92@gmail.com',
      role: 'super',
      addedBy: null,
      createdAt: '2026-09-10T04:00:00Z',
    })
  })

  it('accepts a non-null added_by', () => {
    const admin = parseAdmin({ ...ADMIN_ROW, added_by: 'someone@example.com' })
    expect(admin.addedBy).toBe('someone@example.com')
  })

  it('accepts the admin role', () => {
    expect(parseAdmin({ ...ADMIN_ROW, role: 'admin' }).role).toBe('admin')
  })

  it('rejects an unknown role rather than casting it', () => {
    expect(() => parseAdmin({ ...ADMIN_ROW, role: 'owner' })).toThrow(/role/)
  })

  it('rejects a missing field rather than yielding undefined', () => {
    const { email: _email, ...withoutEmail } = ADMIN_ROW
    expect(() => parseAdmin(withoutEmail)).toThrow(/email/)
  })

  it('rejects a non-string added_by', () => {
    expect(() => parseAdmin({ ...ADMIN_ROW, added_by: 42 })).toThrow(/added_by/)
  })

  it('rejects a non-object', () => {
    expect(() => parseAdmin(null)).toThrow()
    expect(() => parseAdmin('admin')).toThrow()
  })
})
