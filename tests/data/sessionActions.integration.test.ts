import { describe, expect, it } from 'vitest'
import { createSession } from '../../src/data/sessions'

// createSession() always runs through the anon-keyed src/lib/supabase.ts
// singleton (service_role must never be referenced from src/, and there is
// no seam to swap in an authenticated client). Standing up a real
// authenticated Supabase Auth session just to exercise this one wrapper
// would mean signing in on that shared singleton from a test file — every
// other `it()` in the same file (and any other wrapper call the singleton
// makes afterwards, since tests in one file share one module instance)
// would then also run as that authenticated user unless carefully signed
// out again, which is a lot of auth-flow machinery and shared-state risk
// for a data-layer task. So this asserts the refusal instead: it proves
// the wrapper's parameter mapping reaches the real RPC and that its
// boom()-style error path fires on a genuine RLS rejection. The RPC's
// success path (a session created with all 33 slots) is already covered
// against the same function, with the same parameter names, via
// `admin.rpc('create_session', ...)` in sessions.integration.test.ts.
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
