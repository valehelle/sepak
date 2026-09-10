import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ToastProvider, useToast } from './Toast'

function Trigger() {
  const { show } = useToast()
  return (
    <>
      <button onClick={() => show('Slot dah diambil.', 'error')}>fail</button>
      <button onClick={() => show('Berjaya!')}>ok</button>
    </>
  )
}

describe('Toast', () => {
  it('shows a message when asked', async () => {
    render(<ToastProvider><Trigger /></ToastProvider>)
    await userEvent.click(screen.getByText('fail'))
    expect(screen.getByRole('status').textContent).toContain('Slot dah diambil.')
  })

  it('replaces the previous message rather than stacking forever', async () => {
    render(<ToastProvider><Trigger /></ToastProvider>)
    await userEvent.click(screen.getByText('fail'))
    await userEvent.click(screen.getByText('ok'))
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status').textContent).toContain('Berjaya!')
  })

  it('dismisses itself', async () => {
    render(<ToastProvider><Trigger /></ToastProvider>)
    await userEvent.click(screen.getByText('ok'))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull(), { timeout: 5000 })
  })

  it('throws a clear error when used outside the provider', () => {
    expect(() => render(<Trigger />)).toThrow(/ToastProvider/)
  })
})
