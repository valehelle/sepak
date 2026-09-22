import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RosterChange } from '../lib/whatsapp'
import { ShareChangeSheet } from './ShareChangeSheet'
import { ToastProvider } from './Toast'

const AT = { team: 'A' as const, teamName: 'Merah', position: 'GK' as const }

function view(change: RosterChange | null, onClose = () => {}) {
  return render(
    <ToastProvider>
      <ShareChangeSheet change={change} message="FULL MESSAGE" onClose={onClose} />
    </ToastProvider>,
  )
}

describe('ShareChangeSheet', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })

  it('stays out of the way when nothing happened', () => {
    view(null)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the one line, and copies the whole message', async () => {
    view({ kind: 'release', at: AT, playerName: 'Amir', takenBy: null })

    expect(screen.getByText('🔴 Team A Merah — GK: Amir → kosong')).toBeTruthy()
    // The paste is forty lines; the sheet shows the headline, not the body.
    expect(screen.queryByText('FULL MESSAGE')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Salin untuk WhatsApp' }))
    expect(writeText).toHaveBeenCalledWith('FULL MESSAGE')
  })

  it('names the player the queue promoted, on the same line', () => {
    view({ kind: 'release', at: AT, playerName: 'Amir', takenBy: 'Isaac' })
    expect(
      screen.getByText('🔄 Team A Merah — GK: Amir → Isaac (naik dari senarai tunggu)'),
    ).toBeTruthy()
  })

  it('does not open at all for a tick somebody took back', () => {
    view({ kind: 'unpaid', at: AT, playerName: 'Amir' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Tutup', async () => {
    const onClose = vi.fn()
    view({ kind: 'paid', at: AT, playerName: 'Amir' }, onClose)
    await userEvent.click(screen.getByRole('button', { name: 'Tutup' }))
    expect(onClose).toHaveBeenCalled()
  })
})
