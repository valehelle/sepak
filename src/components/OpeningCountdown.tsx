import { useEffect, useState } from 'react'
import type { ServerClock } from '../data/useServerClock'
import { formatCountdown, formatOpensAt } from '../lib/opening'

type OpeningCountdownProps = {
  opensAt: string
  clock: ServerClock
  isAdmin: boolean
  /** Set when the admin moved the opening time while this page was open. */
  movedTo: string | null
}

/** The big clock shown while a session is not open yet. It ticks on its own
 *  so the rest of the page does not re-render every second; whether the
 *  slots unlock is decided by useOpening, not by this display. */
export function OpeningCountdown({ opensAt, clock, isAdmin, movedTo }: OpeningCountdownProps) {
  const target = Date.parse(opensAt)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [])

  const remaining = target - (now + clock.offsetMs)
  const when = formatOpensAt(opensAt)

  return (
    <section
      aria-label={`Dibuka ${when}`}
      className="rounded-lg border border-kuning/40 bg-kuning/10 px-4 py-4 text-center"
    >
      <p className="font-kit text-[15px] font-medium text-white/70">Dibuka dalam</p>
      {/* Read once by a screen reader, not every second: the label above
          already says when. */}
      <p
        aria-hidden="true"
        className="font-kit text-[56px] font-bold leading-none tracking-tight text-white tabular-nums"
      >
        {formatCountdown(remaining)}
      </p>
      <p className="mt-2 font-kit text-[17px] font-semibold text-kuning">{when}</p>
      {movedTo !== null && (
        <p className="mt-2 font-sans text-[13px] text-white/70">{`Masa dibuka ditukar ke ${formatOpensAt(movedTo)}.`}</p>
      )}
      <p className="mt-2 font-sans text-[13px] text-white/60">
        {isAdmin
          ? 'Anda admin — boleh daftar awal. Pemain lain tunggu kiraan tamat.'
          : 'Slot dibuka untuk semua serentak. Tak perlu refresh — halaman ini buka sendiri.'}
      </p>
    </section>
  )
}
