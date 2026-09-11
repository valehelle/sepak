import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Admin } from '../data/admins'

const SUPER: Admin = { email: 'hazmiirfan92@gmail.com', role: 'super', addedBy: null, createdAt: '2026-09-01T00:00:00Z' }
const OTHER_SUPER: Admin = { email: 'other-super@example.com', role: 'super', addedBy: null, createdAt: '2026-09-02T00:00:00Z' }
const PLAIN: Admin = { email: 'admin@sepak.local', role: 'admin', addedBy: 'hazmiirfan92@gmail.com', createdAt: '2026-09-03T00:00:00Z' }

const listAdmins = vi.fn()
const addAdmin = vi.fn()
const removeAdmin = vi.fn()

vi.mock('../data/admins', () => ({
  listAdmins: () => listAdmins(),
  addAdmin: (email: string, role: string) => addAdmin(email, role),
  removeAdmin: (email: string) => removeAdmin(email),
}))

const { ToastProvider } = await import('./Toast')
const { AdminList } = await import('./AdminList')

function view(currentEmail: string) {
  return render(
    <ToastProvider>
      <AdminList currentEmail={currentEmail} />
    </ToastProvider>,
  )
}

describe('AdminList', () => {
  beforeEach(() => {
    listAdmins.mockReset()
    addAdmin.mockReset()
    removeAdmin.mockReset()
  })

  it('lists every admin with a role tag', async () => {
    listAdmins.mockResolvedValue([SUPER, PLAIN])
    view(SUPER.email)
    await screen.findByText(SUPER.email)
    expect(screen.getByText(PLAIN.email)).toBeTruthy()

    // "Super"/"Admin" also label the add-form's role toggle buttons, so the
    // tag check is scoped to each row rather than a page-wide getByText.
    const rows = screen.getAllByRole('listitem')
    const superRow = rows.find((row) => row.textContent?.includes(SUPER.email))
    const plainRow = rows.find((row) => row.textContent?.includes(PLAIN.email))
    expect(superRow && within(superRow).getByText('Super')).toBeTruthy()
    expect(plainRow && within(plainRow).getByText('Admin')).toBeTruthy()
  })

  it('reports a load failure in the interface voice', async () => {
    listAdmins.mockRejectedValue(new Error('boom'))
    view(SUPER.email)
    expect(await screen.findByText('Gagal memuatkan senarai admin.')).toBeTruthy()
  })

  it('shows an empty state when there are no admins', async () => {
    listAdmins.mockResolvedValue([])
    view(SUPER.email)
    expect(await screen.findByText('Belum ada admin.')).toBeTruthy()
  })

  it('hides the Buang button on your own row', async () => {
    listAdmins.mockResolvedValue([SUPER, OTHER_SUPER])
    view(SUPER.email)
    await screen.findByText(SUPER.email)

    const rows = screen.getAllByRole('listitem')
    const ownRow = rows.find((row) => row.textContent?.includes(SUPER.email))
    const otherRow = rows.find((row) => row.textContent?.includes(OTHER_SUPER.email))
    expect(ownRow && within(ownRow).queryByRole('button', { name: 'Buang' })).toBeNull()
    expect(otherRow && within(otherRow).queryByRole('button', { name: 'Buang' })).toBeTruthy()
  })

  it('hides the Buang button on the last remaining super, even when viewed by someone else', async () => {
    listAdmins.mockResolvedValue([SUPER, PLAIN])
    view(PLAIN.email)
    await screen.findByText(SUPER.email)

    const rows = screen.getAllByRole('listitem')
    const superRow = rows.find((row) => row.textContent?.includes(SUPER.email))
    expect(superRow && within(superRow).queryByRole('button', { name: 'Buang' })).toBeNull()
  })

  it('adds an admin and tells the caller what happens next', async () => {
    listAdmins.mockResolvedValue([SUPER])
    addAdmin.mockResolvedValue({ ...PLAIN })
    view(SUPER.email)
    await screen.findByText(SUPER.email)

    await userEvent.type(screen.getByLabelText('E-mel'), 'new-admin@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Tambah admin' }))

    await waitFor(() => expect(addAdmin).toHaveBeenCalledWith('new-admin@example.com', 'admin'))
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        'Minta dia daftar dengan e-mel ini untuk tetapkan kata laluan.',
      ),
    )
  })

  it('adds an admin with the super role when selected', async () => {
    listAdmins.mockResolvedValue([SUPER])
    addAdmin.mockResolvedValue({ ...SUPER, email: 'new-super@example.com' })
    view(SUPER.email)
    await screen.findByText(SUPER.email)

    await userEvent.type(screen.getByLabelText('E-mel'), 'new-super@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Super' }))
    await userEvent.click(screen.getByRole('button', { name: 'Tambah admin' }))

    await waitFor(() => expect(addAdmin).toHaveBeenCalledWith('new-super@example.com', 'super'))
  })

  it('removes an admin', async () => {
    listAdmins.mockResolvedValue([SUPER, PLAIN])
    removeAdmin.mockResolvedValue(undefined)
    view(SUPER.email)
    await screen.findByText(PLAIN.email)

    const rows = screen.getAllByRole('listitem')
    const plainRow = rows.find((row) => row.textContent?.includes(PLAIN.email))
    expect(plainRow).toBeTruthy()
    if (plainRow === undefined) throw new Error('missing row')
    await userEvent.click(within(plainRow).getByRole('button', { name: 'Buang' }))

    await waitFor(() => expect(removeAdmin).toHaveBeenCalledWith(PLAIN.email))
  })
})
