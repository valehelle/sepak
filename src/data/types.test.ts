import { describe, expect, it } from 'vitest'
import { RPC_MESSAGES, parseSession, parseSlot, rpcErrorCode } from './types'

const SESSION_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  session_no: 5,
  title: 'Geng Turun Peluh',
  play_date: '2026-09-16',
  start_time: '20:00:00',
  duration_mins: 120,
  venue: 'Padang Presint 8',
  fee_myr: '27.00',
  team_a_name: 'Merah',
  team_b_name: 'Putih',
  team_c_name: 'Kuning',
  team_d_name: 'Kuning',
  fee_gk_myr: null,
  opens_at: '2026-09-01T12:00:00Z',
  status: 'open',
  created_at: '2026-09-10T04:00:00Z',
}

// anon can no longer select claim_token (Task 5 security fix), so a row as it
// actually arrives over the wire never carries that key at all.
const SLOT_ROW = {
  id: '22222222-2222-4222-8222-222222222222',
  session_id: SESSION_ROW.id,
  team: 'A',
  position: 'CB1',
  player_name: 'amie',
  claimed_at: '2026-09-10T05:00:00Z',
  paid: false,
}

describe('parseSession', () => {
  it('narrows a valid row and coerces the numeric fee', () => {
    const session = parseSession(SESSION_ROW)
    expect(session.sessionNo).toBe(5)
    expect(session.feeMyr).toBe(27)
    expect(session.status).toBe('open')
    expect(session.teamNames).toEqual({ A: 'Merah', B: 'Putih', C: 'Kuning', D: 'Kuning' })
    expect(session.feeGkMyr).toBeNull()
    expect(parseSession({ ...SESSION_ROW, fee_gk_myr: '15.00' }).feeGkMyr).toBe(15)
  })

  it('keeps a null fee null rather than coercing it to zero', () => {
    expect(parseSession({ ...SESSION_ROW, fee_myr: null }).feeMyr).toBeNull()
  })

  it('rejects an unknown status', () => {
    expect(() => parseSession({ ...SESSION_ROW, status: 'cancelled' })).toThrow(/status/)
  })

  it('rejects a missing field rather than yielding undefined', () => {
    const { venue: _venue, ...withoutVenue } = SESSION_ROW
    expect(() => parseSession(withoutVenue)).toThrow(/venue/)
  })

  it('rejects a non-object', () => {
    expect(() => parseSession(null)).toThrow()
    expect(() => parseSession('session')).toThrow()
  })
})

describe('parseSlot', () => {
  it('narrows a claimed slot', () => {
    const slot = parseSlot(SLOT_ROW)
    expect(slot.team).toBe('A')
    expect(slot.position).toBe('CB1')
    expect(slot.playerName).toBe('amie')
  })

  it('narrows an empty slot', () => {
    const slot = parseSlot({ ...SLOT_ROW, player_name: null, claimed_at: null })
    expect(slot.playerName).toBeNull()
  })

  it('rejects an unknown team or position', () => {
    expect(() => parseSlot({ ...SLOT_ROW, team: 'E' })).toThrow(/team/)
    expect(() => parseSlot({ ...SLOT_ROW, position: 'SWEEPER' })).toThrow(/position/)
  })
})

describe('rpcErrorCode', () => {
  it('recognises a postgres error surfaced by supabase-js', () => {
    expect(rpcErrorCode({ message: 'slot_taken' })).toBe('slot_taken')
    expect(rpcErrorCode({ message: 'wrong_token' })).toBe('wrong_token')
  })

  it('finds the code inside a wrapped message', () => {
    expect(rpcErrorCode({ message: 'failed to run sql query: session_closed' })).toBe('session_closed')
  })

  it('returns null for anything unrecognised', () => {
    expect(rpcErrorCode({ message: 'network unreachable' })).toBeNull()
    expect(rpcErrorCode(undefined)).toBeNull()
  })

  it('has Malay copy for every code', () => {
    for (const code of ['slot_taken', 'session_closed', 'invalid_name', 'wrong_token', 'slot_empty', 'slot_not_found'] as const) {
      expect(RPC_MESSAGES[code].length).toBeGreaterThan(0)
    }
  })
})
