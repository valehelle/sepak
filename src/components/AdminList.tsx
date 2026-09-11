import { useCallback, useEffect, useState } from 'react'
import { addAdmin, listAdmins, removeAdmin, type Admin, type AdminRole } from '../data/admins'
import { Button } from './Button'
import { inputClass } from './Input'
import { useToast } from './Toast'

type AdminListProps = { currentEmail: string }

const ROLE_LABEL: Record<AdminRole, string> = { super: 'Super', admin: 'Admin' }

export function AdminList({ currentEmail }: AdminListProps) {
  const { show } = useToast()
  const [admins, setAdmins] = useState<Admin[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AdminRole>('admin')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const rows = await listAdmins()
      setAdmins(rows)
      setLoadError(false)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const superCount = admins.filter((a) => a.role === 'super').length

  async function submit() {
    if (email.trim() === '') return
    setBusy(true)
    try {
      await addAdmin(email, role)
      setEmail('')
      setRole('admin')
      show('Admin ditambah. Minta dia daftar dengan e-mel ini untuk tetapkan kata laluan.')
      await load()
    } catch {
      show('Gagal menambah admin.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove(target: Admin) {
    setBusy(true)
    try {
      await removeAdmin(target.email)
      show('Admin dibuang.')
      await load()
    } catch {
      show('Gagal membuang admin.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3 rounded-lg bg-night-2 p-3">
      <h2 className="font-kit text-base font-semibold tracking-wide text-white">Admin</h2>

      {loading && <p className="font-sans text-[13px] text-white/45">Memuatkan…</p>}
      {!loading && loadError && (
        <p className="font-sans text-[13px] text-white/45">Gagal memuatkan senarai admin.</p>
      )}
      {!loading && !loadError && admins.length === 0 && (
        <p className="font-sans text-[13px] text-white/45">Belum ada admin.</p>
      )}

      {!loading && !loadError && admins.length > 0 && (
        <ul>
          {admins.map((a) => {
            // Neither yourself nor the last remaining super can be removed
            // from here -- the same invariant the DB trigger enforces, kept
            // visible in the UI so an admin never taps a button that the
            // backend was always going to refuse.
            const isSelf = a.email.toLowerCase() === currentEmail.toLowerCase()
            const isLastSuper = a.role === 'super' && superCount <= 1
            const canRemove = !isSelf && !isLastSuper

            return (
              <li
                key={a.email}
                className="flex items-center justify-between gap-2 border-t border-white/10 py-2 first:border-t-0"
              >
                <p className="min-w-0 truncate font-sans text-[15px] font-medium text-white">{a.email}</p>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-sm bg-white/10 px-2 py-0.5 font-kit text-xs font-semibold text-white/70">
                    {ROLE_LABEL[a.role]}
                  </span>
                  {canRemove && (
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void remove(a)}
                      size="sm"
                    >
                      Buang
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className="space-y-2 border-t border-white/10 pt-3"
      >
        <div className="space-y-1">
          <label htmlFor="admin-email" className="block font-kit text-[13px] font-medium text-white/45">
            E-mel
          </label>
          <input
            id="admin-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="flex gap-2" role="group" aria-label="Peranan">
          <button
            type="button"
            aria-pressed={role === 'admin'}
            onClick={() => setRole('admin')}
            className={[
              'flex-1 rounded-lg px-3 py-2 font-kit text-[13px] font-semibold transition',
              role === 'admin' ? 'bg-turf-lit text-white' : 'bg-white/5 text-white/70',
            ].join(' ')}
          >
            Admin
          </button>
          <button
            type="button"
            aria-pressed={role === 'super'}
            onClick={() => setRole('super')}
            className={[
              'flex-1 rounded-lg px-3 py-2 font-kit text-[13px] font-semibold transition',
              role === 'super' ? 'bg-turf-lit text-white' : 'bg-white/5 text-white/70',
            ].join(' ')}
          >
            Super
          </button>
        </div>

        <Button type="submit" variant="primary" disabled={busy || email.trim() === ''} className="w-full">
          Tambah admin
        </Button>
      </form>
    </section>
  )
}
