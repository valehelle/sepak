import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PushCapability } from '../lib/pushCapability'

// Replaced outright rather than spread over the real module: src/data/push
// imports the supabase client, which throws at import time with no
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

// The capability is what each test is really varying, so it is stubbed
// rather than simulated through a fake browser -- pushCapability's own
// detection is tested in src/lib/pushCapability.test.ts.
let capability: PushCapability = 'ready'
let iosNonSafari = false
vi.mock('../lib/pushCapability', () => ({
  pushCapability: () => capability,
  isIosNonSafari: () => iosNonSafari,
  isStandalone: () => false,
  isIos: () => false,
}))

const { PushPrompt } = await import('./PushPrompt')

function view(overrides: { onClose?: () => void; onSubscribed?: () => void } = {}) {
  return render(
    <PushPrompt
      open
      onClose={overrides.onClose ?? (() => {})}
      onSubscribed={overrides.onSubscribed ?? (() => {})}
    />,
  )
}

describe('PushPrompt', () => {
  beforeEach(() => {
    subscribes = 0
    subscribeImpl = () => Promise.resolve()
    capability = 'ready'
    iosNonSafari = false
  })

  it('renders nothing when closed', () => {
    render(<PushPrompt open={false} onClose={() => {}} onSubscribed={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('subscribes on accept, then says so and reports it upward', async () => {
    const onSubscribed = vi.fn()
    view({ onSubscribed })

    await userEvent.click(screen.getByRole('button', { name: 'Ya, beritahu saya' }))

    await waitFor(() => expect(screen.getByText(/Siap\./)).toBeTruthy())
    expect(subscribes).toBe(1)
    expect(onSubscribed).toHaveBeenCalled()
  })

  it('explains a failure and leaves the button usable', async () => {
    const { PushError } = await import('../data/push')
    subscribeImpl = () => Promise.reject(new PushError('Anda tak izinkan notifikasi.', 'blocked'))
    view()

    await userEvent.click(screen.getByRole('button', { name: 'Ya, beritahu saya' }))

    await waitFor(() => expect(screen.getByText('Anda tak izinkan notifikasi.')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Ya, beritahu saya' })).toBeTruthy()
  })

  it('gives an iPhone the install steps instead of a button that cannot work', () => {
    capability = 'needs-install'
    view()

    // Read off the sheet as a whole: the steps put "Safari" and "Add to Home
    // Screen" in their own elements for emphasis, so no single node holds a
    // whole sentence.
    const sheet = screen.getByRole('dialog').textContent ?? ''
    expect(sheet).toContain('iPhone hanya izinkan notifikasi')
    expect(sheet).toContain('Add to Home Screen')
    expect(screen.queryByRole('button', { name: 'Ya, beritahu saya' })).toBeNull()
    expect(subscribes).toBe(0)
  })

  it('tells an iPhone on Chrome to switch to Safari, where the steps actually work', () => {
    capability = 'needs-install'
    iosNonSafari = true
    view()
    expect(screen.getByRole('dialog').textContent ?? '').toContain('dalam Safari dulu')
  })

  it('omits the Safari warning in Safari itself', () => {
    capability = 'needs-install'
    view()
    expect(screen.getByRole('dialog').textContent ?? '').not.toContain('dalam Safari dulu')
  })

  it('says how to undo a refusal, since it cannot ask again', () => {
    capability = 'blocked'
    view()
    expect(screen.getByText(/disekat untuk laman ni/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ya, beritahu saya' })).toBeNull()
  })

  it('falls back to the group chat where push does not exist at all', () => {
    capability = 'unsupported'
    view()
    expect(screen.getByText(/kumpulan WhatsApp/)).toBeTruthy()
  })
})
