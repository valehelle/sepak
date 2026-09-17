import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Slot } from '../data/types'
import { firstOf } from '../test-utils'
import { PitchTeam } from './PitchTeam'

function slot(position: Slot['position'], playerName: string | null): Slot {
  return {
    id: `slot-${position}`,
    sessionId: 'session-1',
    team: 'A',
    position,
    playerName,
    claimedAt: playerName === null ? null : '2026-09-10T06:00:00Z',
    paid: false,
  }
}

describe('PitchTeam', () => {
  const base = {
    team: 'A' as const,
    teamName: 'Merah',
    mySlotIds: new Set<string>(),
    disabled: false,
    onSelect: vi.fn(),
  }

  it('renders all eleven positions even when no slots exist yet', () => {
    render(<PitchTeam {...base} slots={[]} />)
    expect(screen.getAllByRole('button')).toHaveLength(11)
    expect(screen.getAllByText('CB')).toHaveLength(2)
  })

  it('names the team', () => {
    render(<PitchTeam {...base} slots={[]} />)
    expect(screen.getByText('Team A Merah')).toBeTruthy()
  })

  it('shows a claimed player name', () => {
    render(<PitchTeam {...base} slots={[slot('GK', 'Isaac')]} />)
    expect(screen.getByText('Isaac')).toBeTruthy()
  })

  it('marks a paid slot, and only a paid one', () => {
    const paid = { ...slot('GK', 'Isaac'), paid: true }
    render(<PitchTeam {...base} slots={[paid, slot('ST', 'Amir')]} />)
    expect(screen.getByRole('button', { name: /GK.*Isaac.*dah bayar/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Amir.*dah bayar/i })).toBeNull()
  })

  it('marks the slot this device owns', () => {
    render(<PitchTeam {...base} mySlotIds={new Set(['slot-ST'])} slots={[slot('ST', 'Hazmi')]} />)
    expect(screen.getByRole('button', { name: /ST.*Hazmi.*slot anda/i })).toBeTruthy()
  })

  it('does not mark a slot owned by another device', () => {
    render(<PitchTeam {...base} slots={[slot('ST', 'Hazmi')]} />)
    expect(screen.queryByRole('button', { name: /slot anda/i })).toBeNull()
  })

  it('reports an empty slot as available', async () => {
    const onSelect = vi.fn()
    render(<PitchTeam {...base} onSelect={onSelect} slots={[]} />)
    await userEvent.click(screen.getByRole('button', { name: /GK/ }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ position: 'GK', mine: false, slot: null }))
  })

  it('reports selection of your own slot as yours', async () => {
    const onSelect = vi.fn()
    const mine = slot('ST', 'Hazmi')
    render(<PitchTeam {...base} mySlotIds={new Set(['slot-ST'])} onSelect={onSelect} slots={[mine]} />)
    await userEvent.click(screen.getByRole('button', { name: /ST/ }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ mine: true, slot: mine }))
  })

  it("ignores taps on another player's slot", async () => {
    const onSelect = vi.fn()
    render(<PitchTeam {...base} onSelect={onSelect} slots={[slot('ST', 'Amir')]} />)
    await userEvent.click(screen.getByRole('button', { name: /ST/ }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('disables everything when the session is closed', async () => {
    const onSelect = vi.fn()
    render(<PitchTeam {...base} disabled onSelect={onSelect} slots={[]} />)
    for (const button of screen.getAllByRole('button')) expect(button).toHaveProperty('disabled', true)
    await userEvent.click(firstOf(screen.getAllByRole('button')))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('lets an admin tap an occupied slot owned by someone else', async () => {
    const onSelect = vi.fn()
    render(<PitchTeam {...base} adminOverride onSelect={onSelect} slots={[slot('ST', 'Amir')]} />)
    await userEvent.click(screen.getByRole('button', { name: /ST/ }))
    expect(onSelect).toHaveBeenCalled()
  })
})
