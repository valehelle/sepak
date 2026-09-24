import { useEffect, useState } from 'react'
import { measureClockOffset } from './clock'

export type ServerClock = {
  /** Server time minus this phone's time, in milliseconds. */
  offsetMs: number
  /** False until the first measurement lands. */
  synced: boolean
}

/** The server's clock, as seen from here. Measured on mount and again every
 *  time the page comes back into view: phones pause timers in the
 *  background and on the lock screen, and a phone's clock can be adjusted
 *  while the page sleeps. */
export function useServerClock(measure: () => Promise<number> = measureClockOffset): ServerClock {
  const [clock, setClock] = useState<ServerClock>({ offsetMs: 0, synced: false })

  useEffect(() => {
    let cancelled = false
    const sync = () => {
      measure()
        .then((offsetMs) => {
          if (!cancelled) setClock({ offsetMs, synced: true })
        })
        .catch(() => {
          // Keep the last good offset. With none, the gate below still waits
          // for the server's own answer at zero, and the server still refuses
          // an early booking whatever this page shows.
        })
    }
    sync()
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [measure])

  return clock
}
