import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session, Slot } from './types'
import type { WaitlistEntry } from './waitlist'

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

const GK: Slot = {
  id: 'slot-gk',
  sessionId: 'session-1',
  team: 'A',
  position: 'GK',
  playerName: null,
  claimedAt: null,
}

const getSessionWithSlots = vi.fn()
const getMySlotIds = vi.fn()
const listWaitlist = vi.fn()
const getMyWaitlistEntry = vi.fn()
type SlotPayload = { new: Record<string, unknown> }
type WaitlistPayload = { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }
let emitSlot: ((payload: SlotPayload) => void) | null = null
let emitWaitlist: ((payload: WaitlistPayload) => void) | null = null
let subscribeCallback: ((status: string) => void) | null = null
const unsubscribe = vi.fn()

vi.mock('./sessions', () => ({ getSessionWithSlots: (id: string) => getSessionWithSlots(id) }))
vi.mock('./slots', () => ({ getMySlotIds: (id: string) => getMySlotIds(id) }))
vi.mock('./waitlist', async () => {
  const actual = await vi.importActual<typeof import('./waitlist')>('./waitlist')
  return {
    ...actual,
    listWaitlist: (id: string) => listWaitlist(id),
    getMyWaitlistEntry: (id: string) => getMyWaitlistEntry(id),
  }
})

// The real channel builder supports `.on(...).on(...).subscribe(...)` --
// each `.on` call is captured by the table it filters, so both the slots
// and waitlist handlers can be driven independently within one test.
vi.mock('../lib/supabase', () => ({
  supabase: {
    channel: () => {
      const builder = {
        on: (
          _event: string,
          filter: { table: string },
          handler: (payload: SlotPayload | WaitlistPayload) => void,
        ) => {
          if (filter.table === 'slots') emitSlot = handler as (payload: SlotPayload) => void
          if (filter.table === 'waitlist') emitWaitlist = handler as (payload: WaitlistPayload) => void
          return builder
        },
        subscribe: (cb?: (status: string) => void) => {
          subscribeCallback = cb ?? null
          return { unsubscribe }
        },
      }
      return builder
    },
    removeChannel: unsubscribe,
  },
}))

const { useSessionRealtime } = await import('./useSessionRealtime')

function Probe({ id }: { id: string | undefined }) {
  const state = useSessionRealtime(id)
  if (state.loading) return <p>loading</p>
  if (state.notFound) return <p>not-found</p>
  if (state.error !== null) return <p>error: {state.error}</p>
  return (
    <>
      <ul>
        {state.slots.map((slot) => (
          <li key={slot.id}>
            {`${slot.position}:${slot.playerName ?? 'empty'}`}
            {state.mySlotIds.has(slot.id) ? ':mine' : ':theirs'}
          </li>
        ))}
      </ul>
      <ol>
        {state.waitlist.map((entry) => (
          <li key={entry.id}>{`wait:${entry.id}:${entry.playerName}`}</li>
        ))}
      </ol>
      <p>{`my-wait:${state.myWaitlistEntry === null ? 'none' : state.myWaitlistEntry.id}`}</p>
    </>
  )
}

/** Drives `setOwned` through real button clicks and reads ownership back out
 *  of rendered DOM, not off the hook's return value directly — a `mySlotIds`
 *  update that mutated the Set in place (same reference, no re-render) must
 *  fail this test loudly rather than pass by reading the very object that
 *  was just mutated. `onRender` additionally reports the current `mySlotIds`
 *  reference on every render, so the test can also assert directly that a
 *  new Set was produced. */
function OwnProbe({ id, onRender }: { id: string | undefined; onRender: (ids: ReadonlySet<string>) => void }) {
  const state = useSessionRealtime(id)
  onRender(state.mySlotIds)
  if (state.loading) return <p>loading</p>
  return (
    <>
      <button onClick={() => state.setOwned('slot-gk', true)}>own</button>
      <button onClick={() => state.setOwned('slot-gk', false)}>disown</button>
      <p>{`mine:${state.mySlotIds.has('slot-gk') ? 'yes' : 'no'}`}</p>
    </>
  )
}

