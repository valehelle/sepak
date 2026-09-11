import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../data/types'

const SESSION: Session = {
  id: 'session-1',
  sessionNo: 5,
  title: 'Geng Turun Peluh',
  playDate: '2026-09-16',
  startTime: '20:00:00',
  durationMins: 120,
  venue: 'Padang Presint 8',
  feeMyr: 27,
  teamNames: { A: 'Merah', B: 'Putih', C: 'Kuning' },
  status: 'open',
  createdAt: '2026-09-10T00:00:00Z',
}

const auth = { email: null as string | null, role: null as 'super' | 'admin' | null, loading: false }
const signIn = vi.fn()
const signUp = vi.fn()
const signOut = vi.fn()
const listSessions = vi.fn()
const createSession = vi.fn()
const updateSession = vi.fn()
const setSessionStatus = vi.fn()
const deleteSessionFn = vi.fn()
const nextSessionNo = vi.fn()
const listAdmins = vi.fn()

vi.mock('../data/auth', () => ({
  useAuthUser: () => auth,
  signIn: (email: string, password: string) => signIn(email, password),
  signUp: (email: string, password: string) => signUp(email, password),
  signOut: () => signOut(),
}))

vi.mock('../data/admins', () => ({
  listAdmins: () => listAdmins(),
  addAdmin: vi.fn(),
  removeAdmin: vi.fn(),
}))

vi.mock('../data/sessions', () => ({
  listSessions: () => listSessions(),
  createSession: (input: unknown) => createSession(input),
  updateSession: (id: string, patch: unknown) => updateSession(id, patch),
  setSessionStatus: (id: string, status: string) => setSessionStatus(id, status),
  deleteSession: (id: string) => deleteSessionFn(id),
  nextSessionNo: () => nextSessionNo(),
  fillCounts: () => Promise.resolve(new Map()),
}))

const { ToastProvider } = await import('../components/Toast')
const { default: Admin } = await import('./Admin')

function view() {
  return render(<MemoryRouter><ToastProvider><Admin /></ToastProvider></MemoryRouter>)
}

