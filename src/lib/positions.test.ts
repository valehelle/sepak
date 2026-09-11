import { describe, expect, it } from 'vitest'
import {
  ALL_POSITIONS,
  ALL_POSITIONS_EXCEPT_GK,
  PITCH_ROWS,
  POSITIONS,
  TEAM_KEYS,
  formatPositions,
  isPosition,
  isTeamKey,
  positionLabel,
} from './positions'

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

  it('arranges a 4-2-1-3 attacking upwards, covering every position exactly once', () => {
    expect(PITCH_ROWS).toEqual([
      ['LWF', 'ST', 'RWF'],
      ['AM'],
      ['DM', 'MC'],
      ['LB', 'CB1', 'CB2', 'RB'],
      ['GK'],
    ])
    expect(PITCH_ROWS.flat().slice().sort()).toEqual(POSITIONS.slice().sort())
  })

  it('puts the striker between the wingers, not out wide', () => {
    const front = PITCH_ROWS[0]
    expect(front).toEqual(['LWF', 'ST', 'RWF'])
    expect(front?.indexOf('ST')).toBe(1)
  })

  it('pairs DM with MC as the pivot and leaves AM alone ahead of them', () => {
    const rowOf = (position: string) =>
      PITCH_ROWS.findIndex((row) => (row as readonly string[]).includes(position))

    expect(PITCH_ROWS[rowOf('DM')]).toEqual(['DM', 'MC'])
    expect(PITCH_ROWS[rowOf('AM')]).toEqual(['AM'])
    // Rows run attack-first, so a lower index is further up the pitch: AM must
    // sit ahead of the pivot, and the pivot ahead of the back four.
    expect(rowOf('AM')).toBeLessThan(rowOf('DM'))
    expect(rowOf('DM')).toBeLessThan(rowOf('LB'))
  })

  it('keeps the keeper nearest their own goal and the forwards furthest', () => {
    // Rows run top (attack) to bottom (own goal), so the keeper is last.
    expect(PITCH_ROWS[PITCH_ROWS.length - 1]).toEqual(['GK'])
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

  it('exposes the two waitlist presets', () => {
    expect(ALL_POSITIONS).toEqual(POSITIONS)
    expect(ALL_POSITIONS_EXCEPT_GK).toEqual(['LB', 'CB1', 'CB2', 'RB', 'DM', 'MC', 'AM', 'LWF', 'RWF', 'ST'])
  })

  describe('formatPositions', () => {
    it('collapses all eleven to Semua, regardless of input order', () => {
      expect(formatPositions(POSITIONS)).toBe('Semua')
      expect(formatPositions([...POSITIONS].reverse())).toBe('Semua')
    })

    it('collapses all but GK to the preset name', () => {
      expect(formatPositions(ALL_POSITIONS_EXCEPT_GK)).toBe('Semua kecuali GK')
      expect(formatPositions([...ALL_POSITIONS_EXCEPT_GK].reverse())).toBe('Semua kecuali GK')
    })

    it('does not treat all-but-one-non-GK-position as a preset', () => {
      expect(formatPositions(POSITIONS.filter((p) => p !== 'ST'))).not.toBe('Semua kecuali GK')
    })

    it('lists an arbitrary subset in pitch order regardless of input order', () => {
      expect(formatPositions(['AM', 'MC'])).toBe('MC, AM')
    })

    it('renders a single position as itself', () => {
      expect(formatPositions(['GK'])).toBe('GK')
    })

    it('de-duplicates repeated positions', () => {
      expect(formatPositions(['MC', 'MC', 'AM'])).toBe('MC, AM')
    })
  })
})
