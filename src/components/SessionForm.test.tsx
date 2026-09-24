import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SessionForm, type SessionFormValues } from './SessionForm'

const INITIAL: SessionFormValues = {
  sessionNo: 6,
  title: 'Geng Turun Peluh',
  playDate: '2026-09-23',
  startTime: '20:00',
  durationMins: 120,
  venue: 'Padang Presint 8',
  feeMyr: 27,
  feeGkMyr: null,
  teamAName: 'Merah',
  teamBName: 'Putih',
  teamCName: 'Kuning',
  teamDName: 'Hijau',
}

describe('SessionForm', () => {
  it('prefills every field from the initial values', () => {
    render(<SessionForm initial={INITIAL} submitLabel="Simpan" busy={false} onSubmit={vi.fn()} />)
    expect(screen.getByLabelText<HTMLInputElement>('Sesi no.').value).toBe('6')
    expect(screen.getByLabelText<HTMLInputElement>('Nama sesi').value).toBe('Geng Turun Peluh')
    expect(screen.getByLabelText<HTMLInputElement>('Tarikh').value).toBe('2026-09-23')
    expect(screen.getByLabelText<HTMLInputElement>('Masa').value).toBe('20:00')
    expect(screen.getByLabelText<HTMLInputElement>('Tempat').value).toBe('Padang Presint 8')
    expect(screen.getByLabelText<HTMLInputElement>('Yuran (RM)').value).toBe('27')
  })

  it('submits the edited values', async () => {
    const onSubmit = vi.fn()
    render(<SessionForm initial={INITIAL} submitLabel="Simpan" busy={false} onSubmit={onSubmit} />)

    await userEvent.clear(screen.getByLabelText('Tempat'))
    await userEvent.type(screen.getByLabelText('Tempat'), 'Padang Presint 11')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ venue: 'Padang Presint 11' }))
  })

  it('submits a separate goalkeeper fee, and a blank one as the same price', async () => {
    const onSubmit = vi.fn()
    render(<SessionForm initial={INITIAL} submitLabel="Simpan" busy={false} onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ feeGkMyr: null }))

    await userEvent.type(screen.getByLabelText('Yuran GK (RM)'), '15')
    await userEvent.type(screen.getByLabelText('Pasukan D'), ' 2')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ feeGkMyr: 15, teamDName: 'Hijau 2' }))
  })

  it('refuses two teams with the same name', async () => {
    const onSubmit = vi.fn()
    render(<SessionForm initial={INITIAL} submitLabel="Simpan" busy={false} onSubmit={onSubmit} />)
    await userEvent.clear(screen.getByLabelText('Pasukan B'))
    await userEvent.type(screen.getByLabelText('Pasukan B'), 'merah ')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Setiap pasukan perlukan nama berbeza.')).toBeTruthy()
  })

  it('ignores the unused Team D name on a three-team session', async () => {
    const onSubmit = vi.fn()
    render(
      <SessionForm initial={{ ...INITIAL, teamDName: 'Kuning' }} teamCount={3} submitLabel="Simpan" busy={false} onSubmit={onSubmit} />,
    )
    expect(screen.queryByLabelText('Pasukan D')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    expect(onSubmit).toHaveBeenCalled()
  })

  it('refuses a negative goalkeeper fee', async () => {
    const onSubmit = vi.fn()
    render(<SessionForm initial={INITIAL} submitLabel="Simpan" busy={false} onSubmit={onSubmit} />)
    await userEvent.type(screen.getByLabelText('Yuran GK (RM)'), '-5')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Yuran GK tak sah.')).toBeTruthy()
  })

  it('treats a blank fee as free rather than as zero-as-text', async () => {
    const onSubmit = vi.fn()
    render(<SessionForm initial={INITIAL} submitLabel="Simpan" busy={false} onSubmit={onSubmit} />)
    await userEvent.clear(screen.getByLabelText('Yuran (RM)'))
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ feeMyr: null }))
  })

  it('refuses a blank title or venue', async () => {
    const onSubmit = vi.fn()
    render(<SessionForm initial={INITIAL} submitLabel="Simpan" busy={false} onSubmit={onSubmit} />)
    await userEvent.clear(screen.getByLabelText('Nama sesi'))
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/Isi nama sesi/)).toBeTruthy()
  })

  it('shows the derived day name so a wrong date is obvious', async () => {
    render(<SessionForm initial={INITIAL} submitLabel="Simpan" busy={false} onSubmit={vi.fn()} />)
    expect(screen.getByText(/23\/09\/2026 \(RABU\)/)).toBeTruthy()
  })
})