describe('Admin', () => {
  beforeEach(() => {
    auth.email = null
    auth.role = null
    auth.loading = false
    signIn.mockReset()
    signUp.mockReset()
    signOut.mockReset()
    listSessions.mockReset().mockResolvedValue([SESSION])
    createSession.mockReset().mockResolvedValue({ ...SESSION, id: 'new-session' })
    updateSession.mockReset().mockResolvedValue(SESSION)
    setSessionStatus.mockReset().mockResolvedValue({ ...SESSION, status: 'closed' })
    deleteSessionFn.mockReset().mockResolvedValue(undefined)
    nextSessionNo.mockReset().mockResolvedValue(6)
    listAdmins.mockReset().mockResolvedValue([])
  })

  it('asks for a login when signed out', () => {
    view()
    expect(screen.getByLabelText('E-mel')).toBeTruthy()
    expect(screen.getByLabelText('Kata laluan')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Sesi baru/ })).toBeNull()
  })

  it('signs in', async () => {
    signIn.mockResolvedValue(undefined)
    view()
    await userEvent.type(screen.getByLabelText('E-mel'), 'hazmi@example.com')
    await userEvent.type(screen.getByLabelText('Kata laluan'), 'rahsia123')
    await userEvent.click(screen.getByRole('button', { name: 'Masuk' }))
    expect(signIn).toHaveBeenCalledWith('hazmi@example.com', 'rahsia123')
  })

  it('reports a bad login', async () => {
    signIn.mockRejectedValue(new Error('Invalid login credentials'))
    view()
    await userEvent.type(screen.getByLabelText('E-mel'), 'hazmi@example.com')
    await userEvent.type(screen.getByLabelText('Kata laluan'), 'salah')
    await userEvent.click(screen.getByRole('button', { name: 'Masuk' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('E-mel atau kata laluan salah.'))
  })

  it('signs up through the Daftar toggle', async () => {
    signUp.mockResolvedValue(undefined)
    view()
    await userEvent.click(screen.getByRole('button', { name: /Daftar di sini/ }))
    await userEvent.type(screen.getByLabelText('E-mel'), 'baru@example.com')
    await userEvent.type(screen.getByLabelText('Kata laluan'), 'rahsia123')
    await userEvent.click(screen.getByRole('button', { name: 'Daftar' }))
    expect(signUp).toHaveBeenCalledWith('baru@example.com', 'rahsia123')
  })

  it('tells a signed-in non-admin their account is not on the allowlist', () => {
    auth.email = 'stranger@example.com'
    auth.role = null
    view()
    expect(screen.getByText('Akaun ini bukan admin. Minta admin utama tambah e-mel anda.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Sesi baru/ })).toBeNull()
  })

  it('lists sessions once signed in', async () => {
    auth.email = 'hazmi@example.com'
    auth.role = 'admin'
    view()
    await waitFor(() => expect(screen.getByText(/Sesi 005/)).toBeTruthy())
  })

  it('creates a session, prefilling the next number', async () => {
    auth.email = 'hazmi@example.com'
    auth.role = 'admin'
    view()
    await userEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Sesi baru' })))
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Sesi no.').value).toBe('6'))

    await userEvent.type(screen.getByLabelText('Nama sesi'), 'Geng Turun Peluh')
    await userEvent.type(screen.getByLabelText('Tarikh'), '2026-09-23')
    await userEvent.type(screen.getByLabelText('Tempat'), 'Padang Presint 8')
    await userEvent.click(screen.getByRole('button', { name: 'Cipta sesi' }))

    await waitFor(() => expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionNo: 6, venue: 'Padang Presint 8' }),
    ))
  })

  it('duplicates the last session, keeping venue and fee but clearing nothing else', async () => {
    auth.email = 'hazmi@example.com'
    auth.role = 'admin'
    view()
    await userEvent.click(await waitFor(() => screen.getByRole('button', { name: /Duplikasi sesi lepas/ })))

    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Tempat').value).toBe('Padang Presint 8')
      expect(screen.getByLabelText<HTMLInputElement>('Yuran (RM)').value).toBe('27')
      expect(screen.getByLabelText<HTMLInputElement>('Sesi no.').value).toBe('6')
      // The date is deliberately blank: it is the one thing that must change.
      expect(screen.getByLabelText<HTMLInputElement>('Tarikh').value).toBe('')
    })
  })

  it('closes a session', async () => {
    auth.email = 'hazmi@example.com'
    auth.role = 'admin'
    view()
    await userEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Tutup sesi' })))
    expect(setSessionStatus).toHaveBeenCalledWith('session-1', 'closed')
  })

  it('requires confirmation before deleting', async () => {
    auth.email = 'hazmi@example.com'
    auth.role = 'admin'
    view()
    await userEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Hapus' })))
    expect(deleteSessionFn).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Ya, hapus' }))
    expect(deleteSessionFn).toHaveBeenCalledWith('session-1')
  })

  it('signs out', async () => {
    auth.email = 'hazmi@example.com'
    auth.role = 'admin'
    view()
    await userEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Keluar' })))
    expect(signOut).toHaveBeenCalled()
  })

  it('edits an existing session, prefilled from its current values', async () => {
    // `updateSession` from the mocked module is a thin wrapper around this
    // spy (see the vi.mock factory above), not a spy itself — assert against
    // the spy directly rather than the re-imported wrapper function.
    auth.email = 'hazmi@example.com'
    auth.role = 'admin'
    view()

    await userEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Sunting' })))
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Tempat').value).toBe('Padang Presint 8'))

    await userEvent.clear(screen.getByLabelText('Yuran (RM)'))
    await userEvent.type(screen.getByLabelText('Yuran (RM)'), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }))

    await waitFor(() => expect(updateSession).toHaveBeenCalledWith('session-1', expect.objectContaining({ feeMyr: 30 })))
  })

  it('keeps a session editable after it has been closed', async () => {
    auth.email = 'hazmi@example.com'
    auth.role = 'admin'
    listSessions.mockResolvedValue([{ ...SESSION, status: 'closed' }])
    view()
    expect(await waitFor(() => screen.getByRole('button', { name: 'Sunting' }))).toBeTruthy()
  })

  it('never lets a stale edit leak into a new session', async () => {
    auth.email = 'hazmi@example.com'
    auth.role = 'admin'
    view()

    // Open the edit sheet, then go straight on to "Sesi baru" without
    // closing it first — the one transition that would post as an update
    // (or carry the edited session's own values) if `openNew` ever forgot
    // to clear `editing`, or if the form failed to remount with fresh state.
    await userEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Sunting' })))
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Tempat').value).toBe('Padang Presint 8'))

    await userEvent.click(screen.getByRole('button', { name: 'Sesi baru' }))

    // The form must reset to blank defaults, not keep showing the edited
    // session's stale values.
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Sesi no.').value).toBe('6')
      expect(screen.getByLabelText<HTMLInputElement>('Nama sesi').value).toBe('')
      expect(screen.getByLabelText<HTMLInputElement>('Tempat').value).toBe('')
      expect(screen.getByLabelText<HTMLInputElement>('Tarikh').value).toBe('')
    })

    await userEvent.type(screen.getByLabelText('Nama sesi'), 'Sesi Baharu')
    await userEvent.type(screen.getByLabelText('Tarikh'), '2026-09-30')
    await userEvent.type(screen.getByLabelText('Tempat'), 'Padang Baharu')
    await userEvent.click(screen.getByRole('button', { name: 'Cipta sesi' }))

    await waitFor(() => expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionNo: 6,
        title: 'Sesi Baharu',
        venue: 'Padang Baharu',
        playDate: '2026-09-30',
      }),
    ))
    expect(updateSession).not.toHaveBeenCalled()
  })

  it('never lets a stale edit leak into a duplicated session', async () => {
    auth.email = 'hazmi@example.com'
    auth.role = 'admin'
    view()

    await userEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Sunting' })))
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Tempat').value).toBe('Padang Presint 8'))

    await userEvent.click(screen.getByRole('button', { name: /Duplikasi sesi lepas/ }))

    // Venue/fee carry over from the last session, the number advances, and
    // the date resets blank — none of it should be the edited session's own
    // stale values (sessionNo 5, playDate 2026-09-16).
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Sesi no.').value).toBe('6')
      expect(screen.getByLabelText<HTMLInputElement>('Tempat').value).toBe('Padang Presint 8')
      expect(screen.getByLabelText<HTMLInputElement>('Yuran (RM)').value).toBe('27')
      expect(screen.getByLabelText<HTMLInputElement>('Tarikh').value).toBe('')
    })

    await userEvent.type(screen.getByLabelText('Tarikh'), '2026-09-30')
    await userEvent.click(screen.getByRole('button', { name: 'Cipta sesi' }))

    await waitFor(() => expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionNo: 6,
        venue: 'Padang Presint 8',
        feeMyr: 27,
        playDate: '2026-09-30',
      }),
    ))
    expect(updateSession).not.toHaveBeenCalled()
  })

  it('shows the admin allowlist to a super admin', async () => {
    auth.email = 'hazmi@example.com'
    auth.role = 'super'
    view()
    await waitFor(() => expect(listAdmins).toHaveBeenCalled())
    expect(await screen.findByRole('heading', { name: 'Admin', level: 2 })).toBeTruthy()
  })

  it('hides the admin allowlist from a plain admin', async () => {
    auth.email = 'hazmi@example.com'
    auth.role = 'admin'
    view()
    await waitFor(() => expect(screen.getByText(/Sesi 005/)).toBeTruthy())
    expect(screen.queryByRole('heading', { name: 'Admin', level: 2 })).toBeNull()
    expect(listAdmins).not.toHaveBeenCalled()
  })
})
