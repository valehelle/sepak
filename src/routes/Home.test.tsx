import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import Home from './Home'

// If the page ever reached for the session list again, this mock would
// record it -- the whole point of the route is that it fetches nothing.
const listSessions = vi.fn()
vi.mock('../data/sessions', () => ({ listSessions: () => listSessions(), fillCounts: vi.fn() }))

function view() {
  return render(<MemoryRouter><Home /></MemoryRouter>)
}

describe('Home', () => {
  it('names the group and points at the shared link', () => {
    view()
    expect(screen.getByRole('heading', { name: 'Geng Turun Peluh' })).toBeTruthy()
    expect(screen.getByText(/pautan sesi yang dikongsi/)).toBeTruthy()
  })

  it('never lists sessions, and never even asks for them', () => {
    view()
    expect(listSessions).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: /Sesi/ })).toBeNull()
  })

  it('keeps a way in for organisers', () => {
    view()
    expect(screen.getByRole('link', { name: 'Admin' }).getAttribute('href')).toBe('/admin')
  })
})
