import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type Tone = 'info' | 'error'
type ToastApi = { show: (message: string, tone?: Tone) => void }

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (api === null) throw new Error('useToast must be used inside a ToastProvider')
  return api
}

type Current = { message: string; tone: Tone }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Current | null>(null)

  const show = useCallback((message: string, tone: Tone = 'info') => {
    setCurrent({ message, tone })
  }, [])

  useEffect(() => {
    if (current === null) return
    const timer = setTimeout(() => setCurrent(null), 3200)
    return () => clearTimeout(timer)
  }, [current])

  const api = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {current !== null && (
        <div
          role="status"
          aria-live="polite"
          className={[
            'fixed inset-x-4 bottom-6 z-50 rounded-lg px-4 py-3 text-center font-kit text-[15px] font-medium shadow-lg md:inset-x-auto md:left-1/2 md:w-full md:max-w-sm md:-translate-x-1/2',
            current.tone === 'error' ? 'bg-merah text-white' : 'bg-putih text-night',
          ].join(' ')}
        >
          {current.message}
        </div>
      )}
    </ToastContext.Provider>
  )
}
