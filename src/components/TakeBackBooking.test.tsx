import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MoveStatus } from '../data/move'

// Plain closures rather than vi.fn(), for the reason given in
// ActivityFeed.test.tsx.
let available = true
let request: () => Promise<string> = () => Promise.resolve('request-1')
let status: () => Promise<MoveStatus> = () => Promise.resolve('pending')

class FakeSlotActionError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message)
  }
}

vi.mock('../data/move', () => ({
  moveAvailable: () => Promise.resolve(available),
  requestMove: () => request(),
  moveStatus: () => status(),
}))
vi.mock('../data/slots', () => ({ SlotActionError: FakeSlotActionError }))

const { TakeBackBooking } = await import('./TakeBackBooking')

describe('TakeBackBooking', () => {
  beforeEach(() => {
    available = true
    request = () => Promise.resolve('request-1')
    status = () => Promise.resolve('pending')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('offers nothing when the booking has no Telegram', async () => {
    available = false
    const { container } = render(<TakeBackBooking slotId="slot-1" onMoved={() => {}} />)
    await act(async () => {})
    expect(container.textContent).toBe('')
  })

  it('asks, waits, and hands over once Telegram approves', async () => {
    let moved = 0
    render(<TakeBackBooking slotId="slot-1" onMoved={() => (moved += 1)} />)
    const button = await screen.findByRole('button', { name: 'Ambil balik melalui Telegram' })

    vi.useFakeTimers({ shouldAdvanceTime: true })
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(button)
    expect(await screen.findByText(/Mesej dihantar ke Telegram/)).toBeTruthy()

    status = () => Promise.resolve('approved')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    await waitFor(() => expect(moved).toBe(1))
  })

  it('says so when the player answers no in Telegram', async () => {
    render(<TakeBackBooking slotId="slot-1" onMoved={() => {}} />)
    const button = await screen.findByRole('button', { name: 'Ambil balik melalui Telegram' })

    vi.useFakeTimers({ shouldAdvanceTime: true })
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(button)
    status = () => Promise.resolve('rejected')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(await screen.findByText(/ditolak di Telegram/)).toBeTruthy()
  })

  it('shows why a request was refused', async () => {
    request = () => Promise.reject(new FakeSlotActionError('Terlalu banyak permintaan untuk slot ini. Cuba lagi dalam sejam.', 'too_many_requests'))
    render(<TakeBackBooking slotId="slot-1" onMoved={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ambil balik melalui Telegram' }))
    expect(await screen.findByText(/Terlalu banyak permintaan/)).toBeTruthy()
  })
})
