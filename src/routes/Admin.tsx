import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { SessionForm, type SessionFormValues } from '../components/SessionForm'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { signIn, signOut, useAuthUser } from '../data/auth'
import { createSession, deleteSession, listSessions, nextSessionNo, setSessionStatus, updateSession } from '../data/sessions'
import type { Session } from '../data/types'
import { formatPlayDate, formatStartTime } from '../lib/format'

const DEFAULTS: SessionFormValues = {
  sessionNo: 1,
  title: '',
  playDate: '',
  startTime: '20:00',
  durationMins: 120,
  venue: '',
  feeMyr: null,
  teamAName: 'Merah',
  teamBName: 'Putih',
  teamCName: 'Kuning',
}

function LoginForm() {
  const { show } = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      await signIn(email, password)
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : ''
      show(
        message.includes('Invalid login credentials')
          ? 'E-mel atau kata laluan salah.'
          : 'Gagal masuk. Cuba lagi.',
        'error',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-3 p-6">
      <h1 className="text-xl font-bold">Admin</h1>
      <div className="space-y-1">
        <label htmlFor="email" className="block text-xs font-semibold text-slate-400">E-mel</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-2xl bg-slate-800 px-4 py-3 text-base outline-none focus:ring-2 focus:ring-emerald-400"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="password" className="block text-xs font-semibold text-slate-400">Kata laluan</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-2xl bg-slate-800 px-4 py-3 text-base outline-none focus:ring-2 focus:ring-emerald-400"
        />
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-60"
      >
        Masuk
      </button>
    </div>
  )
}