describe('useSessionRealtime', () => {
  beforeEach(() => {
    getSessionWithSlots.mockReset()
    getMySlotIds.mockReset()
    getMySlotIds.mockResolvedValue(new Set<string>())
    listWaitlist.mockReset()
    listWaitlist.mockResolvedValue([])
    getMyWaitlistEntry.mockReset()
    getMyWaitlistEntry.mockResolvedValue(null)
    unsubscribe.mockReset()
    emitSlot = null
    emitWaitlist = null
    subscribeCallback = null
  })

  it('loads the session and its slots', async () => {
    getSessionWithSlots.mockResolvedValue({ session: SESSION, slots: [GK] })
    render(<Probe id="session-1" />)
    expect(screen.getByText('loading')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('GK:empty:theirs')).toBeTruthy())
  })

  it('reports a missing session', async () => {
    getSessionWithSlots.mockResolvedValue(null)
    render(<Probe id="ghost" />)
    await waitFor(() => expect(screen.getByText('not-found')).toBeTruthy())
  })

  it('surfaces a fetch failure', async () => {
    getSessionWithSlots.mockRejectedValue(new Error('offline'))
    render(<Probe id="session-1" />)
    await waitFor(() => expect(screen.getByText(/error:/)).toBeTruthy())
  })

  it('applies a realtime slot update without refetching', async () => {
    getSessionWithSlots.mockResolvedValue({ session: SESSION, slots: [GK] })
    render(<Probe id="session-1" />)
    await waitFor(() => expect(screen.getByText('GK:empty:theirs')).toBeTruthy())

    act(() => {
      emitSlot?.({
        new: {
          id: 'slot-gk',
          session_id: 'session-1',
          team: 'A',
          position: 'GK',
          player_name: 'Isaac',
          claimed_at: '2026-09-10T06:00:00Z',
        },
      })
    })

    await waitFor(() => expect(screen.getByText('GK:Isaac:theirs')).toBeTruthy())
    expect(getSessionWithSlots).toHaveBeenCalledTimes(1)
  })

  it('ignores a malformed realtime payload rather than crashing', async () => {
    getSessionWithSlots.mockResolvedValue({ session: SESSION, slots: [GK] })
    render(<Probe id="session-1" />)
    await waitFor(() => expect(screen.getByText('GK:empty:theirs')).toBeTruthy())

    act(() => {
      emitSlot?.({ new: { id: 'slot-gk', team: 'NOPE' } })
    })

    expect(screen.getByText('GK:empty:theirs')).toBeTruthy()
  })

  it('tears down the channel on unmount', async () => {
    getSessionWithSlots.mockResolvedValue({ session: SESSION, slots: [GK] })
    const view = render(<Probe id="session-1" />)
    await waitFor(() => expect(screen.getByText('GK:empty:theirs')).toBeTruthy())
    view.unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('does nothing without a session id', () => {
    render(<Probe id={undefined} />)
    expect(getSessionWithSlots).not.toHaveBeenCalled()
    expect(getMySlotIds).not.toHaveBeenCalled()
    expect(listWaitlist).not.toHaveBeenCalled()
    expect(getMyWaitlistEntry).not.toHaveBeenCalled()
  })

  it('populates mySlotIds from the initial fetch', async () => {
    getSessionWithSlots.mockResolvedValue({ session: SESSION, slots: [GK] })
    getMySlotIds.mockResolvedValue(new Set(['slot-gk']))
    render(<Probe id="session-1" />)
    await waitFor(() => expect(screen.getByText('GK:empty:mine')).toBeTruthy())
    expect(getMySlotIds).toHaveBeenCalledWith('session-1')
  })

  it('setOwned adds and removes ownership locally, re-rendering, without refetching', async () => {
    getSessionWithSlots.mockResolvedValue({ session: SESSION, slots: [GK] })
    getMySlotIds.mockResolvedValue(new Set<string>())
    const user = userEvent.setup()

    // Property assignment on a ref-object, not a reassigned `let`: TS's
    // control-flow narrowing does not track mutation through a nested
    // component's closure, so a plain `let` written only inside `OwnProbe`
    // would narrow to its initial value at every read site below.
    const seen: { current: ReadonlySet<string> | null } = { current: null }

    render(<OwnProbe id="session-1" onRender={(ids) => (seen.current = ids)} />)
    await waitFor(() => expect(screen.getByText('mine:no')).toBeTruthy())
    const initial = seen.current

    await user.click(screen.getByRole('button', { name: 'own' }))
    // Fails loudly (times out) if setOwned mutated the Set in place: with no
    // new reference, React bails out of the re-render and this text never
    // changes.
    await waitFor(() => expect(screen.getByText('mine:yes')).toBeTruthy())
    expect(seen.current).not.toBe(initial)
    expect(getSessionWithSlots).toHaveBeenCalledTimes(1)
    expect(getMySlotIds).toHaveBeenCalledTimes(1)

    const afterOwn = seen.current
    await user.click(screen.getByRole('button', { name: 'disown' }))
    await waitFor(() => expect(screen.getByText('mine:no')).toBeTruthy())
    expect(seen.current).not.toBe(afterOwn)
    expect(getSessionWithSlots).toHaveBeenCalledTimes(1)
    expect(getMySlotIds).toHaveBeenCalledTimes(1)
  })

  it('renders the session with empty ownership when getMySlotIds rejects', async () => {
    getSessionWithSlots.mockResolvedValue({ session: SESSION, slots: [GK] })
    getMySlotIds.mockRejectedValue(new Error('rpc failed'))

    render(<Probe id="session-1" />)
    await waitFor(() => expect(screen.getByText('GK:empty:theirs')).toBeTruthy())
  })

  it('refetches when the channel reports it has reconnected', async () => {
    getSessionWithSlots.mockResolvedValue({ session: SESSION, slots: [GK] })
    render(<Probe id="session-1" />)
    await waitFor(() => expect(getSessionWithSlots).toHaveBeenCalledTimes(1))

    act(() => {
      subscribeCallback?.('SUBSCRIBED')
    })
    act(() => {
      subscribeCallback?.('CHANNEL_ERROR')
    })
    act(() => {
      subscribeCallback?.('SUBSCRIBED')
    })

    // The first SUBSCRIBED is the initial connect and must not refetch; only the
    // one after an error does, because state may have moved on while offline.
    await waitFor(() => expect(getSessionWithSlots).toHaveBeenCalledTimes(2))
  })

  it('loads the waitlist and this device\'s own entry alongside the session', async () => {
    getSessionWithSlots.mockResolvedValue({ session: SESSION, slots: [GK] })
    const entry: WaitlistEntry = {
      id: 'wait-1',
      sessionId: 'session-1',
      playerName: 'Faiz',
      positions: ['GK'],
      createdAt: '2026-09-10T00:00:00Z',
    }
    listWaitlist.mockResolvedValue([entry])
    getMyWaitlistEntry.mockResolvedValue({ id: 'wait-1', positions: ['GK'], createdAt: entry.createdAt })

    render(<Probe id="session-1" />)
    await waitFor(() => expect(screen.getByText('wait:wait-1:Faiz')).toBeTruthy())
    expect(screen.getByText('my-wait:wait-1')).toBeTruthy()
    expect(listWaitlist).toHaveBeenCalledWith('session-1')
    expect(getMyWaitlistEntry).toHaveBeenCalledWith('session-1')
  })

  it('renders an empty waitlist when listWaitlist rejects', async () => {
    getSessionWithSlots.mockResolvedValue({ session: SESSION, slots: [GK] })
    listWaitlist.mockRejectedValue(new Error('rpc failed'))

    render(<Probe id="session-1" />)
    await waitFor(() => expect(screen.getByText('GK:empty:theirs')).toBeTruthy())
    expect(screen.getByText('my-wait:none')).toBeTruthy()
  })

  it('applies a realtime waitlist insert without refetching', async () => {
    getSessionWithSlots.mockResolvedValue({ session: SESSION, slots: [GK] })
    render(<Probe id="session-1" />)
    await waitFor(() => expect(screen.getByText('GK:empty:theirs')).toBeTruthy())

    act(() => {
      emitWaitlist?.({
        eventType: 'INSERT',
        old: {},
        new: {
          id: 'wait-1',
          session_id: 'session-1',
          player_name: 'Faiz',
          positions: ['GK'],
          created_at: '2026-09-10T00:00:00Z',
        },
      })
    })

    await waitFor(() => expect(screen.getByText('wait:wait-1:Faiz')).toBeTruthy())
    expect(listWaitlist).toHaveBeenCalledTimes(1)
  })

  it('removes a queue entry on a realtime waitlist delete, and clears its own-entry marker', async () => {
    getSessionWithSlots.mockResolvedValue({ session: SESSION, slots: [GK] })
    const entry: WaitlistEntry = {
      id: 'wait-1',
      sessionId: 'session-1',
      playerName: 'Faiz',
      positions: ['GK'],
      createdAt: '2026-09-10T00:00:00Z',
    }
    listWaitlist.mockResolvedValue([entry])
    getMyWaitlistEntry.mockResolvedValue({ id: 'wait-1', positions: ['GK'], createdAt: entry.createdAt })

    render(<Probe id="session-1" />)
    await waitFor(() => expect(screen.getByText('my-wait:wait-1')).toBeTruthy())

    // This is the shape of what auto-fill does: it deletes the placed
    // entry's row in the same transaction as the slot update, so the page
    // must see the queue shrink over the same realtime channel that
    // delivers the slot filling — without a reload.
    act(() => {
      emitWaitlist?.({ eventType: 'DELETE', old: { id: 'wait-1' }, new: {} })
    })

    await waitFor(() => expect(screen.queryByText('wait:wait-1:Faiz')).toBeNull())
    expect(screen.getByText('my-wait:none')).toBeTruthy()
  })

  it('re-asks my_slot_ids when its own waitlist entry is auto-filled away, so the placed slot is recognised as its own', async () => {
    getSessionWithSlots.mockResolvedValue({ session: SESSION, slots: [GK] })
    const entry: WaitlistEntry = {
      id: 'wait-1',
      sessionId: 'session-1',
      playerName: 'Faiz',
      positions: ['GK'],
      createdAt: '2026-09-10T00:00:00Z',
    }
    listWaitlist.mockResolvedValue([entry])
    getMyWaitlistEntry.mockResolvedValue({ id: 'wait-1', positions: ['GK'], createdAt: entry.createdAt })

    render(<Probe id="session-1" />)
    await waitFor(() => expect(screen.getByText('my-wait:wait-1')).toBeTruthy())

    // Auto-fill's own write to the slot arrives on the slots channel...
    getMySlotIds.mockResolvedValue(new Set(['slot-gk']))
    act(() => {
      emitSlot?.({
        new: {
          id: 'slot-gk',
          session_id: 'session-1',
          team: 'A',
          position: 'GK',
          player_name: 'Faiz',
          claimed_at: '2026-09-10T06:00:00Z',
        },
      })
    })
    // ...and its deletion of the placed waitlist row arrives on the other.
    act(() => {
      emitWaitlist?.({ eventType: 'DELETE', old: { id: 'wait-1' }, new: {} })
    })

    await waitFor(() => expect(screen.getByText('GK:Faiz:mine')).toBeTruthy())
    expect(screen.getByText('my-wait:none')).toBeTruthy()
  })

  it('ignores a malformed realtime waitlist payload rather than crashing', async () => {
    getSessionWithSlots.mockResolvedValue({ session: SESSION, slots: [GK] })
    render(<Probe id="session-1" />)
    await waitFor(() => expect(screen.getByText('GK:empty:theirs')).toBeTruthy())

    act(() => {
      emitWaitlist?.({ eventType: 'INSERT', old: {}, new: { id: 'wait-1', positions: ['NOPE'] } })
    })

    expect(screen.getByText('my-wait:none')).toBeTruthy()
  })
})
