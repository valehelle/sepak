import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { firstOf } from '../test-utils'
import type { Session, Slot } from '../data/types'

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
    })),
  )
}

const state = {
  session: SESSION as Session | null,
  slots: emptySlots(),
  mySlotIds: new Set<string>(),
  loading: false,
  error: null as string | null,
  notFound: false,
  applyLocal: vi.fn(),
  setOwned: vi.fn(),
  refetch: vi.fn(),
}

const claimSlot = vi.fn()
const releaseSlot = vi.fn()
const moveSlot = vi.fn()
const writeText = vi.fn()

vi.mock('../data/useSessionRealtime', () => ({ useSessionRealtime: () => state }))
vi.mock('../data/slots', () => ({
  claimSlot: (...args: unknown[]) => claimSlot(...args),
  releaseSlot: (...args: unknown[]) => releaseSlot(...args),
  moveSlot: (...args: unknown[]) => moveSlot(...args),
  SlotActionError: class extends Error {
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
    state.session = SESSION
    state.slots = emptySlots()
    state.mySlotIds = new Set<string>()
    state.loading = false
    state.error = null
    state.notFound = false
    claimSlot.mockReset()
    releaseSlot.mockReset()
    moveSlot.mockReset()
    writeText.mockReset()
    state.applyLocal.mockReset()
    state.setOwned.mockReset()
    state.refetch.mockReset()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })

  it('shows the session header and all three teams', () => {
    view()
    expect(screen.getByText('Sesi 005 Geng Turun Peluh')).toBeTruthy()
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
    await userEvent.click(screen.getByRole('button', { name: 'Ambil slot' }))

    await waitFor(() => expect(claimSlot).toHaveBeenCalledWith('A-GK', 'Hazmi'))
    await waitFor(() => expect(state.setOwned).toHaveBeenCalledWith('A-GK', true))
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

  it('offers release and move on your own slot', async () => {
    state.slots = withClaim(state.slots, 'A-ST')
    state.mySlotIds = new Set(['A-ST'])
    releaseSlot.mockResolvedValue({ ...findSlot(state.slots, 'A-ST'), playerName: null, claimedAt: null })
    view()

    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^ST/ })))
    expect(screen.getByRole('button', { name: 'Lepaskan slot' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tukar posisi' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Lepaskan slot' }))
    await waitFor(() => expect(releaseSlot).toHaveBeenCalledWith('A-ST'))
    await waitFor(() => expect(state.setOwned).toHaveBeenCalledWith('A-ST', false))
  })

  it('moves your slot to an empty position', async () => {
    state.slots = withClaim(state.slots, 'A-ST')
    state.mySlotIds = new Set(['A-ST'])
    moveSlot.mockResolvedValue({ ...findSlot(state.slots, 'A-GK'), playerName: 'Hazmi', claimedAt: 'now' })
    view()

    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^ST/ })))
    await userEvent.click(screen.getByRole('button', { name: 'Tukar posisi' }))
    expect(screen.getByRole('button', { name: 'Batal' })).toBeTruthy()

    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^GK/ })))

    await waitFor(() => expect(moveSlot).toHaveBeenCalledWith('A-ST', 'A-GK'))
    await waitFor(() => expect(state.setOwned).toHaveBeenCalledWith('A-ST', false))
    expect(state.setOwned).toHaveBeenCalledWith('A-GK', true)
  })

  it('cancels a move without touching any slot', async () => {
    state.slots = withClaim(state.slots, 'A-ST')
    state.mySlotIds = new Set(['A-ST'])
    view()

    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^ST/ })))
    await userEvent.click(screen.getByRole('button', { name: 'Tukar posisi' }))
    await userEvent.click(screen.getByRole('button', { name: 'Batal' }))

    expect(screen.queryByRole('button', { name: 'Batal' })).toBeNull()

    // an empty slot now opens the ordinary claim sheet, not a move.
    await userEvent.click(firstOf(screen.getAllByRole('button', { name: /^GK/ })))
    expect(screen.getByLabelText('Nama')).toBeTruthy()
    expect(moveSlot).not.toHaveBeenCalled()
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
})
