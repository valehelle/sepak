import { describe, expect, it } from 'vitest'
import { POSITIONS, TEAM_KEYS, type TeamKey } from './positions'
import { buildWhatsAppMessage, type WhatsAppInput, type WhatsAppSlot } from './whatsapp'

const NAMES: Record<TeamKey, readonly (string | null)[]> = {
  A: [null, 'kimie', 'amie', 'Zulfadhli', 'haniff mohd', 'Fauzi', 'azim', 'lan', 'yasin', 'Hazmi', 'Zulazhar'],
  B: ['Isaac', 'zairul', 'Amad', 'AA', 'Shah', 'jeeb', 'Kim', 'Syahman', 'Ajim', 'Amir', 'Joe J'],
  C: [null, 'ardee', 'Raze', 'mior', 'mirul', 'Mus', 'Acapsaje', 'Eddy', 'Mat Remy', 'imran', 'Hafiz'],
}

function slots(): WhatsAppSlot[] {
  return TEAM_KEYS.flatMap((team) =>
    POSITIONS.map((position, index): WhatsAppSlot => {
      const roster = NAMES[team]
      return { team, position, playerName: roster[index] ?? null }
    }),
  )
}

function input(overrides: Partial<WhatsAppInput> = {}): WhatsAppInput {
  return {
    sessionNo: 5,
    title: 'Geng Turun Peluh',
    playDate: '2026-09-16',
    startTime: '20:00:00',
    venue: 'Padang Presint 8',
    feeMyr: 27,
    teamNames: { A: 'Merah', B: 'Putih', C: 'Kuning' },
    slots: slots(),
    ...overrides,
  }
}

const EXPECTED = `Sesi 005 Geng Turun Peluh
📅 Tarikh : *16/09/2026 (RABU)*
🕒 Masa: 8:00 PM
🏟️ Tempat: Padang Presint 8
💵 Yuran: RM 27/pax

Team A Merah
GK-
LB- kimie
CB- amie
CB- Zulfadhli
RB- haniff mohd
DM- Fauzi
MC- azim
AM- lan
LWF- yasin
RWF- Hazmi
ST- Zulazhar

Team B Putih
GK- Isaac
LB- zairul
CB- Amad
CB- AA
RB- Shah
DM- jeeb
MC- Kim
AM- Syahman
LWF- Ajim
RWF- Amir
ST- Joe J

Team C Kuning
GK-
LB- ardee
CB- Raze
CB- mior
RB- mirul
DM- Mus
MC- Acapsaje
AM- Eddy
LWF- Mat Remy
RWF- imran
ST- Hafiz`

describe('buildWhatsAppMessage', () => {
  it('reproduces the group message format', () => {
    expect(buildWhatsAppMessage(input())).toBe(EXPECTED)
  })

  it('pads the session number to three digits', () => {
    expect(buildWhatsAppMessage(input({ sessionNo: 5 }))).toContain('Sesi 005')
    expect(buildWhatsAppMessage(input({ sessionNo: 42 }))).toContain('Sesi 042')
    expect(buildWhatsAppMessage(input({ sessionNo: 137 }))).toContain('Sesi 137')
  })

  it('omits the Yuran line for a free session', () => {
    const free = buildWhatsAppMessage(input({ feeMyr: null }))
    expect(free).not.toContain('Yuran')
    expect(free).toContain('🏟️ Tempat: Padang Presint 8\n\nTeam A Merah')
  })

  it('leaves an unclaimed slot as a bare dash', () => {
    expect(buildWhatsAppMessage(input())).toContain('\nGK-\n')
  })

  it('trims stray whitespace in names', () => {
    const messy = slots().map((s) => (s.position === 'ST' && s.team === 'A' ? { ...s, playerName: '  Zulazhar  ' } : s))
    expect(buildWhatsAppMessage(input({ slots: messy }))).toContain('ST- Zulazhar')
  })

  it('emits every position even when a team has no slots recorded', () => {
    const onlyTeamA = slots().filter((s) => s.team === 'A')
    const message = buildWhatsAppMessage(input({ slots: onlyTeamA }))
    expect(message).toContain('Team B Putih\nGK-\nLB-\nCB-\nCB-\nRB-\nDM-\nMC-\nAM-\nLWF-\nRWF-\nST-')
  })
})
