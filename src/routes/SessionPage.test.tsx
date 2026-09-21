import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { firstOf } from '../test-utils'
import type { Session, Slot } from '../data/types'
import type { MyWaitlistEntry, WaitlistEntry } from '../data/waitlist'

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

function emptySlots(): Slot[] {
  const positions = ['GK', 'LB', 'CB1', 'CB2', 'RB', 'DM', 'MC', 'AM', 'LWF', 'RWF', 'ST'] as const
  return (['A', 'B', 'C'] as const).flatMap((team) =>
    positions.map((position): Slot => ({
      id: `${team}-${position}`,
      sessionId: 'session-1',
      team,
      position,
      playerName: null,
      claimedAt: null,
      paid: false,
    })),
  )
}

function replace(slots: readonly Slot[], next: Slot): Slot[] {
  const index = slots.findIndex((slot) => slot.id === next.id)
  if (index === -1) return [...slots, next]
  return slots.map((slot) => (slot.id === next.id ? next : slot))
}

function withOwned(current: ReadonlySet<string>, slotId: string, owned: boolean): Set<string> {
  const next = new Set(current)
  if (owned) next.add(slotId)
  else next.delete(slotId)
  return next
}

function upsertWaitlist(entries: readonly WaitlistEntry[], next: WaitlistEntry): WaitlistEntry[] {
  return [...entries.filter((e) => e.id !== next.id), next]
}

function removeWaitlist(entries: readonly WaitlistEntry[], id: string): WaitlistEntry[] {
  return entries.filter((e) => e.id !== id)
}

const state = {
  session: SESSION as Session | null,
  slots: emptySlots(),
  mySlotIds: new Set<string>(),
  waitlist: [] as WaitlistEntry[],
  myWaitlistEntry: null as MyWaitlistEntry | null,
  loading: false,
  error: null as string | null,
  notFound: false,
  // Real (not just recorded) implementations: mutating `state` here is what
  // lets a test assert on rendered DOM after an optimistic change, rather
  // than only on the call the page made — the difference between "the page
  // asked to clear the slot" and "the player actually stops seeing it".
  applyLocal: vi.fn((slot: Slot) => { state.slots = replace(state.slots, slot) }),
  setOwned: vi.fn((slotId: string, owned: boolean) => { state.mySlotIds = withOwned(state.mySlotIds, slotId, owned) }),
  applyWaitlistLocal: vi.fn((entry: WaitlistEntry) => { state.waitlist = upsertWaitlist(state.waitlist, entry) }),
  removeWaitlistLocal: vi.fn((id: string) => { state.waitlist = removeWaitlist(state.waitlist, id) }),
  setMyWaitlistEntry: vi.fn((entry: MyWaitlistEntry | null) => { state.myWaitlistEntry = entry }),
  refetch: vi.fn(),
}

const claimSlot = vi.fn()
const releaseSlot = vi.fn()
const setSlotPaid = vi.fn()
const adminClearSlot = vi.fn()
const joinWaitlist = vi.fn()
const leaveWaitlist = vi.fn()
const writeText = vi.fn()
const authState = { email: null as string | null, role: null as 'super' | 'admin' | null, loading: false }

vi.mock('../data/useSessionRealtime', () => ({ useSessionRealtime: () => state }))
vi.mock('../data/auth', () => ({ useAuthUser: () => authState }))
vi.mock('../data/slots', () => ({
  claimSlot: (...args: unknown[]) => claimSlot(...args),
  releaseSlot: (...args: unknown[]) => releaseSlot(...args),
  setSlotPaid: (...args: unknown[]) => setSlotPaid(...args),
  adminClearSlot: (id: string) => adminClearSlot(id),
  SlotActionError: class extends Error {
    constructor(message: string, readonly code: string | null) { super(message) }
  },
}))
// SessionPage asks both channels whether this device is already notified;
// mocked here so the page's tests need no supabase credentials. The sheet's
// own behaviour is tested in src/components/NotifySheet.test.tsx.
let pushOn = false
vi.mock('../data/push', () => ({
  hasPushSubscription: () => Promise.resolve(pushOn),
  subscribeToPush: () => Promise.resolve(),
  PushError: class extends Error {
    constructor(message: string, readonly code: string | null) { super(message) }
  },
}))
vi.mock('../data/telegram', () => ({
  TELEGRAM_BOT: 'GengTurunPeluhBot',
  hasTelegramChat: () => Promise.resolve(false),
  createTelegramLink: () => Promise.resolve('https://t.me/GengTurunPeluhBot?start=code'),
  TelegramError: class extends Error {
    constructor(message: string, readonly code: string | null) { super(message) }
  },
}))
vi.mock('../lib/pushCapability', () => ({
  pushCapability: () => 'ready',
  isIosNonSafari: () => false,
  isStandalone: () => false,
  isIos: () => false,
}))