export default function Admin() {
  const { email, loading } = useAuthUser()
  const { show } = useToast()

  const [sessions, setSessions] = useState<Session[]>([])
  const [formValues, setFormValues] = useState<SessionFormValues | null>(null)
  // Bumped by every opener (openNew/openDuplicate/openEdit) and used as the
  // SessionForm's key, so the form always remounts with fresh internal state
  // instead of one opener's values leaking into the next via a preserved
  // instance — `key={editing?.id ?? 'new'}` would not distinguish "Sesi baru"
  // from "Duplikasi sesi lepas", since both map to 'new'.
  const [formKey, setFormKey] = useState(0)
  const [editing, setEditing] = useState<Session | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Session | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      setSessions(await listSessions())
    } catch {
      show('Gagal memuatkan senarai sesi.', 'error')
    }
  }, [show])

  useEffect(() => {
    if (email === null) return
    void reload()
  }, [email, reload])

  // openNew/openDuplicate fetch the next session number before they can
  // produce final form values, so the formKey bump has to land in the same
  // batch as setFormValues (i.e. after the await) rather than before it —
  // bumping it earlier would remount SessionForm once against the *old*
  // formValues (still on screen from a prior edit) and, since the key would
  // then be unchanged when the real values arrive, they'd never take.
  const openNew = useCallback(async () => {
    try {
      const sessionNo = await nextSessionNo()
      setEditing(null)
      setFormKey((key) => key + 1)
      setFormValues({ ...DEFAULTS, sessionNo })
    } catch {
      show('Gagal menyediakan borang sesi baru.', 'error')
    }
  }, [show])

  /** The weekly path: everything carries over except the date, which is the
   *  one field that genuinely changes. */
  const openDuplicate = useCallback(async () => {
    const last = sessions[0]
    if (last === undefined) {
      show('Belum ada sesi untuk diduplikasi.', 'error')
      return
    }
    try {
      const sessionNo = await nextSessionNo()
      setEditing(null)
      setFormKey((key) => key + 1)
      setFormValues({
        sessionNo,
        title: last.title,
        playDate: '',
        startTime: last.startTime.slice(0, 5),
        durationMins: last.durationMins,
        venue: last.venue,
        feeMyr: last.feeMyr,
        teamAName: last.teamNames.A,
        teamBName: last.teamNames.B,
        teamCName: last.teamNames.C,
      })
    } catch {
      show('Gagal menyediakan borang duplikasi.', 'error')
    }
  }, [sessions, show])

  function openEdit(session: Session) {
    setEditing(session)
    setFormKey((key) => key + 1)
    setFormValues({
      sessionNo: session.sessionNo,
      title: session.title,
      playDate: session.playDate,
      startTime: session.startTime.slice(0, 5),
      durationMins: session.durationMins,
      venue: session.venue,
      feeMyr: session.feeMyr,
      teamAName: session.teamNames.A,
      teamBName: session.teamNames.B,
      teamCName: session.teamNames.C,
    })
  }

  /** Every field stays editable after creation, including the fee: this
   *  payload is shared between creating and updating a session. */
  async function submit(values: SessionFormValues) {
    setBusy(true)
    try {
      const payload = {
        sessionNo: values.sessionNo,
        title: values.title,
        playDate: values.playDate,
        startTime: values.startTime,
        durationMins: values.durationMins,
        venue: values.venue,
        feeMyr: values.feeMyr,
        teamAName: values.teamAName,
        teamBName: values.teamBName,
        teamCName: values.teamCName,
      }

      if (editing !== null) {
        await updateSession(editing.id, payload)
        show('Sesi dikemas kini.')
      } else {
        await createSession(payload)
        show('Sesi dicipta.')
      }

      setFormValues(null)
      setEditing(null)
      await reload()
    } catch {
      show(editing !== null ? 'Gagal mengemas kini sesi.' : 'Gagal mencipta sesi.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function toggleStatus(session: Session) {
    try {
      await setSessionStatus(session.id, session.status === 'open' ? 'closed' : 'open')
      await reload()
    } catch {
      show('Gagal menukar status sesi.', 'error')
    }
  }

  async function remove(session: Session) {
    try {
      await deleteSession(session.id)
      setConfirmDelete(null)
      await reload()
      show('Sesi dihapus.')
    } catch {
      show('Gagal menghapus sesi.', 'error')
    }
  }

  if (loading) return <p className="p-6 text-slate-400">Memuatkan…</p>
  if (email === null) return <LoginForm />

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Admin</h1>
        <button type="button" onClick={() => void signOut()} className="text-sm text-slate-400 underline">
          Keluar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void openNew()}
          className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950"
        >
          Sesi baru
        </button>
        <button
          type="button"
          onClick={() => void openDuplicate()}
          className="rounded-2xl bg-slate-800 px-4 py-3 text-sm font-semibold"
        >
          Duplikasi sesi lepas
        </button>
      </div>

      <ul className="space-y-3">
        {sessions.map((session) => (
          <li key={session.id} className="space-y-2 rounded-3xl bg-slate-900/70 p-4">
            <p className="font-semibold">
              {`Sesi ${String(session.sessionNo).padStart(3, '0')} ${session.title}`}
            </p>
            <p className="text-sm text-slate-400">
              {`${formatPlayDate(session.playDate)} · ${formatStartTime(session.startTime)} · ${session.venue}`}
            </p>
            <div className="flex flex-wrap gap-2">
              <Link to={`/s/${session.id}`} className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold">
                Buka
              </Link>
              <button
                type="button"
                onClick={() => void toggleStatus(session)}
                className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold"
              >
                {session.status === 'open' ? 'Tutup sesi' : 'Buka semula'}
              </button>
              <button
                type="button"
                onClick={() => openEdit(session)}
                className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold"
              >
                Sunting
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(session)}
                className="rounded-xl bg-red-500/20 px-3 py-2 text-xs font-semibold text-red-300"
              >
                Hapus
              </button>
            </div>
          </li>
        ))}
      </ul>

      {formValues !== null && (
        <Sheet
          open
          title={editing !== null ? 'Sunting sesi' : 'Sesi baru'}
          onClose={() => { setFormValues(null); setEditing(null) }}
        >
          <div className="max-h-[70vh] overflow-y-auto">
            <SessionForm
              key={formKey}
              initial={formValues}
              submitLabel={editing !== null ? 'Simpan perubahan' : 'Cipta sesi'}
              busy={busy}
              onSubmit={(v) => void submit(v)}
            />
          </div>
        </Sheet>
      )}

      {confirmDelete !== null && (
        <Sheet open title="Hapus sesi?" onClose={() => setConfirmDelete(null)}>
          <p className="mb-4 text-sm text-slate-300">
            {`Sesi ${String(confirmDelete.sessionNo).padStart(3, '0')} dan semua slotnya akan hilang.`}
          </p>
          <button
            type="button"
            onClick={() => void remove(confirmDelete)}
            className="w-full rounded-2xl bg-red-500 px-4 py-3 text-sm font-bold text-white"
          >
            Ya, hapus
          </button>
        </Sheet>
      )}
    </div>
  )
}
