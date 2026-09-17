import { describe, expect, it, vi } from 'vitest'

const signUpMock = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: { auth: { signUp: (args: unknown) => signUpMock(args) } } }))

import { signUp } from './auth'

describe('signUp', () => {
  it('reports a live session when the project auto-confirms', async () => {
    signUpMock.mockResolvedValue({ data: { user: { id: 'u1' }, session: { access_token: 't' } }, error: null })
    await expect(signUp('baru@example.com', 'rahsia123')).resolves.toEqual({ signedIn: true })
  })

  it('reports no session when the project still demands email confirmation', async () => {
    // What the hosted project returns with "Confirm email" on: a user row,
    // confirmation_sent_at set, and no session -- the account is unusable.
    signUpMock.mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null })
    await expect(signUp('baru@example.com', 'rahsia123')).resolves.toEqual({ signedIn: false })
  })

  it('throws the Supabase message on error', async () => {
    signUpMock.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'User already registered' } })
    await expect(signUp('baru@example.com', 'rahsia123')).rejects.toThrow('User already registered')
  })
})
