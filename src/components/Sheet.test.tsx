import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Sheet } from './Sheet'

describe('Sheet', () => {
  it('renders nothing when closed', () => {
    render(<Sheet open={false} title="Ambil slot" onClose={() => {}}><p>body</p></Sheet>)
    expect(screen.queryByText('body')).toBeNull()
  })

  it('renders its title and children when open', () => {
    render(<Sheet open title="Ambil slot" onClose={() => {}}><p>body</p></Sheet>)
    expect(screen.getByRole('dialog', { name: 'Ambil slot' })).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()
  })

  it('closes on backdrop tap', async () => {
    const onClose = vi.fn()
    render(<Sheet open title="Ambil slot" onClose={onClose}><p>body</p></Sheet>)
    await userEvent.click(screen.getByTestId('sheet-backdrop'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not close when the panel itself is tapped', async () => {
    const onClose = vi.fn()
    render(<Sheet open title="Ambil slot" onClose={onClose}><p>body</p></Sheet>)
    await userEvent.click(screen.getByText('body'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<Sheet open title="Ambil slot" onClose={onClose}><p>body</p></Sheet>)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
