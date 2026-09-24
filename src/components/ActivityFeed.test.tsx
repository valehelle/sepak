import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityEvent } from '../data/activity'

// A plain closure rather than vi.fn(), for the same reason as
// AdminContact.test.tsx: a rejected promise from a vi.fn() inside a React
// effect is reported unhandled by vitest even when the component catches it.
let loads = 0
let impl: () => Promise<ActivityEvent[]> = () => Promise.resolve([])
// Nothing is imported for real here: src/data/activity pulls in the supabase
// client, which throws at import time without credentials, so this factory
// replaces the module outright rather than spreading importActual over it.
vi.mock('../data/activity', () => ({
  listActivity: () => {
    loads += 1
    return impl()
  },
  ActivityError: class extends Error {
    constructor(message: string, readonly code: string | null) { super(message) }
  },
}))

const { ActivityFeed, describeActivity } = await import('./ActivityFeed')

// A fixed local-time evening, so the rendered timestamp is stable wherever
// the suite runs (formatEventTime is deliberately local).
const EVENING = new Date(2026, 8, 17, 20, 14).toISOString()

function event(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: 1,
    sessionId: 'session-1',
    sessionNo: 6,
    kind: 'claim',
    actor: 'player',
    playerName: 'Hazmi',
    phone: '60123456789',
    team: 'A',
    position: 'ST',
    opensFrom: null,
    opensTo: null,
    createdAt: EVENING,
    ...overrides,
  }
}

describe('describeActivity', () => {
  it('says who moved the opening time, and from when to when', () => {
    const line = describeActivity(event({
      kind: 'opens_changed',
      actor: 'admin',
      playerName: 'hazmi@example.com',
      phone: null,
      team: null,
      position: null,
      opensFrom: '2026-09-24T13:00:00Z',
      opensTo: '2026-09-24T14:00:00Z',
    }))
    expect(line).toBe('Masa dibuka ditukar: Khamis 24/09, 9:00 PM → Khamis 24/09, 10:00 PM (hazmi@example.com)')
  })

  it('names the position for the lines that have one', () => {
    expect(describeActivity(event({ kind: 'claim' }))).toBe('Hazmi ambil A ST')
    expect(describeActivity(event({ kind: 'release' }))).toBe('Hazmi lepaskan A ST')
    expect(describeActivity(event({ kind: 'autofill' }))).toBe('Hazmi naik dari senarai tunggu → A ST')
  })

  it('keeps the player as the subject even when the admin acted', () => {
    expect(describeActivity(event({ kind: 'admin_clear', actor: 'admin' }))).toBe(
      'Admin kosongkan A ST (Hazmi)',
    )
  })

  it('reads the money lines plainly', () => {
    expect(describeActivity(event({ kind: 'paid' }))).toBe('Hazmi tanda dah bayar')
    expect(describeActivity(event({ kind: 'unpaid' }))).toBe('Hazmi buang tanda bayar')
  })

  it('omits a position for queue lines, which have none', () => {
    const queued = event({ kind: 'waitlist_join', team: null, position: null })
    expect(describeActivity(queued)).toBe('Hazmi masuk senarai tunggu')
    expect(describeActivity({ ...queued, kind: 'waitlist_leave' })).toBe('Hazmi keluar senarai tunggu')
  })

  it('renders CB1 and CB2 as the CB people say', () => {
    expect(describeActivity(event({ position: 'CB2' }))).toBe('Hazmi ambil A CB')
  })
})

describe('ActivityFeed', () => {
  beforeEach(() => {
    loads = 0
    impl = () => Promise.resolve([])
  })

  it('renders each line with its time, session and number', async () => {
    impl = () =>
      Promise.resolve([
        event({ id: 2, kind: 'paid' }),
        event({ id: 1, kind: 'claim' }),
      ])
    render(<ActivityFeed />)

    await waitFor(() => expect(screen.getByText('Hazmi tanda dah bayar')).toBeTruthy())
    expect(screen.getByText('Hazmi ambil A ST')).toBeTruthy()
    expect(screen.getAllByText('17 Sep, 8:14 PM')).toHaveLength(2)
    expect(screen.getAllByText('Sesi 006')).toHaveLength(2)

    const link = screen.getAllByRole('link', { name: '012-345 6789' })[0]
    expect(link?.getAttribute('href')).toBe('https://wa.me/60123456789')
  })

  it('keeps the order it was given, which is newest first', async () => {
    impl = () =>
      Promise.resolve([
        event({ id: 2, kind: 'release', playerName: 'Amir' }),
        event({ id: 1, kind: 'claim', playerName: 'Amir' }),
      ])
    render(<ActivityFeed />)

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
    const lines = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(lines[0]).toContain('Amir lepaskan A ST')
    expect(lines[1]).toContain('Amir ambil A ST')
  })

  it('says what will appear here when there is nothing yet', async () => {
    render(<ActivityFeed />)
    await waitFor(() => expect(screen.getByText(/Belum ada apa-apa/)).toBeTruthy())
    expect(screen.queryByRole('listitem')).toBeNull()
  })

  it('omits the number when a line has none', async () => {
    impl = () => Promise.resolve([event({ phone: null })])
    render(<ActivityFeed />)
    await waitFor(() => expect(screen.getByText('Hazmi ambil A ST')).toBeTruthy())
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows the reason when the feed is refused', async () => {
    const { ActivityError } = await import('../data/activity')
    impl = () => Promise.reject(new ActivityError('Hanya admin boleh lihat aktiviti.', 'not_admin'))
    render(<ActivityFeed />)
    await waitFor(() => expect(screen.getByText('Hanya admin boleh lihat aktiviti.')).toBeTruthy())
  })

  it('refetches on demand', async () => {
    render(<ActivityFeed />)
    await waitFor(() => expect(loads).toBe(1))
    await userEvent.click(screen.getByRole('button', { name: 'Muat semula' }))
    await waitFor(() => expect(loads).toBe(2))
  })
})
