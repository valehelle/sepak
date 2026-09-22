import { describeChange, type RosterChange } from '../lib/whatsapp'
import { Button } from './Button'
import { CopyButton } from './CopyButton'
import { Sheet } from './Sheet'

type ShareChangeSheetProps = {
  /** What just happened, or null when nothing is being announced. */
  change: RosterChange | null
  /** The whole message to paste, change line included. Built by the page,
   *  which is the only thing holding the roster. */
  message: string
  onClose: () => void
}

/** Offered right after a change that alters the list already sitting in the
 *  group chat: a release, a position change, a payment tick.
 *
 *  Deliberately NOT offered after a claim. A claim only ever adds a name,
 *  and during the opening rush it would fire thirty-three times.
 *
 *  Only the one line is shown, not the message: the paste is some forty
 *  lines, and a preview of it in a bottom sheet is something to scroll past
 *  rather than something to read. */
export function ShareChangeSheet({ change, message, onClose }: ShareChangeSheetProps) {
  if (change === null) return null
  const line = describeChange(change)
  if (line === null) return null

  return (
    <Sheet open title="Senarai dah berubah" onClose={onClose}>
      <p className="mb-3 font-sans text-[15px] leading-relaxed text-white/70">
        Senarai dalam group WhatsApp dah tak sama. Copy yang baru dan paste kat group.
      </p>
      <p className="mb-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-sans text-[14px] leading-relaxed text-white">
        {line}
      </p>
      <div className="space-y-2">
        <CopyButton text={message} label="Salin untuk WhatsApp" emphasis="primary" />
        <Button variant="secondary" onClick={onClose} className="w-full">
          Tutup
        </Button>
      </div>
    </Sheet>
  )
}
