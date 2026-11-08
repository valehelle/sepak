import { useEffect, useState } from 'react'
import { deviceCode } from '../lib/deviceCode'

/** This browser's device code, at the foot of the page. A booking belongs
 *  to the browser it was made in, so a player who cannot edit theirs reads
 *  this out to the organiser, who compares it with the code on the booking
 *  line in Aktiviti. */
export function DeviceCode() {
  const [code, setCode] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void deviceCode().then((value) => {
      if (!cancelled) setCode(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (code === null) return null
  return <p className="text-center font-kit text-[11px] text-white/30">ID peranti: {code}</p>
}
