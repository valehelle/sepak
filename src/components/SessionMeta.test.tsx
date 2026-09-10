import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Session } from '../data/types'
import { SessionMeta } from './SessionMeta'

const SESSION: Session = {
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
}

describe('SessionMeta', () => {
  it('shows the session details in the familiar order', () => {
    render(<SessionMeta session={SESSION} filled={24} total={33} />)
    expect(screen.getByText('Sesi 005 Geng Turun Peluh')).toBeTruthy()
    expect(screen.getByText('16/09/2026 (RABU)')).toBeTruthy()
    expect(screen.getByText('8:00 PM')).toBeTruthy()
    expect(screen.getByText('Padang Presint 8')).toBeTruthy()
    expect(screen.getByText('RM 27/pax')).toBeTruthy()
    expect(screen.getByText('24/33 penuh')).toBeTruthy()
  })

  it('omits the fee line for a free session', () => {
    render(<SessionMeta session={{ ...SESSION, feeMyr: null }} filled={0} total={33} />)
    expect(screen.queryByText('Yuran')).toBeNull()
  })

  it('flags a closed session', () => {
    render(<SessionMeta session={{ ...SESSION, status: 'closed' }} filled={33} total={33} />)
    expect(screen.getByText('Sesi ditutup')).toBeTruthy()
  })
})
