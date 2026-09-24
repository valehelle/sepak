import { describe, expect, it } from 'vitest'
import { POSITIONS, TEAM_KEYS, type TeamKey } from './positions'
import {
  buildWhatsAppMessage,
  describeChange,
  type RosterChange,
  type WhatsAppInput,
  type WhatsAppSlot,
} from './whatsapp'

/** A three-team session, the shape every session had before Team D: no
 *  roster for D means no D slots at all. */
const NAMES: Record<TeamKey, readonly (string | null)[] | undefined> = {
  A: [null, 'kimie', 'amie', 'Zulfadhli', 'haniff mohd', 'Fauzi', 'azim', 'lan', 'yasin', 'Hazmi', 'Zulazhar'],
  B: ['Isaac', 'zairul', 'Amad', 'AA', 'Shah', 'jeeb', 'Kim', 'Syahman', 'Ajim', 'Amir', 'Joe J'],
  C: [null, 'ardee', 'Raze', 'mior', 'mirul', 'Mus', 'Acapsaje', 'Eddy', 'Mat Remy', 'imran', 'Hafiz'],
  D: undefined,
}

function slots(): WhatsAppSlot[] {
  return TEAM_KEYS.flatMap((team) => {
    const roster = NAMES[team]
    if (roster === undefined) return []
    return POSITIONS.map((position, index): WhatsAppSlot => ({ team, position, playerName: roster[index] ?? null }))
  })
}

function input(overrides: Partial<WhatsAppInput> = {}): WhatsAppInput {
  return {
    sessionNo: 5,
    title: 'Geng Turun Peluh',
    playDate: '2026-09-16',
    startTime: '20:00:00',
    venue: 'Padang Presint 8',
    feeMyr: 27,
    feeGkMyr: null,
    teamNames: { A: 'Merah', B: 'Putih', C: 'Kuning', D: 'Hijau' },
    slots: slots(),
    ...overrides,
  }
}