const getContactPhone = vi.fn()
vi.mock('../data/contacts', () => ({
  getContactPhone: (target: unknown) => getContactPhone(target),
  ContactError: class extends Error {
    constructor(message: string, readonly code: string | null) { super(message) }
  },
}))
vi.mock('../data/waitlist', () => ({
  joinWaitlist: (...args: unknown[]) => joinWaitlist(...args),
  leaveWaitlist: (...args: unknown[]) => leaveWaitlist(...args),
  WaitlistActionError: class extends Error {
    constructor(message: string, readonly code: string | null) { super(message) }
  },
}))
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router')
  return { ...actual, useParams: () => ({ id: 'session-1' }) }
})

const { ToastProvider } = await import('../components/Toast')
const { default: SessionPage } = await import('./SessionPage')

function view() {
  return render(
    <MemoryRouter>
      <ToastProvider><SessionPage /></ToastProvider>
    </MemoryRouter>,
  )
}

/** Marks a slot as claimed by 'Hazmi' in the fixture list, without mutating
 *  the original array in place. */
function withClaim(slots: readonly Slot[], slotId: string): Slot[] {
  return slots.map((slot) => (slot.id === slotId ? { ...slot, playerName: 'Hazmi', claimedAt: 'now' } : slot))
}

function findSlot(slots: readonly Slot[], slotId: string): Slot {
  const found = slots.find((slot) => slot.id === slotId)
  if (found === undefined) throw new Error(`missing fixture: ${slotId}`)
  return found
}

