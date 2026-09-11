import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createSession } from '../../src/data/sessions'
import { supabase } from '../../src/lib/supabase'
import { adminClient } from '../helpers/localSupabase'

// createSession() always runs through the anon-keyed src/lib/supabase.ts
// singleton (service_role must never be referenced from src/, and there is
// no seam to swap in an authenticated client). The refusal test below
// proves the wrapper's parameter mapping reaches the real RPC and that its
// boom()-style error path fires on a genuine RLS rejection, but it cannot
// tell "denied by RLS" apart from "misspelled p_ parameter" — both throw
// identically. The second test below closes that gap by actually signing
// in as an organiser on the shared singleton, so the wrapper's happy path
// (its camelCase -> p_-prefixed mapping matching the RPC's real signature)
// is exercised for real. Signing in on a module-level singleton shared by
// the whole process is genuinely risky — any other test that ran on this
// singleton afterwards would silently inherit an authenticated role — so
// this signs back out in `afterEach` no matter how the test finishes, and
// the integration project is pinned to a single fork (see vitest.config.ts)
// specifically so this file's tests never race another file's use of the
// same singleton.
describe('createSession wrapper against local postgres', () => {
  it('is refused for anon by RLS', async () => {
    await expect(
      createSession({
        sessionNo: 950,
        title: 'Wrapper Rogue',
        playDate: '2026-10-15',
        startTime: '20:00:00',
        durationMins: 120,
        venue: 'Nowhere',
        feeMyr: 10,
        teamAName: 'Merah',
        teamBName: 'Putih',
        teamCName: 'Kuning',
      }),
    ).rejects.toThrow()
  })
})

describe('createSession wrapper as an authenticated organiser', () => {
  let userId: string | null = null
  let sessionId: string | null = null
  let adminEmail: string | null = null

  afterEach(async () => {
    // Always sign the shared singleton back out first, even if an
    // assertion above threw — a leaked authenticated session would
    // silently change the role every later test in the process runs
    // under.
    await supabase.auth.signOut()

    if (sessionId !== null) {
      await adminClient().from('sessions').delete().eq('id', sessionId)
      sessionId = null
    }
    if (userId !== null) {
      await adminClient().auth.admin.deleteUser(userId)
      userId = null
    }
    if (adminEmail !== null) {
      await adminClient().from('admins').delete().eq('email', adminEmail)
      adminEmail = null
    }
  })

  it('creates a session with all 33 slots', async () => {
    const email = `organiser-${randomUUID()}@example.test`
    const password = 'wrapper-test-password'

    const created = await adminClient().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    expect(created.error).toBeNull()
    userId = created.data.user?.id ?? null
    expect(userId).not.toBeNull()

    // Being authenticated grants nothing on its own (migration
    // 0006_admins.sql) -- createSession now also needs this user on the
    // allowlist, so it is added here as setup and removed in afterEach.
    adminEmail = email
    const allowlisted = await adminClient().from('admins').insert({ email, role: 'admin' })
    expect(allowlisted.error).toBeNull()

    const signedIn = await supabase.auth.signInWithPassword({ email, password })
    expect(signedIn.error).toBeNull()

    const session = await createSession({
      sessionNo: 951,
      title: 'Wrapper Authenticated',
      playDate: '2026-10-22',
      startTime: '20:00:00',
      durationMins: 120,
      venue: 'Padang Wrapper',
      feeMyr: 27,
      teamAName: 'Merah',
      teamBName: 'Putih',
      teamCName: 'Kuning',
    })
    sessionId = session.id
    expect(session.title).toBe('Wrapper Authenticated')
    expect(session.sessionNo).toBe(951)

    const slots = await adminClient().from('slots').select('id').eq('session_id', session.id)
    expect(slots.error).toBeNull()
    expect(slots.data).toHaveLength(33)
  })
})
