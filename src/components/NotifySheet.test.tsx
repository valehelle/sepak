import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PushCapability } from '../lib/pushCapability'

// Both data modules are replaced outright rather than spread over the real
// ones: they import the supabase client, which throws at import time without
// credentials -- true in CI, hidden locally by .env.local.
let subscribes = 0
let subscribeImpl: () => Promise<void> = () => Promise.resolve()
vi.mock('../data/push', () => ({
  subscribeToPush: () => {
    subscribes += 1
    return subscribeImpl()
  },
  PushError: class extends Error {
    constructor(message: string, readonly code: string | null) { super(message) }
  },
}))

let links = 0
let linkImpl: () => Promise<string> = () => Promise.resolve('https://t.me/TestBot?start=abc')
let linked = false
vi.mock('../data/telegram', () => ({
  TELEGRAM_BOT: 'TestBot',
  createTelegramLink: () => {
    links += 1
    return linkImpl()
  },
  hasTelegramChat: () => Promise.resolve(linked),
  TelegramError: class extends Error {
    constructor(message: string, readonly code: string | null) { super(message) }
  },
}))

let capability: PushCapability = 'ready'
vi.mock('../lib/pushCapability', () => ({
  pushCapability: () => capability,
  isIosNonSafari: () => false,
  isStandalone: () => false,
  isIos: () => false,
}))

const { NotifySheet } = await import('./NotifySheet')

function view(onSubscribed = () => {}) {
  return render(<NotifySheet open onClose={() => {}} onSubscribed={onSubscribed} />)
}

describe('NotifySheet', () => {
  let opened: string[] = []

  beforeEach(() => {
    subscribes = 0
    links = 0
    linked = false
    subscribeImpl = () => Promise.resolve()
    linkImpl = () => Promise.resolve('https://t.me/TestBot?start=abc')
    capability = 'ready'
    opened = []
    Object.defineProperty(window, 'open', {
      configurable: true,
      value: (url: string) => {
        opened.push(url)
        return null
      },
    })
  })

  it('renders nothing when closed', () => {
    render(<NotifySheet open={false} onClose={() => {}} onSubscribed={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('leads with Telegram, because it is the option that works everywhere', () => {
    view()
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons[0]).toBe('Guna Telegram')
  })

  it('opens the t.me link and then waits to be told Start was pressed', async () => {
    view()
    await userEvent.click(screen.getByRole('button', { name: 'Guna Telegram' }))

    await waitFor(() => expect(opened).toEqual(['https://t.me/TestBot?start=abc']))
    expect(links).toBe(1)
    // Telegram cannot tell us, so the player does.
    expect(screen.getByRole('button', { name: 'Dah tekan Start' })).toBeTruthy()
  })

  it('confirms the link once the chat exists, and reports it upward', async () => {
    const onSubscribed = vi.fn()
    view(onSubscribed)
    await userEvent.click(screen.getByRole('button', { name: 'Guna Telegram' }))

    linked = true
    await userEvent.click(screen.getByRole('button', { name: 'Dah tekan Start' }))

    await waitFor(() => expect(screen.getByText(/mesej anda dalam Telegram/)).toBeTruthy())
    expect(onSubscribed).toHaveBeenCalled()
  })

  it('says so, and keeps the button, when Start has not been pressed yet', async () => {
    view()
    await userEvent.click(screen.getByRole('button', { name: 'Guna Telegram' }))
    await userEvent.click(screen.getByRole('button', { name: 'Dah tekan Start' }))

    await waitFor(() => expect(screen.getByText(/Belum sambung/)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Dah tekan Start' })).toBeTruthy()
  })

  it('explains a failure to mint the link', async () => {
    const { TelegramError } = await import('../data/telegram')
    linkImpl = () => Promise.reject(new TelegramError('Sertai senarai tunggu dulu sebelum sambung Telegram.', 'not_in_session'))
    view()
    await userEvent.click(screen.getByRole('button', { name: 'Guna Telegram' }))
    await waitFor(() => expect(screen.getByText(/Sertai senarai tunggu dulu/)).toBeTruthy())
  })

  it('offers browser notifications as well where they can work', async () => {
    const onSubscribed = vi.fn()
    view(onSubscribed)
    await userEvent.click(screen.getByRole('button', { name: 'Guna notifikasi telefon ni' }))

    await waitFor(() => expect(screen.getByText(/Telefon ni akan dapat notifikasi/)).toBeTruthy())
    expect(subscribes).toBe(1)
    expect(onSubscribed).toHaveBeenCalled()
  })

  it('hides the browser option on an iPhone that has not installed the app, and says why', () => {
    capability = 'needs-install'
    view()
    expect(screen.queryByRole('button', { name: 'Guna notifikasi telefon ni' })).toBeNull()
    expect(screen.getByText(/Home Screen/)).toBeTruthy()
    // Telegram is still on offer, which is the point of leading with it.
    expect(screen.getByRole('button', { name: 'Guna Telegram' })).toBeTruthy()
  })

  it('keeps Telegram on offer when browser notifications are blocked', () => {
    capability = 'blocked'
    view()
    expect(screen.queryByRole('button', { name: 'Guna notifikasi telefon ni' })).toBeNull()
    expect(screen.getByText(/Telegram masih boleh/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Guna Telegram' })).toBeTruthy()
  })

  it('explains a browser refusal without losing the sheet', async () => {
    const { PushError } = await import('../data/push')
    subscribeImpl = () => Promise.reject(new PushError('Anda tak izinkan notifikasi.', 'blocked'))
    view()
    await userEvent.click(screen.getByRole('button', { name: 'Guna notifikasi telefon ni' }))

    await waitFor(() => expect(screen.getByText('Anda tak izinkan notifikasi.')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Guna Telegram' })).toBeTruthy()
  })
})
