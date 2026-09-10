import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type Tone = 'info' | 'error'
type ToastApi = { show: (message: string, tone?: Tone) => void }

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (api === null) throw new Error('useToast must be used inside a ToastProvider')
  return api
}

type Current = { message: string; tone: Tone; key: number }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Current | null>(null)

  const show = useCallback((message: string, tone: Tone = 'info') => {
    setCurrent({ message, tone, key: Date.now() })
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
            'fixed inset-x-4 bottom-6 z-50 rounded-2xl px-4 py-3 text-center text-sm font-medium shadow-lg',
            current.tone === 'error' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-900',
          ].join(' ')}
        >
          {current.message}
        </div>
      )}
    </ToastContext.Provider>
  )
}
