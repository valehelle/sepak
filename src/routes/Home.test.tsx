import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LAST_SESSION_KEY } from '../lib/lastSession'
import Home from './Home'

const ID = 'b8630d98-cc10-47f0-b709-ca2343b25a3b'

// Whether the app was launched from a home-screen icon is the difference
// between "show a shortcut" and "go straight there".
let standalone = false
vi.mock('../lib/pushCapability', () => ({ isStandalone: () => standalone }))

// If the page ever reached for the session list again, this mock would
// record it -- the whole point of the route is that it fetches nothing.
const listSessions = vi.fn()
vi.mock('../data/sessions', () => ({ listSessions: () => listSessions(), fillCounts: vi.fn() }))

function view() {
  return render(<MemoryRouter><Home /></MemoryRouter>)
}

describe('Home', () => {
  beforeEach(() => {
    localStorage.clear()
    standalone = false
  })

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

  it('offers the last session as a shortcut once this device has seen one', () => {
    localStorage.setItem(LAST_SESSION_KEY, ID)
    view()
    expect(screen.getByRole('link', { name: 'Buka sesi terakhir anda' }).getAttribute('href')).toBe(`/s/${ID}`)
  })

  it('offers no shortcut on a device that has never opened a session', () => {
    view()
    expect(screen.queryByRole('link', { name: /sesi terakhir/ })).toBeNull()
  })

  it('goes straight to that session when launched from the home-screen icon', () => {
    // Otherwise the icon somebody just installed opens a page telling them
    // to go and find a WhatsApp link, which reads as broken.
    localStorage.setItem(LAST_SESSION_KEY, ID)
    standalone = true
    view()
    expect(screen.queryByRole('heading', { name: 'Geng Turun Peluh' })).toBeNull()
  })
})
