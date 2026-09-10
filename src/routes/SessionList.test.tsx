import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../data/types'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    sessionNo: 5,
    title: 'Geng Turun Peluh',
    playDate: '2026-09-16',
    startTime: '20:00:00',
    durationMins: 120,
    venue: 'Padang Presint 8',
    feeMyr: 27,
    teamNames: { A: 'Merah', B: 'Putih', C: 'Kuning' },
    status: 'open',
    createdAt: '2026-09-10T00:00:00Z',
    ...overrides,
  }
}

const listSessions = vi.fn()
const fillCounts = vi.fn()

vi.mock('../data/sessions', () => ({
  listSessions: () => listSessions(),
  fillCounts: (ids: string[]) => fillCounts(ids),
}))

const { default: SessionList } = await import('./SessionList')

function view() {
  return render(<MemoryRouter><SessionList /></MemoryRouter>)
}

describe('SessionList', () => {
  beforeEach(() => {
    listSessions.mockReset()
    fillCounts.mockReset()
    fillCounts.mockResolvedValue(new Map([['session-1', 24]]))
  })

  it('lists an upcoming session with its details and fill count', async () => {
    listSessions.mockResolvedValue([session()])
    view()
    await waitFor(() => expect(screen.getByText('Sesi 005 Geng Turun Peluh')).toBeTruthy())
    expect(screen.getByText('16/09/2026 (RABU)')).toBeTruthy()
    expect(screen.getByText('8:00 PM')).toBeTruthy()
    expect(screen.getByText('Padang Presint 8')).toBeTruthy()
    expect(screen.getByText('RM 27/pax')).toBeTruthy()
    expect(screen.getByText('24/33 penuh')).toBeTruthy()
  })

  it('links each session to its page', async () => {
    listSessions.mockResolvedValue([session()])
    view()
    const link = await waitFor(() => screen.getByRole('link', { name: /Sesi 005/ }))
    expect(link.getAttribute('href')).toBe('/s/session-1')
  })

  it('separates past sessions from upcoming ones', async () => {
    listSessions.mockResolvedValue([
      session({ id: 'future', sessionNo: 6, playDate: '2099-01-01' }),
      session({ id: 'past', sessionNo: 4, playDate: '2020-01-01' }),
    ])
    fillCounts.mockResolvedValue(new Map())
    view()
    await waitFor(() => expect(screen.getByText('Akan datang')).toBeTruthy())
    expect(screen.getByText('Sesi lepas')).toBeTruthy()
  })

  it('omits the fee for a free session', async () => {
    listSessions.mockResolvedValue([session({ feeMyr: null })])
    view()
    await waitFor(() => expect(screen.getByText('Sesi 005 Geng Turun Peluh')).toBeTruthy())
    expect(screen.queryByText(/RM/)).toBeNull()
  })

  it('invites the organiser when there is nothing yet', async () => {
    listSessions.mockResolvedValue([])
    view()
    await waitFor(() => expect(screen.getByText(/Belum ada sesi/)).toBeTruthy())
  })

  it('reports a failure', async () => {
    listSessions.mockRejectedValue(new Error('offline'))
    view()
    await waitFor(() => expect(screen.getByText(/Gagal memuatkan/)).toBeTruthy())
  })
})
