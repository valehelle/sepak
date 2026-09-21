import { useEffect, useState } from 'react'
import { PushError, subscribeToPush } from '../data/push'
import { TELEGRAM_BOT, TelegramError, createTelegramLink, hasTelegramChat } from '../data/telegram'
import { pushCapability, type PushCapability } from '../lib/pushCapability'
import { Button } from './Button'
import { Sheet } from './Sheet'

type NotifySheetProps = {
  open: boolean
  onClose: () => void
  /** Called once either channel is live, so the page can stop offering it. */
  onSubscribed: () => void
}

/** Where in the flow we are. A problem is deliberately NOT a stage: an
 *  unsuccessful check has to leave the retry button in place, and treating
 *  failure as a screen of its own took it away. */
type Stage = 'choosing' | 'telegram-opened' | 'done-telegram' | 'done-browser'

/** Offered straight after a join that queues, which is the one moment the
 *  question is obviously useful.
 *
 *  Telegram leads, and not because it is fancier: browser notifications are
 *  free and instant on Android but on iOS reach only a web app added to the
 *  Home Screen -- and an installed iOS web app gets its own storage
 *  container, so it cannot even tell that this device is the one in the
 *  queue. Telegram has none of that and is identical on both. */
export function NotifySheet({ open, onClose, onSubscribed }: NotifySheetProps) {
  const [capability, setCapability] = useState<PushCapability>('unsupported')
  const [stage, setStage] = useState<Stage>('choosing')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // Read on open, not on mount: an iPhone user who installs the app comes
  // back to this very sheet, and the answer has changed by then.
  useEffect(() => {
    if (!open) return
    setCapability(pushCapability())
    setStage('choosing')
    setBusy(false)
    setProblem(null)
  }, [open])

  if (!open) return null

  async function useTelegram() {
    setBusy(true)
    setProblem(null)
    try {
      const link = await createTelegramLink()
      // A new tab rather than a redirect: the session page stays open behind
      // it, which is where they come back to confirm.
      window.open(link, '_blank', 'noopener,noreferrer')
      setStage('telegram-opened')
    } catch (cause: unknown) {
      setProblem(cause instanceof TelegramError ? cause.message : 'Gagal membuka Telegram.')
    } finally {
      setBusy(false)
    }
  }

  /** Telegram cannot tell us they pressed Start, so this asks the database.
   *  A button they press themselves beats polling in the background. */
  async function checkTelegram() {
    setBusy(true)
    setProblem(null)
    const linked = await hasTelegramChat()
    setBusy(false)
    if (linked) {
      setStage('done-telegram')
      onSubscribed()
      return
    }
    setProblem('Belum sambung. Tekan Start dalam Telegram, lepas tu semak semula.')
  }

  async function useBrowser() {
    setBusy(true)
    setProblem(null)
    try {
      await subscribeToPush()
      setStage('done-browser')
      onSubscribed()
    } catch (cause: unknown) {
      setProblem(cause instanceof PushError ? cause.message : 'Gagal hidupkan notifikasi.')
    } finally {
      setBusy(false)
    }
  }

  if (stage === 'done-telegram' || stage === 'done-browser') {
    return (
      <Sheet open title="Beritahu saya bila naik" onClose={onClose}>
        <p className="mb-4 font-sans text-[15px] leading-relaxed text-white/70">
          {stage === 'done-telegram'
            ? 'Siap. Kami akan mesej anda dalam Telegram sebaik sahaja ada tempat.'
            : 'Siap. Telefon ni akan dapat notifikasi sebaik sahaja ada tempat.'}
        </p>
        <Button variant="primary" onClick={onClose} className="w-full">
          Tutup
        </Button>
      </Sheet>
    )
  }

  return (
    <Sheet open title="Beritahu saya bila naik" onClose={onClose}>
      <p className="mb-4 font-sans text-[15px] leading-relaxed text-white/70">
        Slot boleh terbuka bila-bila masa. Kami boleh beritahu anda sebaik sahaja dapat tempat —
        tak perlu buka halaman ni tunggu.
      </p>

      {problem !== null && <p className="mb-3 font-sans text-xs text-merah-soft">{problem}</p>}

      {stage === 'telegram-opened' ? (
        <div className="mb-4 space-y-2 rounded-lg border border-turf-lit/50 bg-turf/25 p-3">
          <p className="font-sans text-[14px] leading-relaxed text-white/85">
            Tekan <span className="font-semibold">Start</span> dalam Telegram, lepas tu balik sini
            dan semak.
          </p>
          <Button variant="primary" disabled={busy} onClick={() => void checkTelegram()} className="w-full">
            {busy ? 'Menyemak…' : 'Dah tekan Start'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void useTelegram()} className="w-full">
            Buka Telegram lagi
          </Button>
        </div>
      ) : (
        TELEGRAM_BOT !== '' && (
          <div className="mb-4">
            <Button variant="primary" disabled={busy} onClick={() => void useTelegram()} className="w-full">
              Guna Telegram
            </Button>
            <p className="mt-1 font-sans text-[12px] text-white/45">
              Paling senang, dan jalan pada semua telefon.
            </p>
          </div>
        )
      )}

      {/* Second, because it is the narrower option: free and instant on
          Android, but on iPhone it needs this app on the Home Screen. */}
      {capability === 'ready' && (
        <div className="mb-4">
          <Button variant="secondary" disabled={busy} onClick={() => void useBrowser()} className="w-full">
            Guna notifikasi telefon ni
          </Button>
          <p className="mt-1 font-sans text-[12px] text-white/45">
            Notifikasi terus pada peranti ni, tanpa app lain.
          </p>
        </div>
      )}

      {capability === 'needs-install' && (
        <p className="mb-4 font-sans text-[12px] leading-relaxed text-white/45">
          Notifikasi terus pada iPhone perlu app ni dipasang di Home Screen dulu. Telegram tak
          perlu apa-apa pemasangan.
        </p>
      )}

      {capability === 'blocked' && (
        <p className="mb-4 font-sans text-[12px] leading-relaxed text-white/45">
          Notifikasi browser disekat untuk laman ni dalam setting anda. Telegram masih boleh.
        </p>
      )}

      <Button variant="secondary" disabled={busy} onClick={onClose} className="w-full">
        Tak perlu
      </Button>
    </Sheet>
  )
}