const EXPECTED = `Sesi 005 Geng Turun Peluh
📅 Tarikh : *16/09/2026 (RABU)*
🕒 Masa: 8:00 PM
🏟️ Tempat: Padang Presint 8
💵 Yuran: RM 27/pax

Team Merah
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

Team Putih
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

Team Kuning
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
    expect(free).toContain('🏟️ Tempat: Padang Presint 8\n\nTeam Merah')
  })

  it('leaves an unclaimed slot as a bare dash', () => {
    expect(buildWhatsAppMessage(input())).toContain('\nGK-\n')
  })

  it('trims stray whitespace in names', () => {
    const messy = slots().map((s) => (s.position === 'ST' && s.team === 'A' ? { ...s, playerName: '  Zulazhar  ' } : s))
    expect(buildWhatsAppMessage(input({ slots: messy }))).toContain('ST- Zulazhar')
  })

  it('emits every position of a team even when only some of its slots are recorded', () => {
    const partial = slots().filter((s) => s.team !== 'B' || s.position === 'GK')
    const message = buildWhatsAppMessage(input({ slots: partial }))
    expect(message).toContain('Team Putih\nGK- Isaac\nLB-\nCB-\nCB-\nRB-\nDM-\nMC-\nAM-\nLWF-\nRWF-\nST-')
  })

  it('leaves out a team the session does not have', () => {
    // The three-team fixture: an empty Team D block would read as eleven
    // open places.
    expect(buildWhatsAppMessage(input())).not.toContain('Team Hijau')
  })

  it('adds the fourth team after the third for a four-team session', () => {
    const withD = [
      ...slots(),
      ...POSITIONS.map((position): WhatsAppSlot => ({ team: 'D', position, playerName: position === 'GK' ? 'Baru' : null })),
    ]
    const message = buildWhatsAppMessage(input({ slots: withD }))
    expect(message).toContain('\n\nTeam Hijau\nGK- Baru\nLB-\n')
    expect(message.indexOf('Team Kuning')).toBeLessThan(message.indexOf('Team Hijau'))
  })

  it('names teams by name only, so two teams sharing a bib read apart', () => {
    const four = [
      ...slots(),
      ...POSITIONS.map((position): WhatsAppSlot => ({ team: 'D', position, playerName: null })),
    ]
    const message = buildWhatsAppMessage(
      input({ slots: four, teamNames: { A: 'Merah A', B: 'Merah B', C: 'Kuning A', D: 'Kuning B' } }),
    )
    expect(message).toContain('\n\nTeam Merah A\nGK-')
    expect(message).toContain('\n\nTeam Merah B\nGK- Isaac')
    expect(message).toContain('\n\nTeam Kuning B\nGK-')
    expect(message).not.toMatch(/Team [ABCD] /)
  })

  it('says what a goalkeeper pays when it differs', () => {
    expect(buildWhatsAppMessage(input({ feeGkMyr: 15 }))).toContain('💵 Yuran: RM 27/pax (GK RM 15)')
    expect(buildWhatsAppMessage(input({ feeGkMyr: 27 }))).toContain('💵 Yuran: RM 27/pax\n')
    expect(buildWhatsAppMessage(input({ feeGkMyr: null }))).toContain('💵 Yuran: RM 27/pax\n')
  })

  it('omits the Senarai Tunggu block entirely for an empty waitlist', () => {
    const withEmptyArray = buildWhatsAppMessage(input({ waitlist: [] }))
    const withUndefined = buildWhatsAppMessage(input())
    expect(withEmptyArray).not.toContain('Senarai Tunggu')
    // Byte-identical to the message before the waitlist feature existed.
    expect(withEmptyArray).toBe(EXPECTED)
    expect(withUndefined).toBe(EXPECTED)
  })

  it('appends the Senarai Tunggu block, numbered in order, when non-empty', () => {
    const message = buildWhatsAppMessage(
      input({
        waitlist: [
          { playerName: 'Faiz', positions: ['LB', 'CB1', 'CB2', 'RB', 'DM', 'MC', 'AM', 'LWF', 'RWF', 'ST'] },
          { playerName: 'Nabil', positions: ['MC', 'AM'] },
        ],
      }),
    )
    expect(message.endsWith('\n\nSenarai Tunggu\n1. Faiz (Semua kecuali GK)\n2. Nabil (MC, AM)')).toBe(true)
  })

  describe('the paid tick', () => {
    it('marks a paid name on the right, and leaves the rest alone', () => {
      const paid = slots().map((s) =>
        s.team === 'A' && s.position === 'ST' ? { ...s, paid: true } : s,
      )
      const message = buildWhatsAppMessage(input({ slots: paid }))
      expect(message).toContain('ST- Zulazhar ✅')
      expect(message).toContain('\nRWF- Hazmi\n')
    })

    it('never ticks an empty slot', () => {
      const paid = slots().map((s) =>
        s.team === 'A' && s.position === 'GK' ? { ...s, paid: true } : s,
      )
      // Team A's GK is unclaimed in the fixture, so the line stays a bare dash.
      expect(buildWhatsAppMessage(input({ slots: paid }))).toContain('Team Merah\nGK-\n')
    })

    it('changes nothing when nobody has paid', () => {
      expect(buildWhatsAppMessage(input())).toBe(EXPECTED)
      const explicit = slots().map((s) => ({ ...s, paid: false }))
      expect(buildWhatsAppMessage(input({ slots: explicit }))).toBe(EXPECTED)
    })
  })

  describe('shareUrl', () => {
    it('ends the message with the session link when one is given', () => {
      const message = buildWhatsAppMessage(input({ shareUrl: 'https://valehelle.github.io/sepak/s/abc' }))
      expect(message.endsWith('\n\nhttps://valehelle.github.io/sepak/s/abc')).toBe(true)
    })

    it('changes nothing when no link is given', () => {
      expect(buildWhatsAppMessage(input())).toBe(EXPECTED)
      expect(buildWhatsAppMessage(input({ shareUrl: '' }))).toBe(EXPECTED)
    })
  })

  describe('the change line', () => {
    it('leads the message, because WhatsApp previews the first line only', () => {
      const message = buildWhatsAppMessage(input({ change: '🔴 Team Merah — GK: Amir → kosong' }))
      expect(message.startsWith('🔴 Team Merah — GK: Amir → kosong\n\nSesi 005')).toBe(true)
    })

    it('carries the warning with it, above the link', () => {
      const message = buildWhatsAppMessage(input({
        change: '🔴 Team Merah — GK: Amir → kosong',
        shareUrl: 'https://valehelle.github.io/sepak/s/abc',
      }))
      expect(message.endsWith(
        '\n\n⚠️ Jangan edit senarai ni terus — update kat website, lepas tu copy senarai baru.' +
        '\n\nhttps://valehelle.github.io/sepak/s/abc',
      )).toBe(true)
    })

    it('changes nothing at all when there is no change to announce', () => {
      expect(buildWhatsAppMessage(input())).toBe(EXPECTED)
      expect(buildWhatsAppMessage(input({ change: '' }))).toBe(EXPECTED)
    })
  })

  describe('describeChange', () => {
    const at = { team: 'A' as const, teamName: 'Merah', position: 'GK' as const }

    it('names the position that opened up', () => {
      const change: RosterChange = { kind: 'release', at, playerName: 'Amir', takenBy: null }
      expect(describeChange(change)).toBe('🔴 Team Merah — GK: Amir → kosong')
    })

    it('says so on one line when the queue took it straight away', () => {
      const change: RosterChange = { kind: 'release', at, playerName: 'Amir', takenBy: 'Isaac' }
      expect(describeChange(change)).toBe(
        '🔄 Team Merah — GK: Amir → Isaac (naik dari senarai tunggu)',
      )
    })

    it('reads a position change as one arrow between two places', () => {
      const change: RosterChange = {
        kind: 'move',
        playerName: 'Amir',
        at,
        to: { team: 'C', teamName: 'Kuning', position: 'ST' },
      }
      expect(describeChange(change)).toBe('🔄 Amir: Team Merah GK → Team Kuning ST')
    })

    it('announces a payment without an arrow, since nothing moved', () => {
      const change: RosterChange = { kind: 'paid', at, playerName: 'Amir' }
      expect(describeChange(change)).toBe('✅ Team Merah — GK: Amir dah bayar')
    })

    it('has nothing to announce when a tick is taken back', () => {
      const change: RosterChange = { kind: 'unpaid', at, playerName: 'Amir' }
      expect(describeChange(change)).toBeNull()
    })
  })
})
