import { useEffect, useRef, type ReactNode } from 'react'

type SheetProps = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

export function Sheet({ open, title, onClose, children }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.querySelector<HTMLElement>('input, button')?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    // Sized to the visible viewport (dvh), not vh: on iOS Safari vh assumes the
    // toolbar is hidden, so with it showing the bottom of a sheet sat behind it.
    <div className="fixed inset-x-0 top-0 z-40 flex h-[100dvh] items-end md:items-center md:justify-center">
      <div
        data-testid="sheet-backdrop"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[88dvh] w-full overflow-y-auto rounded-t-lg border border-white/10 bg-night-2 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl md:mx-4 md:w-full md:max-w-lg md:rounded-lg"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15 md:hidden" aria-hidden="true" />
        <h2 className="mb-4 font-kit text-xl font-semibold text-white">{title}</h2>
        {children}
      </div>
    </div>
  )
}
