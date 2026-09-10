import { describe, expect, it } from 'vitest'
import { PITCH_ROWS, POSITIONS, TEAM_KEYS, isPosition, isTeamKey, positionLabel } from './positions'

describe('positions', () => {
  it('lists eleven positions in pitch order', () => {
    expect(POSITIONS).toEqual(['GK', 'LB', 'CB1', 'CB2', 'RB', 'DM', 'MC', 'AM', 'LWF', 'RWF', 'ST'])
  })

  it('renders both centre-backs as CB', () => {
    expect(positionLabel('CB1')).toBe('CB')
    expect(positionLabel('CB2')).toBe('CB')
  })

  it('leaves other labels untouched', () => {
    expect(positionLabel('GK')).toBe('GK')
    expect(positionLabel('LWF')).toBe('LWF')
  })

  it('arranges the pitch back to front, covering every position exactly once', () => {
    expect(PITCH_ROWS).toEqual([
      ['GK'],
      ['LB', 'CB1', 'CB2', 'RB'],
      ['DM', 'MC', 'AM'],
      ['LWF', 'RWF', 'ST'],
    ])
    expect(PITCH_ROWS.flat().slice().sort()).toEqual(POSITIONS.slice().sort())
  })

  it('has three teams', () => {
    expect(TEAM_KEYS).toEqual(['A', 'B', 'C'])
  })

  it('guards unknown values', () => {
    expect(isPosition('GK')).toBe(true)
    expect(isPosition('SWEEPER')).toBe(false)
    expect(isTeamKey('A')).toBe(true)
    expect(isTeamKey('D')).toBe(false)
  })
})
