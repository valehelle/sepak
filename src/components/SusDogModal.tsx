import { useEffect } from 'react'

type SusDogModalProps = {
  open: boolean
  onClose: () => void
}

/** Shown after one particular regular books (see lib/susDog). */
export function SusDogModal({ open, onClose }: SusDogModalProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sus-dog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-night-2 p-5 text-center shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <img src={`${import.meta.env.BASE_URL}sus-dog.jpg`} alt="Anjing pandang curiga" className="mx-auto mb-4 w-full rounded-xl" />
        <h2 id="sus-dog-title" className="mb-5 font-kit text-2xl font-bold leading-tight text-white">
          kata xnak join minggu depan
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-lg bg-turf-lit px-4 py-3 font-kit text-[15px] font-semibold text-night active:opacity-80"
        >
          Hehe
        </button>
      </div>
    </div>
  )
}