describe('SessionPage', () => {
  beforeEach(() => {
    pushOn = false
    state.session = SESSION
    state.slots = emptySlots()
    state.mySlotIds = new Set<string>()
    state.waitlist = []
    state.myWaitlistEntry = null
    state.loading = false
    state.error = null
    state.notFound = false
    claimSlot.mockReset()
    releaseSlot.mockReset()
    adminClearSlot.mockReset().mockResolvedValue(undefined)
    joinWaitlist.mockReset()
    leaveWaitlist.mockReset().mockResolvedValue(undefined)
    writeText.mockReset()
    getContactPhone.mockReset().mockResolvedValue(null)
    localStorage.clear()
    authState.email = null
    authState.role = null
    // `mockReset` would also discard the implementations above, so the
    // mutating behaviour is reinstated fresh each test instead of reset away.
    state.applyLocal = vi.fn((slot: Slot) => { state.slots = replace(state.slots, slot) })
    state.setOwned = vi.fn((slotId: string, owned: boolean) => { state.mySlotIds = withOwned(state.mySlotIds, slotId, owned) })
    state.applyWaitlistLocal = vi.fn((entry: WaitlistEntry) => { state.waitlist = upsertWaitlist(state.waitlist, entry) })
    state.removeWaitlistLocal = vi.fn((id: string) => { state.waitlist = removeWaitlist(state.waitlist, id) })
    state.setMyWaitlistEntry = vi.fn((entry: MyWaitlistEntry | null) => { state.myWaitlistEntry = entry })
    state.refetch.mockReset()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })

  it('shows the session header and all three teams', () => {
    view()
    expect(screen.getByRole('heading', { name: 'Sesi 005 Geng Turun Peluh' })).toBeTruthy()
    expect(screen.getByText('Team A Merah')).toBeTruthy()
    expect(screen.getByText('Team B Putih')).toBeTruthy()
    expect(screen.getByText('Team C Kuning')).toBeTruthy()
    expect(screen.getByText('0/33 penuh')).toBeTruthy()
  })

  it('claims a slot through the name sheet', async () => {
    claimSlot.mockResolvedValue({ ...firstOf(state.slots), playerName: 'Hazmi', claimedAt: 'now' })
    view()

    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^GK/ })))
    await userEvent.type(screen.getByLabelText('Nama'), 'Hazmi')
    await userEvent.type(screen.getByLabelText('Nombor telefon'), '012-345 6789')
    await userEvent.click(screen.getByRole('button', { name: 'Ambil slot' }))

    // The phone reaches the server normalised, whatever punctuation was typed.
    await waitFor(() => expect(claimSlot).toHaveBeenCalledWith('A-GK', 'Hazmi', '60123456789'))
    await waitFor(() => expect(state.setOwned).toHaveBeenCalledWith('A-GK', true))
  })

  it('refuses a phone that is not a Malaysian mobile', async () => {
    view()
    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^GK/ })))
    await userEvent.type(screen.getByLabelText('Nama'), 'Hazmi')
    await userEvent.type(screen.getByLabelText('Nombor telefon'), '03-1234 5678')
    await userEvent.click(screen.getByRole('button', { name: 'Ambil slot' }))
    expect(claimSlot).not.toHaveBeenCalled()
    expect(screen.getByText(/Nombor telefon tak sah/)).toBeTruthy()
  })

  it('refuses to submit without a phone', async () => {
    view()
    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^GK/ })))
    await userEvent.type(screen.getByLabelText('Nama'), 'Hazmi')
    await userEvent.click(screen.getByRole('button', { name: 'Ambil slot' }))
    expect(claimSlot).not.toHaveBeenCalled()
    expect(screen.getByText(/Isi nombor telefon/)).toBeTruthy()
  })

  it('remembers name and phone after a claim', async () => {
    claimSlot.mockResolvedValue({ ...firstOf(state.slots), playerName: 'Hazmi', claimedAt: 'now' })
    view()
    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^GK/ })))
    await userEvent.type(screen.getByLabelText('Nama'), 'Hazmi')
    await userEvent.type(screen.getByLabelText('Nombor telefon'), '0123456789')
    await userEvent.click(screen.getByRole('button', { name: 'Ambil slot' }))

    await waitFor(() => expect(claimSlot).toHaveBeenCalled())
    const { recallPlayer } = await import('../lib/playerMemory')
    await waitFor(() => expect(recallPlayer()).toEqual({ name: 'Hazmi', phone: '60123456789' }))
  })

  it('prefills a remembered name and phone the next time a sheet opens', async () => {
    const { rememberPlayer } = await import('../lib/playerMemory')
    rememberPlayer({ name: 'Hazmi', phone: '60123456789' })
    view()

    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^LB/ })))
    expect(screen.getByLabelText<HTMLInputElement>('Nama').value).toBe('Hazmi')
    // Shown in the readable national form, sent normalised.
    expect(screen.getByLabelText<HTMLInputElement>('Nombor telefon').value).toBe('012-345 6789')
  })

  it('refuses to submit a blank name', async () => {
    view()
    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^GK/ })))
    await userEvent.click(screen.getByRole('button', { name: 'Ambil slot' }))
    expect(claimSlot).not.toHaveBeenCalled()
    expect(screen.getByText(/Isi nama/)).toBeTruthy()
  })

  it('reverts the optimistic claim and ownership, and reports the reason on failure', async () => {
    const { SlotActionError } = await import('../data/slots')
    claimSlot.mockRejectedValue(new SlotActionError('Slot dah diambil.', 'slot_taken'))
    view()

    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^GK/ })))
    await userEvent.type(screen.getByLabelText('Nama'), 'Hazmi')
    await userEvent.type(screen.getByLabelText('Nombor telefon'), '0123456789')
    await userEvent.click(screen.getByRole('button', { name: 'Ambil slot' }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Slot dah diambil.'))
    expect(screen.queryByText('Hazmi')).toBeNull()

    // both the optimistic slot write and the optimistic ownership grant must
    // be undone, in the order they were applied.
    const [firstOwned, secondOwned] = state.setOwned.mock.calls
    expect(firstOwned).toEqual(['A-GK', true])
    expect(secondOwned).toEqual(['A-GK', false])

    const [firstApplied, secondApplied] = state.applyLocal.mock.calls
    expect(firstApplied?.[0]).toMatchObject({ id: 'A-GK', playerName: 'Hazmi' })
    expect(secondApplied?.[0]).toMatchObject({ id: 'A-GK', playerName: null, claimedAt: null })

    expect(state.refetch).toHaveBeenCalled()
  })

  it('offers release on your own slot', async () => {
    state.slots = withClaim(state.slots, 'A-ST')
    state.mySlotIds = new Set(['A-ST'])
    releaseSlot.mockResolvedValue({ ...findSlot(state.slots, 'A-ST'), playerName: null, claimedAt: null })
    view()

    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^ST/ })))
    expect(screen.getByRole('button', { name: 'Lepaskan slot' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Lepaskan slot' }))
    await userEvent.click(screen.getByRole('button', { name: 'Ya, lepaskan slot' }))
    await waitFor(() => expect(releaseSlot).toHaveBeenCalledWith('A-ST'))
    await waitFor(() => expect(state.setOwned).toHaveBeenCalledWith('A-ST', false))
  })

  it('reverts the optimistic release and ownership, and reports the reason on failure', async () => {
    const { SlotActionError } = await import('../data/slots')
    state.slots = withClaim(state.slots, 'A-ST')
    state.mySlotIds = new Set(['A-ST'])
    releaseSlot.mockRejectedValue(new SlotActionError('Slot ini bukan milik anda.', 'wrong_token'))
    view()

    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^ST/ })))
    await userEvent.click(screen.getByRole('button', { name: 'Lepaskan slot' }))
    await userEvent.click(screen.getByRole('button', { name: 'Ya, lepaskan slot' }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Slot ini bukan milik anda.'))

    // both the optimistic release and the optimistic ownership drop must be
    // undone, in the order they were applied.
    const [firstOwned, secondOwned] = state.setOwned.mock.calls
    expect(firstOwned).toEqual(['A-ST', false])
    expect(secondOwned).toEqual(['A-ST', true])

    const [firstApplied, secondApplied] = state.applyLocal.mock.calls
    expect(firstApplied?.[0]).toMatchObject({ id: 'A-ST', playerName: null })
    expect(secondApplied?.[0]).toMatchObject({ id: 'A-ST', playerName: 'Hazmi' })

    expect(state.refetch).toHaveBeenCalled()

    // the player's name is restored in the rendered DOM, not just requested.
    const stButtons = screen.getAllByRole('button', { name: /^ST/ })
    expect(firstOf(stButtons).getAttribute('aria-label')).toContain('Hazmi')
  })

  it('locks every empty slot once this device holds one, and says why', () => {
    state.slots = withClaim(state.slots, 'B-MC')
    state.mySlotIds = new Set(['B-MC'])
    view()

    expect(screen.getByText(/Satu slot untuk satu peranti/)).toBeTruthy()
    // An empty slot must not even open the form: claim_slot would refuse it.
    const emptyGk = firstOf(screen.getAllByRole('button', { name: /^GK — kosong/ }))
    expect(emptyGk.hasAttribute('disabled')).toBe(true)
    // The device's own slot stays tappable, so it can still be released.
    expect(screen.getByRole('button', { name: /^MC.*slot anda/i }).hasAttribute('disabled')).toBe(false)
  })

  it('leaves empty slots tappable when this device holds none', () => {
    view()
    const emptyGk = firstOf(screen.getAllByRole('button', { name: /^GK — kosong/ }))
    expect(emptyGk.hasAttribute('disabled')).toBe(false)
    expect(screen.queryByText(/Satu slot untuk satu peranti/)).toBeNull()
  })

  it('summarises your slot at the top of the page', () => {
    state.slots = withClaim(state.slots, 'B-MC')
    state.mySlotIds = new Set(['B-MC'])
    view()
    expect(screen.getByText(/Slot anda: Team B Putih — MC/)).toBeTruthy()
  })

  it('copies the WhatsApp message', async () => {
    writeText.mockResolvedValue(undefined)
    view()
    await userEvent.click(screen.getByRole('button', { name: /Salin untuk WhatsApp/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const copied = String(firstOf(firstOf(writeText.mock.calls)))
    expect(copied).toContain('Sesi 005 Geng Turun Peluh')
    expect(copied).toContain('💵 Yuran: RM 27/pax')
  })

  it('locks the list when the session is closed', () => {
    state.session = { ...SESSION, status: 'closed' }
    view()
    expect(screen.getByText('Sesi ditutup')).toBeTruthy()
    for (const button of screen.getAllByRole('button', { name: /^GK/ })) {
      expect(button).toHaveProperty('disabled', true)
    }
  })

  it('reports a missing session', () => {
    state.notFound = true
    state.session = null
    view()
    expect(screen.getByText('Sesi tak dijumpai.')).toBeTruthy()
  })

  it('offers a retry when loading failed', async () => {
    state.error = 'offline'
    state.session = null
    view()
    await userEvent.click(screen.getByRole('button', { name: 'Cuba lagi' }))
    expect(state.refetch).toHaveBeenCalled()
  })

  it('toggles between pitch and list view', async () => {
    view()
    await userEvent.click(screen.getByRole('button', { name: 'Papar senarai' }))
    expect(screen.getByRole('button', { name: 'Papar padang' })).toBeTruthy()
    expect(localStorage.getItem('sepak.viewMode')).toBe('list')
  })

  it('warns about a duplicate name but still allows the claim', async () => {
    state.slots = withClaim(state.slots, 'B-GK')
    claimSlot.mockResolvedValue({ ...findSlot(state.slots, 'A-GK'), playerName: 'Hazmi', claimedAt: 'now' })
    view()

    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^GK/ })))
    await userEvent.type(screen.getByLabelText('Nama'), 'Hazmi')

    expect(screen.getByText(/Nama ini dah ada dalam sesi/)).toBeTruthy()

    await userEvent.type(screen.getByLabelText('Nombor telefon'), '0123456789')
    await userEvent.click(screen.getByRole('button', { name: 'Ambil slot' }))
    await waitFor(() => expect(claimSlot).toHaveBeenCalledWith('A-GK', 'Hazmi', '60123456789'))
  })

  it('does not warn when the name is unique', async () => {
    view()
    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^GK/ })))
    await userEvent.type(screen.getByLabelText('Nama'), 'Zulazhar')
    expect(screen.queryByText(/Nama ini dah ada/)).toBeNull()
  })

  it('offers the organiser an override on any occupied slot', async () => {
    authState.email = 'hazmi@example.com'
    authState.role = 'admin'
    state.slots = state.slots.map((slot) =>
      slot.id === 'A-LB' ? { ...slot, playerName: 'Joke Name', claimedAt: 'now' } : slot,
    )
    view()

    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^LB/ })))
    await userEvent.click(screen.getByRole('button', { name: 'Kosongkan slot (admin)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Ya, kosongkan slot' }))
    await waitFor(() => expect(adminClearSlot).toHaveBeenCalledWith('A-LB'))
  })

  it('shows the organiser the occupant\'s phone with WhatsApp and call links', async () => {
    authState.email = 'hazmi@example.com'
    authState.role = 'admin'
    getContactPhone.mockResolvedValue('60123456789')
    state.slots = state.slots.map((slot) =>
      slot.id === 'A-LB' ? { ...slot, playerName: 'Amir', claimedAt: 'now' } : slot,
    )
    view()

    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^LB/ })))
    expect(getContactPhone).toHaveBeenCalledWith({ slotId: 'A-LB' })
    await waitFor(() => expect(screen.getByText('012-345 6789')).toBeTruthy())
    expect(screen.getByRole('link', { name: 'WhatsApp' }).getAttribute('href')).toBe('https://wa.me/60123456789')
  })

  it('never looks a phone up for a player, even on their own slot', async () => {
    state.slots = withClaim(state.slots, 'B-MC')
    state.mySlotIds = new Set(['B-MC'])
    view()
    await userEvent.click(screen.getByRole('button', { name: /^MC.*slot anda/i }))
    expect(screen.getByRole('button', { name: 'Lepaskan slot' })).toBeTruthy()
    expect(getContactPhone).not.toHaveBeenCalled()
  })

  it('does not offer the override to a player', async () => {
    authState.email = null
    authState.role = null
    state.slots = state.slots.map((slot) =>
      slot.id === 'A-LB' ? { ...slot, playerName: 'Amir', claimedAt: 'now' } : slot,
    )
    view()
    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^LB/ })))
    expect(screen.queryByRole('button', { name: /admin/i })).toBeNull()
  })

  it('does not offer the override to a signed-in user who is not on the allowlist', async () => {
    // Signed in (there is a session/email) but no admins row -- role stays
    // null. The override must key off role, not merely being authenticated.
    authState.email = 'stranger@example.com'
    authState.role = null
    state.slots = state.slots.map((slot) =>
      slot.id === 'A-LB' ? { ...slot, playerName: 'Amir', claimedAt: 'now' } : slot,
    )
    view()
    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^LB/ })))
    expect(screen.queryByRole('button', { name: /admin/i })).toBeNull()
  })

  it('reports the specific reason when an admin clear fails', async () => {
    const { SlotActionError } = await import('../data/slots')
    authState.email = 'hazmi@example.com'
    authState.role = 'admin'
    state.slots = state.slots.map((slot) =>
      slot.id === 'A-LB' ? { ...slot, playerName: 'Joke Name', claimedAt: 'now' } : slot,
    )
    adminClearSlot.mockRejectedValue(new SlotActionError('Slot tak dijumpai.', 'slot_not_found'))
    view()

    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^LB/ })))
    await userEvent.click(screen.getByRole('button', { name: 'Kosongkan slot (admin)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Ya, kosongkan slot' }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Slot tak dijumpai.'))
  })

  it('drops local ownership when the organiser clears their own slot via the override', async () => {
    authState.email = 'hazmi@example.com'
    authState.role = 'admin'
    state.slots = withClaim(state.slots, 'B-MC')
    state.mySlotIds = new Set(['B-MC'])
    view()

    expect(screen.getByText(/Slot anda: Team B Putih — MC/)).toBeTruthy()

    // Three teams each have an MC slot; only Team B's is claimed and owned.
    await userEvent.click(screen.getByRole('button', { name: /^MC.*slot anda/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Kosongkan slot (admin)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Ya, kosongkan slot' }))

    // The "Slot anda" summary reads off mySlotIds against the current slot
    // list, so it must disappear once ownership is actually dropped — not
    // merely because the slot happens to render as empty.
    await waitFor(() => expect(screen.queryByText(/Slot anda:/)).toBeNull())
  })

  it('replaces the old full-list message with the waitlist affordance when every slot is taken', () => {
    state.slots = state.slots.map((slot) => ({ ...slot, playerName: 'Someone', claimedAt: 'now' }))
    view()
    expect(screen.queryByText(/Semua slot dah penuh/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Sertai senarai tunggu' })).toBeTruthy()
  })

  it('offers the waitlist button even while slots remain open', () => {
    view()
    expect(screen.getByText(/Tekan posisi kosong untuk daftar/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sertai senarai tunggu' })).toBeTruthy()
  })

  it('joins the waitlist and shows the device in the queue', async () => {
    joinWaitlist.mockResolvedValue({ placed: false, waitlistId: 'wait-1' })
    view()

    await userEvent.click(screen.getByRole('button', { name: 'Sertai senarai tunggu' }))
    await userEvent.type(screen.getByLabelText('Nama'), 'Faiz')
    await userEvent.type(screen.getByLabelText('Nombor telefon'), '+60 19-876 5432')
    await userEvent.click(screen.getByRole('button', { name: 'MC' }))
    await userEvent.click(screen.getByRole('button', { name: 'AM' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sertai' }))

    await waitFor(() => expect(joinWaitlist).toHaveBeenCalledWith('session-1', 'Faiz', '60198765432', ['MC', 'AM']))
    await waitFor(() => expect(screen.getByText(/1\. Faiz/)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Keluar dari senarai tunggu' })).toBeTruthy()
    // The sheet closes and the player is no longer prompted to join again.
    expect(screen.queryByLabelText('Nama')).toBeNull()
  })

  it('offers notifications the moment a join actually queues', async () => {
    joinWaitlist.mockResolvedValue({ placed: false, waitlistId: 'wait-1' })
    view()

    await userEvent.click(screen.getByRole('button', { name: 'Sertai senarai tunggu' }))
    await userEvent.type(screen.getByLabelText('Nama'), 'Faiz')
    await userEvent.type(screen.getByLabelText('Nombor telefon'), '019-876 5432')
    await userEvent.click(screen.getByRole('button', { name: 'MC' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sertai' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Guna Telegram' })).toBeTruthy())
  })

  it('does not offer notifications when the join landed a slot instead', async () => {
    // Nothing to be notified about: they already have the position.
    joinWaitlist.mockResolvedValue({ placed: true, slotId: 'A-GK' })
    view()

    await userEvent.click(screen.getByRole('button', { name: 'Sertai senarai tunggu' }))
    await userEvent.type(screen.getByLabelText('Nama'), 'Faiz')
    await userEvent.type(screen.getByLabelText('Nombor telefon'), '019-876 5432')
    await userEvent.click(screen.getByRole('button', { name: 'MC' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sertai' }))

    await waitFor(() => expect(screen.queryByLabelText('Nama')).toBeNull())
    expect(screen.queryByRole('button', { name: 'Guna Telegram' })).toBeNull()
  })

  it('keeps offering the button to a queued device that has not subscribed', async () => {
    // The iOS round trip depends on this: the first tap only produces
    // install instructions, and this button is what they come back to.
    pushOn = false
    state.waitlist = [{ id: 'wait-1', sessionId: 'session-1', playerName: 'Faiz', positions: ['GK'], createdAt: 't1' }]
    state.myWaitlistEntry = { id: 'wait-1', positions: ['GK'], createdAt: 't1' }
    view()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Hidupkan notifikasi' })).toBeTruthy())
  })

  it('offers it to a device holding a slot too, since the subscription outlives one booking', async () => {
    pushOn = false
    state.slots = withClaim(state.slots, 'A-ST')
    state.mySlotIds = new Set(['A-ST'])
    view()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Hidupkan notifikasi' })).toBeTruthy())
  })

  it('offers nothing to a device with no place in the session', async () => {
    // save_push_subscription would refuse it, so a button here could only fail.
    pushOn = false
    view()

    await waitFor(() => expect(screen.getByText(/Tekan posisi kosong/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Hidupkan notifikasi' })).toBeNull()
  })

  it('stops offering the button once this device is subscribed', async () => {
    pushOn = true
    state.waitlist = [{ id: 'wait-1', sessionId: 'session-1', playerName: 'Faiz', positions: ['GK'], createdAt: 't1' }]
    state.myWaitlistEntry = { id: 'wait-1', positions: ['GK'], createdAt: 't1' }
    view()

    await waitFor(() => expect(screen.getByText(/Notifikasi hidup/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Hidupkan notifikasi' })).toBeNull()
  })

  it('closes the sheet and highlights the slot when joining places immediately', async () => {
    joinWaitlist.mockResolvedValue({ placed: true, slotId: 'A-GK' })
    view()

    await userEvent.click(screen.getByRole('button', { name: 'Sertai senarai tunggu' }))
    await userEvent.type(screen.getByLabelText('Nama'), 'Faiz')
    await userEvent.type(screen.getByLabelText('Nombor telefon'), '0198765432')
    await userEvent.click(screen.getByRole('button', { name: 'GK' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sertai' }))

    await waitFor(() => expect(state.setOwned).toHaveBeenCalledWith('A-GK', true))
    expect(screen.queryByLabelText('Nama')).toBeNull()
  })

  it('reports the reason when joining the waitlist fails', async () => {
    const { WaitlistActionError } = await import('../data/waitlist')
    joinWaitlist.mockRejectedValue(new WaitlistActionError('Anda dah ada slot dalam sesi ini.', 'already_in_slot'))
    view()

    await userEvent.click(screen.getByRole('button', { name: 'Sertai senarai tunggu' }))
    await userEvent.type(screen.getByLabelText('Nama'), 'Faiz')
    await userEvent.type(screen.getByLabelText('Nombor telefon'), '0198765432')
    await userEvent.click(screen.getByRole('button', { name: 'GK' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sertai' }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Anda dah ada slot dalam sesi ini.'))
  })

  it("shows the whole queue, highlighting only the device's own entry", () => {
    state.waitlist = [
      { id: 'wait-1', sessionId: 'session-1', playerName: 'Faiz', positions: ['GK'], createdAt: 't1' },
      { id: 'wait-2', sessionId: 'session-1', playerName: 'Nabil', positions: ['MC', 'AM'], createdAt: 't2' },
    ]
    state.myWaitlistEntry = { id: 'wait-2', positions: ['MC', 'AM'], createdAt: 't2' }
    view()

    expect(screen.getByText(/1\. Faiz/)).toBeTruthy()
    expect(screen.getByText(/2\. Nabil/)).toBeTruthy()
    // Only the device's own row offers the leave button.
    expect(screen.getAllByRole('button', { name: 'Keluar dari senarai tunggu' })).toHaveLength(1)
    // Players get no phone affordance on the queue.
    expect(screen.queryByRole('button', { name: 'Lihat nombor' })).toBeNull()
  })

  it('lets the organiser reveal a queue entry\'s phone on demand', async () => {
    authState.email = 'hazmi@example.com'
    authState.role = 'admin'
    getContactPhone.mockResolvedValue('60198765432')
    state.waitlist = [{ id: 'wait-1', sessionId: 'session-1', playerName: 'Faiz', positions: ['GK'], createdAt: 't1' }]
    view()

    expect(getContactPhone).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Lihat nombor' }))
    expect(getContactPhone).toHaveBeenCalledWith({ waitlistId: 'wait-1' })
    await waitFor(() => expect(screen.getByText('019-876 5432')).toBeTruthy())
  })

  it('leaves the waitlist', async () => {
    state.waitlist = [{ id: 'wait-1', sessionId: 'session-1', playerName: 'Faiz', positions: ['GK'], createdAt: 't1' }]
    state.myWaitlistEntry = { id: 'wait-1', positions: ['GK'], createdAt: 't1' }
    view()

    await userEvent.click(screen.getByRole('button', { name: 'Keluar dari senarai tunggu' }))

    await waitFor(() => expect(leaveWaitlist).toHaveBeenCalledWith('session-1'))
    await waitFor(() => expect(screen.queryByText(/Faiz/)).toBeNull())
  })

  it('carries the paid tick into the WhatsApp text', async () => {
    state.slots = state.slots.map((slot) =>
      slot.id === 'A-ST' ? { ...slot, playerName: 'Hazmi', claimedAt: 'now', paid: true } : slot,
    )
    writeText.mockResolvedValue(undefined)
    view()
    await userEvent.click(screen.getByRole('button', { name: /Salin untuk WhatsApp/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(String(firstOf(firstOf(writeText.mock.calls)))).toContain('ST- Hazmi ✅')
  })

  it('includes the waitlist in the WhatsApp text', async () => {
    state.waitlist = [{ id: 'wait-1', sessionId: 'session-1', playerName: 'Faiz', positions: ['GK'], createdAt: 't1' }]
    writeText.mockResolvedValue(undefined)
    view()
    await userEvent.click(screen.getByRole('button', { name: /Salin untuk WhatsApp/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const copied = String(firstOf(firstOf(writeText.mock.calls)))
    expect(copied).toContain('Senarai Tunggu\n1. Faiz (GK)')
  })
  it('marks your own slot paid and keeps the sheet open, so a mis-tap can be undone', async () => {
    state.slots = withClaim(state.slots, 'A-ST')
    state.mySlotIds = new Set(['A-ST'])
    setSlotPaid.mockResolvedValue({ ...findSlot(state.slots, 'A-ST'), paid: true })
    view()

    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^ST/ })))
    const tick = screen.getByRole('button', { name: 'Dah bayar' })
    expect(tick.getAttribute('aria-pressed')).toBe('false')

    await userEvent.click(tick)

    await waitFor(() => expect(setSlotPaid).toHaveBeenCalledWith('A-ST', true))
    // Still open, and the checkbox has moved: the sheet is the only place
    // the tick can be taken back off.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Dah bayar' }).getAttribute('aria-pressed')).toBe('true'),
    )
    expect(screen.getByRole('button', { name: 'Lepaskan slot' })).toBeTruthy()
  })

  it('puts the tick back and reports the reason when the write fails', async () => {
    const { SlotActionError } = await import('../data/slots')
    state.slots = withClaim(state.slots, 'A-ST')
    state.mySlotIds = new Set(['A-ST'])
    setSlotPaid.mockRejectedValue(new SlotActionError('Slot ini bukan milik anda.', 'wrong_token'))
    view()

    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^ST/ })))
    await userEvent.click(screen.getByRole('button', { name: 'Dah bayar' }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Slot ini bukan milik anda.'))
    expect(screen.getByRole('button', { name: 'Dah bayar' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('never releases on the first tap, and Batal disarms it', async () => {
    state.slots = withClaim(state.slots, 'A-ST')
    state.mySlotIds = new Set(['A-ST'])
    view()

    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^ST/ })))
    await userEvent.click(screen.getByRole('button', { name: 'Lepaskan slot' }))
    expect(releaseSlot).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Batal' }))
    expect(releaseSlot).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Lepaskan slot' })).toBeTruthy()
  })

  it('needs a second tap before the organiser override empties a slot', async () => {
    authState.role = 'admin'
    state.slots = state.slots.map((slot) =>
      slot.id === 'A-LB' ? { ...slot, playerName: 'Joke Name', claimedAt: 'now' } : slot,
    )
    view()

    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^LB/ })))
    await userEvent.click(screen.getByRole('button', { name: 'Kosongkan slot (admin)' }))
    expect(adminClearSlot).not.toHaveBeenCalled()
    expect(screen.getByText('Buang Joke Name dari posisi ini?')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Ya, kosongkan slot' }))
    await waitFor(() => expect(adminClearSlot).toHaveBeenCalledWith('A-LB'))
  })
})
