import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOpening } from './useOpening'
import type { ServerClock } from './useServerClock'

const START = new Date(2026, 8, 25, 20, 59, 50).getTime()
const NINE = new Date(2026, 8, 25, 21, 0, 0).toISOString()
const TEN = new Date(2026, 8, 25, 22, 0, 0).toISOString()
const synced: ServerClock = { offsetMs: 0, synced: true }

describe('useOpening', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
  })
  afterEach(() => vi.useRealTimers())

  it('opens at the time, after asking the server whether it moved', async () => {
    const recheck = vi.fn(() => Promise.resolve({ opensAt: NINE }))
    const { result } = renderHook(() => useOpening(NINE, synced, recheck))
    expect(result.current).toBe(false)

    await act(async () => { await vi.advanceTimersByTimeAsync(9_000) })
    expect(result.current).toBe(false)
    expect(recheck).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(1_500) })
    expect(recheck).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(true)
  })

  it('stays locked when the check at zero finds the time was moved later', async () => {
    // The live update saying 10:00 never arrived; the check at zero is the
    // first this page hears of it.
    const recheck = vi.fn(() => Promise.resolve({ opensAt: TEN }))
    const { result, rerender } = renderHook(({ opensAt }) => useOpening(opensAt, synced, recheck), {
      initialProps: { opensAt: NINE },
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(11_000) })
    expect(result.current).toBe(false)

    // The reload hands the page the new time, and the countdown carries on.
    rerender({ opensAt: TEN })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(result.current).toBe(false)
  })

  it('opens early when the admin brings the time forward', async () => {
    const recheck = vi.fn(() => Promise.resolve({ opensAt: TEN }))
    const { result, rerender } = renderHook(({ opensAt }) => useOpening(opensAt, synced, recheck), {
      initialProps: { opensAt: TEN },
    })
    const now = new Date(START + 1000).toISOString()
    recheck.mockResolvedValue({ opensAt: now })
    rerender({ opensAt: now })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500) })
    expect(result.current).toBe(true)
  })

  it('unlocks when the check at zero fails, leaving the server to refuse', async () => {
    const recheck = vi.fn(() => Promise.reject(new Error('offline')))
    const { result } = renderHook(() => useOpening(NINE, synced, recheck))
    await act(async () => { await vi.advanceTimersByTimeAsync(10_500) })
    expect(result.current).toBe(true)
  })

  it('follows the server clock, not the phone', async () => {
    // This phone is five seconds slow: the server reaches 9:00 while the
    // phone still reads 8:59:55.
    const slow: ServerClock = { offsetMs: 5_000, synced: true }
    const recheck = vi.fn(() => Promise.resolve({ opensAt: NINE }))
    const { result } = renderHook(() => useOpening(NINE, slow, recheck))
    await act(async () => { await vi.advanceTimersByTimeAsync(5_500) })
    expect(result.current).toBe(true)
  })

  it('does not trust an unsynced phone clock near the moment', async () => {
    const unsynced: ServerClock = { offsetMs: 0, synced: false }
    const recheck = vi.fn(() => Promise.resolve({ opensAt: NINE }))
    const { result } = renderHook(() => useOpening(NINE, unsynced, recheck))
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(result.current).toBe(false)
  })

  it('is open from the first render for a session that opened long ago', () => {
    const recheck = vi.fn(() => Promise.resolve(null))
    const past = new Date(START - 60 * 60 * 1000).toISOString()
    const { result } = renderHook(() => useOpening(past, { offsetMs: 0, synced: false }, recheck))
    expect(result.current).toBe(true)
    expect(recheck).not.toHaveBeenCalled()
  })
})
