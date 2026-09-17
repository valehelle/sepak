import { useEffect, useState } from 'react'
import { ContactError, getContactPhone, type ContactRef } from '../data/contacts'
import { formatPhone, telLink, whatsappLink } from '../lib/phone'
import { buttonClass } from './Button'

type Lookup = { state: 'loading' } | { state: 'done'; phone: string | null } | { state: 'failed'; message: string }

type AdminContactProps = { target: ContactRef }

/** The one place a phone number is shown. Rendered only for admins (the
 *  server refuses everyone else anyway), fetched on mount so the number is
 *  never part of the page's public data. */
export function AdminContact({ target }: AdminContactProps) {
  const [lookup, setLookup] = useState<Lookup>({ state: 'loading' })
  const key = 'slotId' in target ? `slot:${target.slotId}` : `waitlist:${target.waitlistId}`

  useEffect(() => {
    let cancelled = false
    setLookup({ state: 'loading' })
    getContactPhone(target)
      .then((phone) => { if (!cancelled) setLookup({ state: 'done', phone }) })
      .catch((cause: unknown) => {
        if (cancelled) return
        setLookup({
          state: 'failed',
          message: cause instanceof ContactError ? cause.message : 'Gagal mendapatkan nombor.',
        })
      })
    return () => { cancelled = true }
    // `key` stands in for `target`, which callers build inline as a fresh
    // object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (lookup.state === 'loading') {
    return <p className="font-sans text-[13px] text-white/45">Memuatkan nombor…</p>
  }
  if (lookup.state === 'failed') {
    return <p className="font-sans text-[13px] text-merah-soft">{lookup.message}</p>
  }
  if (lookup.phone === null) {
    return <p className="font-sans text-[13px] text-white/45">Tiada nombor telefon.</p>
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-auto font-kit text-[17px] font-semibold tracking-wide text-white">
        {formatPhone(lookup.phone)}
      </span>
      <a href={whatsappLink(lookup.phone)} target="_blank" rel="noopener noreferrer" className={buttonClass('primary', 'sm')}>
        WhatsApp
      </a>
      <a href={telLink(lookup.phone)} className={buttonClass('secondary', 'sm')}>
        Panggil
      </a>
    </div>
  )
}

/** For lists: nothing is fetched until the organiser asks, so opening a
 *  page with a long queue does not fire a request per entry. */
export function AdminContactToggle({ target }: AdminContactProps) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-kit text-[13px] font-medium text-kuning underline decoration-kuning/40 underline-offset-4"
      >
        Lihat nombor
      </button>
    )
  }
  return <AdminContact target={target} />
}
