import { useEffect, useRef, useState } from 'react'
import type { ServerClock } from './useServerClock'

/** How far past the opening a phone's own clock has to be before the page
 *  trusts it without waiting for the server's time. Covers the common case
 *  -- a session that opened hours ago -- without a flash of countdown, and
 *  no phone clock is this far off without the server catching it anyway. */
const CLEARLY_PAST_MS = 10 * 60 * 1000

/** How often the gate looks at the clock while locked. It sets no state
 *  until the moment passes, so this costs nothing in renders. */
const CHECK_EVERY_MS = 250

/** Whether this session is open for booking, as far as this page can tell.
 *
 *  Opening is decided on the server; this only decides when to unlock the
 *  page. At zero it re-reads the opening time first (`recheck`), because a
 *  live update saying the time moved can be lost while a phone sleeps. If
 *  the time did move, the new one arrives through the session prop and the
 *  countdown simply carries on. If the read fails, the page unlocks and the
 *  server's own check takes over.
 *
 *  Once open it stays open: the database refuses to move an opening time
 *  that has passed (0018_opens_at.sql). */
export function useOpening(
  opensAt: string | null,
  clock: ServerClock,
  recheck: () => Promise<{ opensAt: string } | null>,
  now: () => number = Date.now,
): boolean {
  const target = opensAt === null ? null : Date.parse(opensAt)
  // Decided on the first render for a session that opened long ago, so an
  // ordinary open page never flashes a countdown.
  const [open, setOpen] = useState(
    () => target !== null && !Number.isNaN(target) && now() >= target + CLEARLY_PAST_MS,
  )
  const checking = useRef(false)
  // Set the moment the gate decides, ahead of the re-render that setOpen
  // schedules, so the interval cannot ask the server a second time in the
  // gap. With two hundred phones at the same second, one read each is the
  // budget.
  const decided = useRef(false)
  // The latest recheck, without restarting the interval every render.
  const recheckRef = useRef(recheck)
  useEffect(() => {
    recheckRef.current = recheck
  }, [recheck])

  useEffect(() => {
    if (open || target === null || Number.isNaN(target)) return

    const unlock = () => {
      decided.current = true
      setOpen(true)
    }

    const tick = () => {
      if (checking.current || decided.current) return
      const local = now()
      const passed = clock.synced ? local + clock.offsetMs >= target : local >= target + CLEARLY_PAST_MS
      if (!passed) return

      // A session that opened long ago needs no confirmation.
      if (local + clock.offsetMs >= target + CLEARLY_PAST_MS) {
        unlock()
        return
      }

      checking.current = true
      recheckRef
        .current()
        .then((fresh) => {
          const latest = fresh === null ? target : Date.parse(fresh.opensAt)
          // Moved later: the new time comes in through `opensAt` and this
          // effect restarts against it. Otherwise it really is time.
          if (Number.isNaN(latest) || now() + clock.offsetMs >= latest) unlock()
        })
        .catch(unlock)
        .finally(() => {
          checking.current = false
        })
    }

    tick()
    const timer = setInterval(tick, CHECK_EVERY_MS)
    return () => clearInterval(timer)
  }, [open, target, clock.synced, clock.offsetMs, now])

  return open
}
