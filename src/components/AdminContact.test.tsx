import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A plain function rather than vi.fn(): a rejected promise returned from a
// vi.fn() inside a React effect is reported by vitest as an unhandled
// rejection even though the component catches it, and fails the test. A
// plain closure has no such bookkeeping. Calls are recorded by hand.
const calls: unknown[] = []
let impl: () => Promise<string | null> = () => Promise.resolve(null)
vi.mock('../data/contacts', () => ({
  getContactPhone: (target: unknown) => {
    calls.push(target)
    return impl()
  },
  ContactError: class extends Error {
    constructor(message: string, readonly code: string | null) { super(message) }
  },
}))

const { AdminContact, AdminContactToggle } = await import('./AdminContact')

describe('AdminContact', () => {
  beforeEach(() => {
    calls.length = 0
    impl = () => Promise.resolve(null)
  })

  it('fetches the number for the slot and offers WhatsApp and a call', async () => {
    impl = () => Promise.resolve('60123456789')
    render(<AdminContact target={{ slotId: 'slot-1' }} />)

    expect(calls).toEqual([{ slotId: 'slot-1' }])
    await waitFor(() => expect(screen.getByText('012-345 6789')).toBeTruthy())
    expect(screen.getByRole('link', { name: 'WhatsApp' }).getAttribute('href')).toBe('https://wa.me/60123456789')
    expect(screen.getByRole('link', { name: 'Panggil' }).getAttribute('href')).toBe('tel:+60123456789')
  })

  it('says so when a claim predates phone numbers', async () => {
    render(<AdminContact target={{ waitlistId: 'wait-1' }} />)
    await waitFor(() => expect(screen.getByText('Tiada nombor telefon.')).toBeTruthy())
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows the reason when the lookup fails', async () => {
    const { ContactError } = await import('../data/contacts')
    impl = () => Promise.reject(new ContactError('Hanya admin boleh lihat nombor telefon.', 'not_admin'))
    render(<AdminContact target={{ slotId: 'slot-1' }} />)
    await waitFor(() => expect(screen.getByText('Hanya admin boleh lihat nombor telefon.')).toBeTruthy())
  })

  it('toggle variant fetches nothing until tapped', async () => {
    impl = () => Promise.resolve('60123456789')
    render(<AdminContactToggle target={{ waitlistId: 'wait-1' }} />)
    expect(calls).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: 'Lihat nombor' }))
    expect(calls).toEqual([{ waitlistId: 'wait-1' }])
    await waitFor(() => expect(screen.getByText('012-345 6789')).toBeTruthy())
  })
})
