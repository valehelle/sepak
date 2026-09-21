import { useEffect, useState } from 'react'
import { PushError, subscribeToPush } from '../data/push'
import { isIosNonSafari, pushCapability, type PushCapability } from '../lib/pushCapability'
import { Button } from './Button'
import { Sheet } from './Sheet'

type PushPromptProps = {
  open: boolean
  onClose: () => void
  /** Called once a subscription is stored, so the page can stop offering it. */
  onSubscribed: () => void
}

type State = 'asking' | 'working' | 'done' | 'failed'

/** The Share affordance, drawn rather than screenshotted: a screenshot of
 *  Safari goes out of date with every iOS release and differs between iPhone
 *  and iPad, while the glyph itself has not changed in years. Shown inline,
 *  at text size, because the whole difficulty of step one is recognising it
 *  in a toolbar. */
function ShareGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="inline-block h-[1.15em] w-[1.15em] -translate-y-[0.1em] align-middle"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v11" />
      <path d="M8.5 6.5 12 3l3.5 3.5" />
      <path d="M6 11H4.5v9.5h15V11H18" />
    </svg>
  )
}

/** The iOS route, written as the taps they actually have to make. Vague
 *  instructions here are why people give up: "install the app" means nothing
 *  on a phone with no install button. */
function InstallSteps() {
  // A link opened from WhatsApp can land in Chrome or an in-app browser, and
  // adding to the home screen from there does not grant notifications.
  const wrongBrowser = isIosNonSafari()

  return (
    <>
      <p className="mb-3 font-sans text-[15px] leading-relaxed text-white/70">
        iPhone hanya izinkan notifikasi kalau app ni ada di Home Screen. Sekali je buat:
      </p>
      {wrongBrowser && (
        <p className="mb-3 rounded-lg border border-kuning/40 bg-kuning/10 px-3 py-2 font-sans text-[13px] leading-relaxed text-white/85">
          Buka pautan ni dalam <span className="font-semibold">Safari</span> dulu — cuma Safari
          boleh pasang app ni untuk notifikasi.
        </p>
      )}
      <ol className="mb-4 space-y-2 font-sans text-[14px] leading-relaxed text-white/80">
        <li>
          1. Tekan ikon <ShareGlyph /> <span className="font-semibold">Share</span> dalam bar
          Safari (bawah pada iPhone, atas pada iPad).
        </li>
        <li>2. Skrol dan pilih <span className="font-semibold">Add to Home Screen</span>.</li>
        <li>3. Tekan <span className="font-semibold">Add</span>.</li>
        <li>4. Buka <span className="font-semibold">GTP</span> dari ikon baru tu.</li>
        <li>5. Tekan <span className="font-semibold">Beritahu saya bila naik</span> sekali lagi.</li>
      </ol>
    </>
  )
}

/** Offered at the moment it makes sense -- straight after joining the queue,
 *  when the player has just told us they want a place and cannot have one
 *  yet. Asking any earlier is asking before there is anything to promise. */
export function PushPrompt({ open, onClose, onSubscribed }: PushPromptProps) {
  const [capability, setCapability] = useState<PushCapability>('unsupported')
  const [state, setState] = useState<State>('asking')
  const [problem, setProblem] = useState<string | null>(null)

  // Read on open rather than on mount: on iOS the answer changes the moment
  // they come back from adding it to the home screen, and this sheet is
  // exactly what they reopen afterwards.
  useEffect(() => {
    if (!open) return
    setCapability(pushCapability())
    setState('asking')
    setProblem(null)
  }, [open])

  if (!open) return null

  async function accept() {
    setState('working')
    setProblem(null)
    try {
      await subscribeToPush()
      setState('done')
      onSubscribed()
    } catch (cause: unknown) {
      setState('failed')
      setProblem(cause instanceof PushError ? cause.message : 'Gagal hidupkan notifikasi.')
    }
  }

  return (
    <Sheet open title="Beritahu saya bila naik" onClose={onClose}>
      {state === 'done' ? (
        <>
          <p className="mb-4 font-sans text-[15px] leading-relaxed text-white/70">
            Siap. Kami akan hantar notifikasi ke telefon ni sebaik sahaja ada tempat untuk anda.
          </p>
          <Button variant="primary" onClick={onClose} className="w-full">
            Tutup
          </Button>
        </>
      ) : capability === 'needs-install' ? (
        <>
          <InstallSteps />
          <Button variant="secondary" onClick={onClose} className="w-full">
            OK, faham
          </Button>
        </>
      ) : capability === 'blocked' ? (
        <>
          <p className="mb-4 font-sans text-[15px] leading-relaxed text-white/70">
            Notifikasi disekat untuk laman ni dalam setting browser anda. Izinkan dalam setting,
            lepas tu buka semula halaman ni.
          </p>
          <Button variant="secondary" onClick={onClose} className="w-full">
            Tutup
          </Button>
        </>
      ) : capability === 'unsupported' ? (
        <>
          <p className="mb-4 font-sans text-[15px] leading-relaxed text-white/70">
            Browser ni tak boleh hantar notifikasi. Kami akan maklumkan dalam kumpulan WhatsApp
            kalau anda naik.
          </p>
          <Button variant="secondary" onClick={onClose} className="w-full">
            Tutup
          </Button>
        </>
      ) : (
        <>
          <p className="mb-4 font-sans text-[15px] leading-relaxed text-white/70">
            Slot boleh terbuka bila-bila masa. Kami boleh beritahu telefon ni sebaik sahaja anda
            dapat tempat — tak perlu buka halaman ni tunggu.
          </p>
          {problem !== null && <p className="mb-3 font-sans text-xs text-merah-soft">{problem}</p>}
          <div className="space-y-2">
            <Button variant="primary" disabled={state === 'working'} onClick={() => void accept()} className="w-full">
              {state === 'working' ? 'Sekejap…' : 'Ya, beritahu saya'}
            </Button>
            <Button variant="secondary" disabled={state === 'working'} onClick={onClose} className="w-full">
              Tak perlu
            </Button>
          </div>
        </>
      )}
    </Sheet>
  )
}
