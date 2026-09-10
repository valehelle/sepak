# Sepak Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mobile-first website where an admin creates football sessions and players tap to claim one of 33 positions across three teams, live-updating as others book.

**Architecture:** A static React SPA talking directly to Supabase — no application server. Postgres holds `sessions` and `slots`; RLS gives anonymous visitors read-only table access, and all player writes go through four `SECURITY DEFINER`/invoker RPCs that row-lock before mutating. Supabase Realtime pushes slot changes to every open page. The built site is static files on GitHub Pages.

**Tech Stack:** Vite 7, React 19, TypeScript 5, Tailwind CSS 4, react-router 7, `@supabase/supabase-js` 2, Vitest 3, Playwright 1, Supabase CLI 2.109, pnpm 10.

**Spec:** `docs/superpowers/specs/2026-09-10-sepak-booking-design.md`

## Global Constraints

- **Package manager is pnpm.** Never `npm` or `npx`; use `pnpm exec` / `pnpm dlx`.
- **No unsafe casts, no implicit `any`.** Parse or type-guard to narrow. A cast needs a comment above it explaining why. `Record<K, T>` always unions `T` with `undefined`.
- **UI language is Malay:** Tarikh, Masa, Tempat, Yuran, Sesi, Pasukan. Position abbreviations stay English (GK, CB, ST).
- **Three teams (`A`, `B`, `C`) of eleven positions.** Fixed. 33 slots per session.
- **Position keys, in pitch order:** `GK, LB, CB1, CB2, RB, DM, MC, AM, LWF, RWF, ST`. `CB1` and `CB2` both display as `CB`.
- **`service_role` key is never committed and never referenced by `src/`.** Tests read local keys from `supabase status -o json` at runtime.
- **Vite `base` is `/sepak/`** (GitHub Pages subpath), overridable via `VITE_BASE`.
- **`fee_myr` is nullable.** Null or `0` means free: the Yuran line is omitted from the page and the WhatsApp text.
- **Malay day names, indexed by `Date.getDay()` (0 = Sunday):** `AHAD, ISNIN, SELASA, RABU, KHAMIS, JUMAAT, SABTU`.
- **Commit after every task.** Conventional commit prefixes (`feat:`, `test:`, `chore:`).

## File Structure

```
sepak/
├── .github/workflows/deploy.yml      GitHub Pages build + publish
├── supabase/
│   ├── config.toml                   local stack config
│   ├── migrations/
│   │   ├── 0001_schema.sql           sessions, slots, constraints, realtime
│   │   ├── 0002_rls.sql              policies + grant revocations
│   │   └── 0003_rpcs.sql             claim/release/move/create_session
│   └── tests/
│       ├── schema_test.sql           constraint assertions
│       └── rls_test.sql              anon-write denial, token checks
├── src/
│   ├── main.tsx                      mount + router
│   ├── App.tsx                       route table
│   ├── index.css                     tailwind entry + design tokens
│   ├── lib/
│   │   ├── positions.ts              position keys, labels, pitch rows
│   │   ├── format.ts                 date/day/time/fee formatting
│   │   ├── whatsapp.ts               WhatsApp message generator
│   │   ├── claimToken.ts             per-device localStorage UUID
│   │   └── supabase.ts               client singleton
│   ├── data/
│   │   ├── types.ts                  Session, Slot, TeamKey, Position, RpcError
│   │   ├── sessions.ts               list/get/create/update/close/delete
│   │   ├── slots.ts                  claim/release/move/clear wrappers
│   │   └── useSessionRealtime.ts     subscription + refetch hook
│   ├── components/
│   │   ├── Toast.tsx                 toast context + host
│   │   ├── Sheet.tsx                 bottom sheet
│   │   ├── SessionMeta.tsx           Tarikh/Masa/Tempat/Yuran header
│   │   ├── SlotChip.tsx              one tappable slot
│   │   ├── PitchTeam.tsx             pitch layout for one team
│   │   └── ListTeam.tsx              list layout for one team
│   └── routes/
│       ├── SessionList.tsx           /
│       ├── SessionPage.tsx           /s/:id
│       └── Admin.tsx                 /admin
├── tests/helpers/localSupabase.ts    reads local keys, seeds fixtures
├── e2e/                              Playwright specs
├── index.html
├── vite.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── tsconfig.json
└── package.json
```

Files are split by responsibility, not layer: pure logic in `lib/` (no Supabase import, trivially testable), all network access in `data/`, presentation in `components/`, composition in `routes/`.

---

### Task 1: Project scaffold that builds for GitHub Pages

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `.env.example`, `scripts/postbuild.mjs`
- Test: `src/lib/__tests__/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm typecheck`. Vite `base` = `VITE_BASE ?? '/sepak/'`. Build emits `dist/404.html` and `dist/.nojekyll`.

- [ ] **Step 1: Write the failing test**

`src/lib/__tests__/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

describe('toolchain', () => {
  it('runs typescript tests', () => {
    const n: number = 1 + 1
    expect(n).toBe(2)
  })
})
```

- [ ] **Step 2: Run it to confirm the harness is absent**

Run: `pnpm test`
Expected: FAIL — `pnpm: command not found: test` or missing `package.json`.

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "sepak",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.18.0",
  "devEngines": {
    "packageManager": { "name": "pnpm", "onFail": "error" }
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build && node scripts/postbuild.mjs",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "db:start": "supabase start",
    "db:reset": "supabase db reset"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.58.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-router": "^7.9.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.0",
    "@testing-library/dom": "^10.4.0",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^5.0.0",
    "jsdom": "^27.0.0",
    "tailwindcss": "^4.1.0",
    "typescript": "^5.9.0",
    "vite": "^7.1.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 4: Create the TypeScript configs**

`tsconfig.json`:

```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]
}
```

`tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src", "tests"]
}
```

`tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["vite.config.ts", "vitest.config.ts", "playwright.config.ts", "scripts/**/*.mjs"]
}
```

`noUncheckedIndexedAccess` is on deliberately: array and record lookups yield `T | undefined`, which is what keeps the position-map code honest without casts.

- [ ] **Step 5: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: process.env.VITE_BASE ?? '/sepak/',
  plugins: [react(), tailwindcss()],
})
```

- [ ] **Step 6: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
})
```

`tests/setup.ts`:

```ts
import '@testing-library/react'
```

- [ ] **Step 7: Create `scripts/postbuild.mjs`**

GitHub Pages serves no rewrite rules, so a deep link such as `/sepak/s/12` would 404 on a direct open or refresh. Copying `index.html` to `404.html` makes Pages serve the SPA shell for unknown paths, and the router then resolves the real route. `.nojekyll` stops Jekyll from discarding files it considers private.

```js
import { copyFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const dist = resolve(import.meta.dirname, '..', 'dist')

await copyFile(resolve(dist, 'index.html'), resolve(dist, '404.html'))
await writeFile(resolve(dist, '.nojekyll'), '')

console.log('postbuild: wrote 404.html and .nojekyll')
```

- [ ] **Step 8: Create the app shell**

`index.html`:

```html
<!doctype html>
<html lang="ms">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0f172a" />
    <title>Sepak</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/index.css`:

```css
@import 'tailwindcss';

@theme {
  --color-pitch: oklch(0.42 0.09 152);
  --color-pitch-line: oklch(0.58 0.06 152);
  --font-sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
}

html {
  -webkit-text-size-adjust: 100%;
}

body {
  @apply bg-slate-950 text-slate-100 font-sans antialiased;
  padding-bottom: env(safe-area-inset-bottom);
}
```

`src/App.tsx`:

```tsx
export default function App() {
  return <main className="p-6 text-lg">Sepak</main>
}
```

`src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 9: Create `.env.example`**

Both values end up in the public bundle, so they are repository *variables*, not secrets.

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=replace-with-local-anon-key
```

- [ ] **Step 10: Install and verify the whole toolchain**

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Expected: tests PASS, typecheck clean, and `dist/404.html` plus `dist/.nojekyll` exist. Confirm with:

```bash
ls -a dist | grep -E '404.html|nojekyll'
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold vite + react + tailwind for github pages"
```

---

### Task 2: Positions and formatting (pure, no I/O)

**Files:**
- Create: `src/lib/positions.ts`, `src/lib/format.ts`
- Test: `src/lib/positions.test.ts`, `src/lib/format.test.ts`
- Delete: `src/lib/__tests__/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Position = 'GK' | 'LB' | 'CB1' | 'CB2' | 'RB' | 'DM' | 'MC' | 'AM' | 'LWF' | 'RWF' | 'ST'`
  - `type TeamKey = 'A' | 'B' | 'C'`
  - `POSITIONS: readonly Position[]` — all eleven in pitch order
  - `TEAM_KEYS: readonly TeamKey[]`
  - `positionLabel(p: Position): string` — `CB1`/`CB2` → `'CB'`
  - `PITCH_ROWS: readonly (readonly Position[])[]` — four rows, back to front
  - `isPosition(v: string): v is Position`, `isTeamKey(v: string): v is TeamKey`
  - `formatPlayDate(iso: string): string` — `'2026-09-16'` → `'16/09/2026 (RABU)'`
  - `formatStartTime(t: string): string` — `'20:00:00'` → `'8:00 PM'`
  - `formatFee(fee: number | null): string | null` — `27` → `'RM 27/pax'`, `27.5` → `'RM 27.50/pax'`, `0`/`null` → `null`

- [ ] **Step 1: Write the failing tests**

`src/lib/positions.test.ts`:

```ts
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
```

`src/lib/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatFee, formatPlayDate, formatStartTime } from './format'

describe('formatPlayDate', () => {
  it('formats with the Malay day name', () => {
    expect(formatPlayDate('2026-09-16')).toBe('16/09/2026 (RABU)')
  })

  it('covers the whole week', () => {
    expect(formatPlayDate('2026-09-13')).toBe('13/09/2026 (AHAD)')
    expect(formatPlayDate('2026-09-14')).toBe('14/09/2026 (ISNIN)')
    expect(formatPlayDate('2026-09-15')).toBe('15/09/2026 (SELASA)')
    expect(formatPlayDate('2026-09-17')).toBe('17/09/2026 (KHAMIS)')
    expect(formatPlayDate('2026-09-18')).toBe('18/09/2026 (JUMAAT)')
    expect(formatPlayDate('2026-09-19')).toBe('19/09/2026 (SABTU)')
  })

  it('pads single-digit days and months', () => {
    expect(formatPlayDate('2026-01-05')).toBe('05/01/2026 (ISNIN)')
  })

  it('does not shift the date across timezones', () => {
    // Parsed as calendar parts, never as UTC — a naive `new Date('2026-09-16')`
    // is midnight UTC and reads as the 15th west of Greenwich.
    expect(formatPlayDate('2026-09-16')).toContain('16/09/2026')
  })
})

describe('formatStartTime', () => {
  it('converts 24h to 12h with meridiem', () => {
    expect(formatStartTime('20:00:00')).toBe('8:00 PM')
    expect(formatStartTime('08:30:00')).toBe('8:30 AM')
  })

  it('handles both midnight and noon', () => {
    expect(formatStartTime('00:00:00')).toBe('12:00 AM')
    expect(formatStartTime('12:00:00')).toBe('12:00 PM')
  })

  it('accepts times without seconds', () => {
    expect(formatStartTime('21:45')).toBe('9:45 PM')
  })
})

describe('formatFee', () => {
  it('drops a redundant decimal', () => {
    expect(formatFee(27)).toBe('RM 27/pax')
  })

  it('keeps real sen', () => {
    expect(formatFee(27.5)).toBe('RM 27.50/pax')
  })

  it('treats zero and null as free', () => {
    expect(formatFee(0)).toBeNull()
    expect(formatFee(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — cannot resolve `./positions` and `./format`.

- [ ] **Step 3: Implement `src/lib/positions.ts`**

```ts
export const POSITIONS = [
  'GK',
  'LB',
  'CB1',
  'CB2',
  'RB',
  'DM',
  'MC',
  'AM',
  'LWF',
  'RWF',
  'ST',
] as const

export type Position = (typeof POSITIONS)[number]

export const TEAM_KEYS = ['A', 'B', 'C'] as const

export type TeamKey = (typeof TEAM_KEYS)[number]

/** Two centre-backs share a display label; the keys differ so the
 *  (session, team, position) unique constraint can tell them apart. */
export function positionLabel(position: Position): string {
  return position === 'CB1' || position === 'CB2' ? 'CB' : position
}

/** Back to front, so the rendered pitch matches where players stand. */
export const PITCH_ROWS = [
  ['GK'],
  ['LB', 'CB1', 'CB2', 'RB'],
  ['DM', 'MC', 'AM'],
  ['LWF', 'RWF', 'ST'],
] as const satisfies readonly (readonly Position[])[]

export function isPosition(value: string): value is Position {
  return (POSITIONS as readonly string[]).includes(value)
}

export function isTeamKey(value: string): value is TeamKey {
  return (TEAM_KEYS as readonly string[]).includes(value)
}
```

- [ ] **Step 4: Implement `src/lib/format.ts`**

```ts
const DAY_NAMES = ['AHAD', 'ISNIN', 'SELASA', 'RABU', 'KHAMIS', 'JUMAAT', 'SABTU'] as const

/** Splits the ISO date into calendar parts rather than using `new Date(iso)`,
 *  which parses date-only strings as midnight UTC and lands on the previous
 *  day for anyone west of Greenwich. */
export function formatPlayDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`invalid date: ${iso}`)
  }

  const dayName = DAY_NAMES[new Date(year, month - 1, day).getDay()]
  if (dayName === undefined) throw new Error(`invalid date: ${iso}`)

  const dd = String(day).padStart(2, '0')
  const mm = String(month).padStart(2, '0')
  return `${dd}/${mm}/${year} (${dayName})`
}

export function formatStartTime(time: string): string {
  const [rawHour, rawMinute] = time.split(':')
  const hour = Number(rawHour)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`invalid time: ${time}`)
  }

  const minute = (rawMinute ?? '00').padStart(2, '0')
  const meridiem = hour < 12 ? 'AM' : 'PM'
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return `${hour12}:${minute} ${meridiem}`
}

/** Null when there is nothing to collect, so callers can omit the line entirely. */
export function formatFee(fee: number | null): string | null {
  if (fee === null || fee === 0) return null
  const amount = Number.isInteger(fee) ? String(fee) : fee.toFixed(2)
  return `RM ${amount}/pax`
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: both PASS.

- [ ] **Step 6: Remove the scaffold smoke test**

```bash
rm -rf src/lib/__tests__
pnpm test
```

Expected: PASS, with only the positions and format suites running.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add position map and Malay date/time/fee formatting"
```

---

### Task 3: WhatsApp message generator

The bridge to how the group already works: it regenerates the exact message the organiser posts today. The snapshot below is the real message from the spec, and 16/09/2026 genuinely is a Wednesday, so this asserts byte-for-byte against production copy.

**Files:**
- Create: `src/lib/whatsapp.ts`
- Test: `src/lib/whatsapp.test.ts`

**Interfaces:**
- Consumes: `Position`, `TeamKey`, `POSITIONS`, `TEAM_KEYS`, `positionLabel` from `src/lib/positions.ts`; `formatPlayDate`, `formatStartTime`, `formatFee` from `src/lib/format.ts`.
- Produces: `buildWhatsAppMessage(input: WhatsAppInput): string` and the exported `WhatsAppInput` / `WhatsAppSlot` types.

```ts
export type WhatsAppSlot = { team: TeamKey; position: Position; playerName: string | null }
export type WhatsAppInput = {
  sessionNo: number
  title: string
  playDate: string   // ISO 'YYYY-MM-DD'
  startTime: string  // 'HH:MM:SS'
  venue: string
  feeMyr: number | null
  teamNames: Record<TeamKey, string>
  slots: readonly WhatsAppSlot[]
}
```

- [ ] **Step 1: Write the failing test**

`src/lib/whatsapp.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { POSITIONS, TEAM_KEYS, type Position, type TeamKey } from './positions'
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/whatsapp.test.ts`
Expected: FAIL — cannot resolve `./whatsapp`.

- [ ] **Step 3: Implement `src/lib/whatsapp.ts`**

```ts
import { formatFee, formatPlayDate, formatStartTime } from './format'
import { POSITIONS, TEAM_KEYS, positionLabel, type Position, type TeamKey } from './positions'

export type WhatsAppSlot = {
  team: TeamKey
  position: Position
  playerName: string | null
}

export type WhatsAppInput = {
  sessionNo: number
  title: string
  playDate: string
  startTime: string
  venue: string
  feeMyr: number | null
  teamNames: Record<TeamKey, string>
  slots: readonly WhatsAppSlot[]
}

type Roster = Map<string, string | null>

const key = (team: TeamKey, position: Position): string => `${team}:${position}`

function rosterOf(slots: readonly WhatsAppSlot[]): Roster {
  const roster: Roster = new Map()
  for (const slot of slots) {
    roster.set(key(slot.team, slot.position), slot.playerName?.trim() ?? null)
  }
  return roster
}

function teamBlock(team: TeamKey, teamName: string, roster: Roster): string {
  const lines = POSITIONS.map((position) => {
    const name = roster.get(key(team, position))
    const label = positionLabel(position)
    return name ? `${label}- ${name}` : `${label}-`
  })
  return [`Team ${team} ${teamName}`, ...lines].join('\n')
}

/** Regenerates the organiser's existing WhatsApp message so the site
 *  complements the group rather than competing with it. */
export function buildWhatsAppMessage(input: WhatsAppInput): string {
  const roster = rosterOf(input.slots)
  const fee = formatFee(input.feeMyr)

  const header = [
    `Sesi ${String(input.sessionNo).padStart(3, '0')} ${input.title}`,
    `📅 Tarikh : *${formatPlayDate(input.playDate)}*`,
    `🕒 Masa: ${formatStartTime(input.startTime)}`,
    `🏟️ Tempat: ${input.venue}`,
    ...(fee === null ? [] : [`💵 Yuran: ${fee}`]),
  ].join('\n')

  const teams = TEAM_KEYS.map((team) => teamBlock(team, input.teamNames[team], roster))

  return [header, ...teams].join('\n\n')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test && pnpm typecheck`
Expected: both PASS. The `EXPECTED` snapshot matching proves the generator reproduces real group copy.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: generate the group's WhatsApp session message"
```

---

### Task 4: Database schema

**Files:**
- Create: `supabase/config.toml` (via `supabase init`), `supabase/migrations/0001_schema.sql`
- Test: `supabase/tests/schema_test.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `public.sessions` and `public.slots` with the columns from the spec, a `slots_claim_complete` check constraint, `unique (session_id, team, position)`, and `public.slots` added to the `supabase_realtime` publication.

- [ ] **Step 1: Initialise the local Supabase project**

```bash
supabase init
supabase start
```

Expected: containers boot and `supabase status` prints an API URL of `http://127.0.0.1:54321`. Record the anon key into `.env.local` (git-ignored):

```bash
printf 'VITE_SUPABASE_URL=%s\nVITE_SUPABASE_ANON_KEY=%s\n' \
  "$(supabase status -o json | jq -r .API_URL)" \
  "$(supabase status -o json | jq -r .ANON_KEY)" > .env.local
```

- [ ] **Step 2: Write the failing schema test**

`supabase/tests/schema_test.sql`. Plain SQL assertions in a `do` block — no pgTAP dependency, and any failed assertion aborts with a non-zero exit.

```sql
\set ON_ERROR_STOP on

do $$
declare
  v_session_id uuid;
  v_slot_id uuid;
begin
  insert into public.sessions (session_no, title, play_date, start_time, venue, fee_myr)
  values (1, 'Test', '2026-09-16', '20:00:00', 'Padang Test', 27)
  returning id into v_session_id;

  -- defaults land as specified
  assert (select duration_mins from public.sessions where id = v_session_id) = 120,
    'duration_mins should default to 120';
  assert (select status from public.sessions where id = v_session_id) = 'open',
    'status should default to open';
  assert (select team_a_name from public.sessions where id = v_session_id) = 'Merah',
    'team_a_name should default to Merah';
  assert (select team_b_name from public.sessions where id = v_session_id) = 'Putih',
    'team_b_name should default to Putih';
  assert (select team_c_name from public.sessions where id = v_session_id) = 'Kuning',
    'team_c_name should default to Kuning';

  insert into public.slots (session_id, team, position)
  values (v_session_id, 'A', 'GK') returning id into v_slot_id;

  -- a slot is never half-claimed
  begin
    update public.slots set player_name = 'Hazmi' where id = v_slot_id;
    raise exception 'expected slots_claim_complete to reject a name without a token';
  exception
    when check_violation then null;
  end;

  -- all three claim columns together is valid
  update public.slots
     set player_name = 'Hazmi', claim_token = gen_random_uuid(), claimed_at = now()
   where id = v_slot_id;
  assert (select player_name from public.slots where id = v_slot_id) = 'Hazmi',
    'a complete claim should be accepted';

  -- one player per position per team per session
  begin
    insert into public.slots (session_id, team, position) values (v_session_id, 'A', 'GK');
    raise exception 'expected the (session, team, position) unique constraint to fire';
  exception
    when unique_violation then null;
  end;

  -- CB1 and CB2 are distinct keys, so two centre-backs coexist
  insert into public.slots (session_id, team, position)
  values (v_session_id, 'A', 'CB1'), (v_session_id, 'A', 'CB2');
  assert (select count(*) from public.slots where session_id = v_session_id and team = 'A') = 3,
    'CB1 and CB2 should both be storable';

  -- team and position are constrained to known values
  begin
    insert into public.slots (session_id, team, position) values (v_session_id, 'D', 'GK');
    raise exception 'expected the team check constraint to fire';
  exception
    when check_violation then null;
  end;
  begin
    insert into public.slots (session_id, team, position) values (v_session_id, 'A', 'SWEEPER');
    raise exception 'expected the position check constraint to fire';
  exception
    when check_violation then null;
  end;

  -- deleting a session takes its slots with it
  delete from public.sessions where id = v_session_id;
  assert (select count(*) from public.slots where session_id = v_session_id) = 0,
    'slots should cascade on session delete';

  raise notice 'schema_test: all assertions passed';
end $$;
```

- [ ] **Step 3: Run it to verify it fails**

```bash
psql "$(supabase status -o json | jq -r .DB_URL)" -f supabase/tests/schema_test.sql
```

Expected: FAIL — `relation "public.sessions" does not exist`.

- [ ] **Step 4: Write the migration**

`supabase/migrations/0001_schema.sql`:

```sql
create table public.sessions (
  id            uuid primary key default gen_random_uuid(),
  session_no    int  not null,
  title         text not null,
  play_date     date not null,
  start_time    time not null,
  duration_mins int  not null default 120 check (duration_mins between 15 and 480),
  venue         text not null,
  fee_myr       numeric(6,2) check (fee_myr is null or fee_myr >= 0),
  team_a_name   text not null default 'Merah',
  team_b_name   text not null default 'Putih',
  team_c_name   text not null default 'Kuning',
  status        text not null default 'open' check (status in ('open', 'closed')),
  created_at    timestamptz not null default now(),
  constraint sessions_title_not_blank check (btrim(title) <> ''),
  constraint sessions_venue_not_blank check (btrim(venue) <> '')
);

comment on column public.sessions.fee_myr is
  'Null or 0 means free; the Yuran line is then omitted from the UI and WhatsApp text.';

create table public.slots (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.sessions (id) on delete cascade,
  team         text not null check (team in ('A', 'B', 'C')),
  position     text not null check (position in
                 ('GK','LB','CB1','CB2','RB','DM','MC','AM','LWF','RWF','ST')),
  player_name  text,
  claim_token  uuid,
  claimed_at   timestamptz,
  constraint slots_unique_position unique (session_id, team, position),
  constraint slots_name_length check (player_name is null or char_length(btrim(player_name)) between 1 and 40),
  -- A slot is either fully empty or fully claimed, never half-claimed.
  constraint slots_claim_complete check (
    (player_name is null and claim_token is null and claimed_at is null) or
    (player_name is not null and claim_token is not null and claimed_at is not null)
  )
);

comment on column public.slots.position is
  'CB1 and CB2 are distinct keys so the unique constraint can hold two centre-backs; both display as CB.';
comment on column public.slots.claim_token is
  'The claiming device''s localStorage UUID. Presenting it is what authorises release or move.';

create index slots_session_idx on public.slots (session_id);
create index sessions_play_date_idx on public.sessions (play_date desc);

-- Realtime pushes slot changes to every open session page.
alter publication supabase_realtime add table public.slots;
```

- [ ] **Step 5: Apply the migration and run the test to verify it passes**

```bash
supabase db reset
psql "$(supabase status -o json | jq -r .DB_URL)" -f supabase/tests/schema_test.sql
```

Expected: `NOTICE: schema_test: all assertions passed`, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add sessions and slots schema with claim-completeness constraint"
```

---

### Task 5: RLS policies and the four RPCs

This is the security boundary. Anonymous visitors get read-only table access and may execute exactly three functions; every player mutation row-locks before it decides, which is what makes two simultaneous taps resolve to one winner instead of a lost update.

**Files:**
- Create: `supabase/migrations/0002_rls.sql`, `supabase/migrations/0003_rpcs.sql`
- Test: `supabase/tests/rls_test.sql`

**Interfaces:**
- Consumes: `public.sessions`, `public.slots` from Task 4.
- Produces:
  - `claim_slot(p_slot_id uuid, p_name text, p_token uuid) returns public.slots` — raises `slot_taken`, `session_closed`, `invalid_name`, `slot_not_found`
  - `release_slot(p_slot_id uuid, p_token uuid) returns public.slots` — raises `wrong_token`, `slot_empty`, `session_closed`, `slot_not_found`
  - `move_slot(p_from uuid, p_to uuid, p_token uuid) returns public.slots` — raises `slot_taken`, `wrong_token`, `slot_empty`, `session_closed`, `cross_session`, `same_slot`
  - `create_session(p_session_no int, p_title text, p_play_date date, p_start_time time, p_duration_mins int, p_venue text, p_fee_myr numeric, p_team_a_name text, p_team_b_name text, p_team_c_name text) returns public.sessions` — inserts the session and all 33 slots in one transaction; `authenticated` only

- [ ] **Step 1: Write the failing RLS and RPC test**

`supabase/tests/rls_test.sql`:

```sql
\set ON_ERROR_STOP on

do $$
declare
  v_session_id uuid;
  v_gk uuid;
  v_st uuid;
  v_other_session uuid;
  v_other_gk uuid;
  v_token uuid := gen_random_uuid();
  v_intruder uuid := gen_random_uuid();
  v_count int;
begin
  -- create_session builds a whole session in one shot
  set local role authenticated;
  select id into v_session_id from public.create_session(
    1, 'Geng Turun Peluh', '2026-09-16', '20:00:00', 120, 'Padang Presint 8', 27,
    'Merah', 'Putih', 'Kuning');

  select count(*) into v_count from public.slots where session_id = v_session_id;
  assert v_count = 33, format('expected 33 slots, got %s', v_count);
  assert (select count(distinct team) from public.slots where session_id = v_session_id) = 3,
    'expected three teams';
  assert (select count(*) from public.slots where session_id = v_session_id and team = 'A') = 11,
    'expected eleven positions per team';

  select id into v_gk from public.slots where session_id = v_session_id and team = 'A' and position = 'GK';
  select id into v_st from public.slots where session_id = v_session_id and team = 'A' and position = 'ST';
  reset role;

  ---------------------------------------------------------------------------
  -- anon has no direct write access to either table
  ---------------------------------------------------------------------------
  set local role anon;

  assert (select count(*) from public.sessions) >= 1, 'anon should be able to read sessions';
  assert (select count(*) from public.slots) >= 33, 'anon should be able to read slots';

  begin
    insert into public.sessions (session_no, title, play_date, start_time, venue)
    values (99, 'Rogue', '2026-09-20', '20:00:00', 'Nowhere');
    raise exception 'anon must not insert sessions';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.slots set player_name = 'Rogue', claim_token = gen_random_uuid(), claimed_at = now()
    where id = v_gk;
    raise exception 'anon must not update slots directly';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.slots where id = v_gk;
    raise exception 'anon must not delete slots';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.create_session(2, 'Rogue', '2026-09-20', '20:00:00', 120, 'Nowhere', 10,
      'Merah', 'Putih', 'Kuning');
    raise exception 'anon must not create sessions';
  exception when insufficient_privilege then null;
  end;

  ---------------------------------------------------------------------------
  -- claim_slot
  ---------------------------------------------------------------------------
  perform public.claim_slot(v_gk, 'Hazmi', v_token);
  assert (select player_name from public.slots where id = v_gk) = 'Hazmi', 'claim should set the name';
  assert (select claim_token from public.slots where id = v_gk) = v_token, 'claim should store the token';

  begin
    perform public.claim_slot(v_gk, 'Intruder', v_intruder);
    raise exception 'claiming an occupied slot must fail';
  exception when others then
    assert sqlerrm = 'slot_taken', format('expected slot_taken, got %s', sqlerrm);
  end;

  begin
    perform public.claim_slot(v_st, '   ', v_token);
    raise exception 'a blank name must be rejected';
  exception when others then
    assert sqlerrm = 'invalid_name', format('expected invalid_name, got %s', sqlerrm);
  end;

  begin
    perform public.claim_slot(v_st, repeat('x', 41), v_token);
    raise exception 'an over-long name must be rejected';
  exception when others then
    assert sqlerrm = 'invalid_name', format('expected invalid_name, got %s', sqlerrm);
  end;

  begin
    perform public.claim_slot(gen_random_uuid(), 'Ghost', v_token);
    raise exception 'claiming a nonexistent slot must fail';
  exception when others then
    assert sqlerrm = 'slot_not_found', format('expected slot_not_found, got %s', sqlerrm);
  end;

  -- names are trimmed on the way in
  perform public.claim_slot(v_st, '  Zulazhar  ', v_token);
  assert (select player_name from public.slots where id = v_st) = 'Zulazhar', 'claim should trim the name';

  ---------------------------------------------------------------------------
  -- release_slot: the token is the authorisation
  ---------------------------------------------------------------------------
  begin
    perform public.release_slot(v_gk, v_intruder);
    raise exception 'releasing another device''s slot must fail';
  exception when others then
    assert sqlerrm = 'wrong_token', format('expected wrong_token, got %s', sqlerrm);
  end;
  assert (select player_name from public.slots where id = v_gk) = 'Hazmi',
    'a rejected release must leave the slot untouched';

  perform public.release_slot(v_gk, v_token);
  assert (select player_name from public.slots where id = v_gk) is null, 'release should empty the slot';
  assert (select claim_token from public.slots where id = v_gk) is null, 'release should clear the token';

  begin
    perform public.release_slot(v_gk, v_token);
    raise exception 'releasing an empty slot must fail';
  exception when others then
    assert sqlerrm = 'slot_empty', format('expected slot_empty, got %s', sqlerrm);
  end;

  ---------------------------------------------------------------------------
  -- move_slot
  ---------------------------------------------------------------------------
  perform public.move_slot(v_st, v_gk, v_token);
  assert (select player_name from public.slots where id = v_gk) = 'Zulazhar', 'move should fill the target';
  assert (select player_name from public.slots where id = v_st) is null, 'move should empty the source';

  begin
    perform public.move_slot(v_gk, v_gk, v_token);
    raise exception 'moving onto the same slot must fail';
  exception when others then
    assert sqlerrm = 'same_slot', format('expected same_slot, got %s', sqlerrm);
  end;

  begin
    perform public.move_slot(v_gk, v_st, v_intruder);
    raise exception 'moving with the wrong token must fail';
  exception when others then
    assert sqlerrm = 'wrong_token', format('expected wrong_token, got %s', sqlerrm);
  end;

  -- moving across sessions is refused
  reset role;
  set local role authenticated;
  select id into v_other_session from public.create_session(
    2, 'Lain', '2026-09-23', '20:00:00', 120, 'Padang Lain', 27, 'Merah', 'Putih', 'Kuning');
  select id into v_other_gk from public.slots
   where session_id = v_other_session and team = 'A' and position = 'GK';
  reset role;
  set local role anon;

  begin
    perform public.move_slot(v_gk, v_other_gk, v_token);
    raise exception 'moving across sessions must fail';
  exception when others then
    assert sqlerrm = 'cross_session', format('expected cross_session, got %s', sqlerrm);
  end;

  ---------------------------------------------------------------------------
  -- a closed session rejects every mutation
  ---------------------------------------------------------------------------
  reset role;
  update public.sessions set status = 'closed' where id = v_session_id;
  set local role anon;

  begin
    perform public.claim_slot(v_st, 'Latecomer', v_intruder);
    raise exception 'claiming in a closed session must fail';
  exception when others then
    assert sqlerrm = 'session_closed', format('expected session_closed, got %s', sqlerrm);
  end;

  begin
    perform public.release_slot(v_gk, v_token);
    raise exception 'releasing in a closed session must fail';
  exception when others then
    assert sqlerrm = 'session_closed', format('expected session_closed, got %s', sqlerrm);
  end;

  reset role;
  raise notice 'rls_test: all assertions passed';
end $$;
```

- [ ] **Step 2: Run it to verify it fails**

```bash
psql "$(supabase status -o json | jq -r .DB_URL)" -f supabase/tests/rls_test.sql
```

Expected: FAIL — `function public.create_session(...) does not exist`.

- [ ] **Step 3: Write the RLS migration**

`supabase/migrations/0002_rls.sql`:

```sql
alter table public.sessions enable row level security;
alter table public.slots    enable row level security;

-- Everyone may read: the booking list is public by design.
create policy sessions_read on public.sessions
  for select to anon, authenticated using (true);

create policy slots_read on public.slots
  for select to anon, authenticated using (true);

-- Only the organiser writes tables directly.
create policy sessions_write on public.sessions
  for all to authenticated using (true) with check (true);

create policy slots_write on public.slots
  for all to authenticated using (true) with check (true);

-- Belt and braces: Supabase grants anon table-level DML by default, and RLS
-- would already block it for want of a policy. Revoking makes the denial a
-- privilege error rather than a silent zero-row update, which is both clearer
-- to debug and what the tests assert.
revoke insert, update, delete on public.sessions from anon;
revoke insert, update, delete on public.slots    from anon;
```

- [ ] **Step 4: Write the RPC migration**

`supabase/migrations/0003_rpcs.sql`. Note `create_session` is **security invoker** — RLS rejects `anon` automatically, so there is no privilege-escalation path to get wrong. The three player functions are `security definer` because they must write tables `anon` cannot, and each one re-derives everything it needs from the row it locked rather than trusting an argument.

```sql
---------------------------------------------------------------------------
-- claim_slot
---------------------------------------------------------------------------
create or replace function public.claim_slot(p_slot_id uuid, p_name text, p_token uuid)
returns public.slots
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slot   public.slots;
  v_status text;
  v_name   text := btrim(coalesce(p_name, ''));
begin
  if v_name = '' or char_length(v_name) > 40 then
    raise exception 'invalid_name';
  end if;
  if p_token is null then
    raise exception 'invalid_token';
  end if;

  -- The lock is what serialises two simultaneous taps on one slot.
  select * into v_slot from public.slots where id = p_slot_id for update;
  if not found then
    raise exception 'slot_not_found';
  end if;

  select status into v_status from public.sessions where id = v_slot.session_id;
  if v_status is distinct from 'open' then
    raise exception 'session_closed';
  end if;

  if v_slot.player_name is not null then
    raise exception 'slot_taken';
  end if;

  update public.slots
     set player_name = v_name, claim_token = p_token, claimed_at = now()
   where id = p_slot_id
  returning * into v_slot;

  return v_slot;
end;
$$;

---------------------------------------------------------------------------
-- release_slot
---------------------------------------------------------------------------
create or replace function public.release_slot(p_slot_id uuid, p_token uuid)
returns public.slots
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slot   public.slots;
  v_status text;
begin
  select * into v_slot from public.slots where id = p_slot_id for update;
  if not found then
    raise exception 'slot_not_found';
  end if;

  select status into v_status from public.sessions where id = v_slot.session_id;
  if v_status is distinct from 'open' then
    raise exception 'session_closed';
  end if;

  if v_slot.player_name is null then
    raise exception 'slot_empty';
  end if;

  -- Holding the token is the whole authorisation story for a player.
  if v_slot.claim_token is distinct from p_token then
    raise exception 'wrong_token';
  end if;

  update public.slots
     set player_name = null, claim_token = null, claimed_at = null
   where id = p_slot_id
  returning * into v_slot;

  return v_slot;
end;
$$;

---------------------------------------------------------------------------
-- move_slot
---------------------------------------------------------------------------
create or replace function public.move_slot(p_from uuid, p_to uuid, p_token uuid)
returns public.slots
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from   public.slots;
  v_to     public.slots;
  v_status text;
  v_name   text;
begin
  if p_from = p_to then
    raise exception 'same_slot';
  end if;

  -- Lock both rows in a deterministic order so two opposing moves cannot deadlock.
  perform 1 from public.slots where id in (p_from, p_to) order by id for update;

  select * into v_from from public.slots where id = p_from;
  if not found then raise exception 'slot_not_found'; end if;
  select * into v_to from public.slots where id = p_to;
  if not found then raise exception 'slot_not_found'; end if;

  if v_from.session_id <> v_to.session_id then
    raise exception 'cross_session';
  end if;

  select status into v_status from public.sessions where id = v_from.session_id;
  if v_status is distinct from 'open' then
    raise exception 'session_closed';
  end if;

  if v_from.player_name is null then raise exception 'slot_empty'; end if;
  if v_from.claim_token is distinct from p_token then raise exception 'wrong_token'; end if;
  if v_to.player_name is not null then raise exception 'slot_taken'; end if;

  v_name := v_from.player_name;

  update public.slots
     set player_name = null, claim_token = null, claimed_at = null
   where id = p_from;

  update public.slots
     set player_name = v_name, claim_token = p_token, claimed_at = now()
   where id = p_to
  returning * into v_to;

  return v_to;
end;
$$;

---------------------------------------------------------------------------
-- create_session (organiser only; security invoker, so RLS does the gating)
---------------------------------------------------------------------------
create or replace function public.create_session(
  p_session_no    int,
  p_title         text,
  p_play_date     date,
  p_start_time    time,
  p_duration_mins int,
  p_venue         text,
  p_fee_myr       numeric,
  p_team_a_name   text,
  p_team_b_name   text,
  p_team_c_name   text
)
returns public.sessions
language plpgsql
as $$
declare
  v_session public.sessions;
begin
  insert into public.sessions (
    session_no, title, play_date, start_time, duration_mins,
    venue, fee_myr, team_a_name, team_b_name, team_c_name
  ) values (
    p_session_no, btrim(p_title), p_play_date, p_start_time, coalesce(p_duration_mins, 120),
    btrim(p_venue), p_fee_myr,
    coalesce(nullif(btrim(p_team_a_name), ''), 'Merah'),
    coalesce(nullif(btrim(p_team_b_name), ''), 'Putih'),
    coalesce(nullif(btrim(p_team_c_name), ''), 'Kuning')
  )
  returning * into v_session;

  -- All 33 slots in the same transaction: a session is never half-built.
  insert into public.slots (session_id, team, position)
  select v_session.id, t.team, p.position
    from (values ('A'), ('B'), ('C')) as t(team)
   cross join (values ('GK'),('LB'),('CB1'),('CB2'),('RB'),('DM'),
                     ('MC'),('AM'),('LWF'),('RWF'),('ST')) as p(position);

  return v_session;
end;
$$;

---------------------------------------------------------------------------
-- Execute grants. Functions are executable by PUBLIC by default, so each
-- one is revoked first and then granted deliberately.
---------------------------------------------------------------------------
revoke all on function public.claim_slot(uuid, text, uuid)   from public;
revoke all on function public.release_slot(uuid, uuid)        from public;
revoke all on function public.move_slot(uuid, uuid, uuid)     from public;
revoke all on function public.create_session(int, text, date, time, int, text, numeric, text, text, text) from public;

grant execute on function public.claim_slot(uuid, text, uuid)  to anon, authenticated;
grant execute on function public.release_slot(uuid, uuid)      to anon, authenticated;
grant execute on function public.move_slot(uuid, uuid, uuid)   to anon, authenticated;
grant execute on function public.create_session(int, text, date, time, int, text, numeric, text, text, text) to authenticated;
```

- [ ] **Step 5: Apply and run the test to verify it passes**

```bash
supabase db reset
psql "$(supabase status -o json | jq -r .DB_URL)" -f supabase/tests/schema_test.sql
psql "$(supabase status -o json | jq -r .DB_URL)" -f supabase/tests/rls_test.sql
```

Expected: both print `all assertions passed` and exit 0.

- [ ] **Step 6: Add a script that runs the SQL suite**

Add to `package.json` scripts:

```json
"test:db": "psql \"$(supabase status -o json | jq -r .DB_URL)\" -f supabase/tests/schema_test.sql -f supabase/tests/rls_test.sql"
```

Run: `pnpm test:db`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add RLS policies and row-locking claim/release/move RPCs"
```

---

### Task 6: Supabase client, domain types, and the claim token

**Files:**
- Create: `src/lib/supabase.ts`, `src/lib/claimToken.ts`, `src/data/types.ts`
- Test: `src/lib/claimToken.test.ts`, `src/data/types.test.ts`

**Interfaces:**
- Consumes: `Position`, `TeamKey`, `isPosition`, `isTeamKey` from `src/lib/positions.ts`.
- Produces:
  - `supabase: SupabaseClient` — configured from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
  - `getClaimToken(): string` — per-device UUID, created on first call, persisted in `localStorage` under `sepak.claimToken`
  - `type Session`, `type Slot`, `type SessionWithSlots`
  - `parseSession(row: unknown): Session`, `parseSlot(row: unknown): Slot` — runtime narrowing, no casts
  - `type RpcErrorCode`, `rpcErrorCode(error: unknown): RpcErrorCode | null`, `RPC_MESSAGES: Record<RpcErrorCode, string>` (Malay copy)

- [ ] **Step 1: Write the failing tests**

`src/lib/claimToken.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CLAIM_TOKEN_KEY, getClaimToken } from './claimToken'

describe('getClaimToken', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('creates and persists a token on first call', () => {
    const token = getClaimToken()
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(localStorage.getItem(CLAIM_TOKEN_KEY)).toBe(token)
  })

  it('returns the same token on later calls', () => {
    expect(getClaimToken()).toBe(getClaimToken())
  })

  it('replaces a corrupted stored value', () => {
    localStorage.setItem(CLAIM_TOKEN_KEY, 'not-a-uuid')
    const token = getClaimToken()
    expect(token).not.toBe('not-a-uuid')
    expect(localStorage.getItem(CLAIM_TOKEN_KEY)).toBe(token)
  })

  it('still returns a usable token when storage throws', () => {
    // Private browsing and blocked site data make localStorage itself throw.
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      clear: () => {},
      removeItem: () => {},
      key: () => null,
      length: 0,
    })
    expect(getClaimToken()).toMatch(/^[0-9a-f-]{36}$/i)
  })
})
```

`src/data/types.test.ts`:

```ts
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
  status: 'open',
  created_at: '2026-09-10T04:00:00Z',
}

const SLOT_ROW = {
  id: '22222222-2222-4222-8222-222222222222',
  session_id: SESSION_ROW.id,
  team: 'A',
  position: 'CB1',
  player_name: 'amie',
  claim_token: '33333333-3333-4333-8333-333333333333',
  claimed_at: '2026-09-10T05:00:00Z',
}

describe('parseSession', () => {
  it('narrows a valid row and coerces the numeric fee', () => {
    const session = parseSession(SESSION_ROW)
    expect(session.sessionNo).toBe(5)
    expect(session.feeMyr).toBe(27)
    expect(session.status).toBe('open')
    expect(session.teamNames).toEqual({ A: 'Merah', B: 'Putih', C: 'Kuning' })
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
    expect(slot.claimToken).toBe(SLOT_ROW.claim_token)
  })

  it('narrows an empty slot', () => {
    const slot = parseSlot({ ...SLOT_ROW, player_name: null, claim_token: null, claimed_at: null })
    expect(slot.playerName).toBeNull()
    expect(slot.claimToken).toBeNull()
  })

  it('rejects an unknown team or position', () => {
    expect(() => parseSlot({ ...SLOT_ROW, team: 'D' })).toThrow(/team/)
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
    for (const code of ['slot_taken', 'session_closed', 'invalid_name', 'wrong_token', 'slot_empty', 'slot_not_found', 'cross_session', 'same_slot'] as const) {
      expect(RPC_MESSAGES[code].length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/lib/claimToken.test.ts src/data/types.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/lib/claimToken.ts`**

```ts
export const CLAIM_TOKEN_KEY = 'sepak.claimToken'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let cached: string | null = null

/** The device's identity. Holding this token is what authorises releasing or
 *  moving a slot, which is how a player edits their own booking without an
 *  account. Storage can throw outright in private browsing, so a failure to
 *  persist degrades to a session-lived token rather than breaking the page. */
export function getClaimToken(): string {
  if (cached !== null) return cached

  try {
    const stored = localStorage.getItem(CLAIM_TOKEN_KEY)
    if (stored !== null && UUID_RE.test(stored)) {
      cached = stored
      return stored
    }
  } catch {
    // storage unavailable; fall through and mint a fresh token
  }

  const token = crypto.randomUUID()
  try {
    localStorage.setItem(CLAIM_TOKEN_KEY, token)
  } catch {
    // unpersisted: the token still works for this page's lifetime
  }

  cached = token
  return token
}

/** Test seam: clears the in-memory cache so each test starts clean. */
export function resetClaimTokenCache(): void {
  cached = null
}
```

Add `resetClaimTokenCache()` to the test's `beforeEach` so the module cache does not leak between cases:

```ts
import { resetClaimTokenCache } from './claimToken'
// in beforeEach:
resetClaimTokenCache()
```

- [ ] **Step 4: Implement `src/data/types.ts`**

```ts
import { isPosition, isTeamKey, type Position, type TeamKey } from '../lib/positions'

export type SessionStatus = 'open' | 'closed'

export type Session = {
  id: string
  sessionNo: number
  title: string
  playDate: string
  startTime: string
  durationMins: number
  venue: string
  feeMyr: number | null
  teamNames: Record<TeamKey, string>
  status: SessionStatus
  createdAt: string
}

export type Slot = {
  id: string
  sessionId: string
  team: TeamKey
  position: Position
  playerName: string | null
  claimToken: string | null
  claimedAt: string | null
}

export type SessionWithSlots = { session: Session; slots: Slot[] }

function asRecord(row: unknown, what: string): Record<string, unknown> {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new Error(`${what}: expected an object, got ${typeof row}`)
  }
  // Object.entries loses nothing and gives an index-signature type without a cast.
  return Object.fromEntries(Object.entries(row))
}

function str(row: Record<string, unknown>, field: string): string {
  const value = row[field]
  if (typeof value !== 'string') throw new Error(`${field}: expected a string`)
  return value
}

function nullableStr(row: Record<string, unknown>, field: string): string | null {
  const value = row[field]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`${field}: expected a string or null`)
  return value
}

function int(row: Record<string, unknown>, field: string): number {
  const value = row[field]
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new Error(`${field}: expected a number`)
  }
  return parsed
}

/** Postgres `numeric` arrives over the wire as a string, so the fee is parsed
 *  rather than assumed, and a genuine null stays null (free) instead of
 *  collapsing to 0. */
function nullableNumeric(row: Record<string, unknown>, field: string): number | null {
  const value = row[field]
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new Error(`${field}: expected a numeric or null`)
  }
  return parsed
}

function isSessionStatus(value: string): value is SessionStatus {
  return value === 'open' || value === 'closed'
}

export function parseSession(row: unknown): Session {
  const r = asRecord(row, 'session')
  const status = str(r, 'status')
  if (!isSessionStatus(status)) throw new Error(`status: unknown value ${status}`)

  return {
    id: str(r, 'id'),
    sessionNo: int(r, 'session_no'),
    title: str(r, 'title'),
    playDate: str(r, 'play_date'),
    startTime: str(r, 'start_time'),
    durationMins: int(r, 'duration_mins'),
    venue: str(r, 'venue'),
    feeMyr: nullableNumeric(r, 'fee_myr'),
    teamNames: {
      A: str(r, 'team_a_name'),
      B: str(r, 'team_b_name'),
      C: str(r, 'team_c_name'),
    },
    status,
    createdAt: str(r, 'created_at'),
  }
}

export function parseSlot(row: unknown): Slot {
  const r = asRecord(row, 'slot')
  const team = str(r, 'team')
  if (!isTeamKey(team)) throw new Error(`team: unknown value ${team}`)
  const position = str(r, 'position')
  if (!isPosition(position)) throw new Error(`position: unknown value ${position}`)

  return {
    id: str(r, 'id'),
    sessionId: str(r, 'session_id'),
    team,
    position,
    playerName: nullableStr(r, 'player_name'),
    claimToken: nullableStr(r, 'claim_token'),
    claimedAt: nullableStr(r, 'claimed_at'),
  }
}

export const RPC_ERROR_CODES = [
  'slot_taken',
  'session_closed',
  'invalid_name',
  'invalid_token',
  'wrong_token',
  'slot_empty',
  'slot_not_found',
  'cross_session',
  'same_slot',
] as const

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number]

/** Supabase wraps a raised postgres exception in its own message text, so the
 *  code is matched inside the string rather than compared to it. */
export function rpcErrorCode(error: unknown): RpcErrorCode | null {
  if (typeof error !== 'object' || error === null) return null
  const message = Object.entries(error).find(([k]) => k === 'message')?.[1]
  if (typeof message !== 'string') return null
  return RPC_ERROR_CODES.find((code) => message.includes(code)) ?? null
}

export const RPC_MESSAGES: Record<RpcErrorCode, string> = {
  slot_taken: 'Slot dah diambil.',
  session_closed: 'Sesi dah ditutup.',
  invalid_name: 'Nama tak sah. Isi 1 hingga 40 aksara.',
  invalid_token: 'Peranti tak dikenali. Muat semula halaman.',
  wrong_token: 'Slot ini bukan milik anda.',
  slot_empty: 'Slot ini kosong.',
  slot_not_found: 'Slot tak dijumpai.',
  cross_session: 'Tak boleh tukar ke sesi lain.',
  same_slot: 'Slot yang sama.',
}

export const FALLBACK_ERROR_MESSAGE = 'Ada masalah. Cuba lagi.'
```

- [ ] **Step 5: Implement `src/lib/supabase.ts`**

```ts
import { createClient } from '@supabase/supabase-js'

function required(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`)
  }
  return value
}

const url = required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL)
const anonKey = required('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY)

/** The anon key is public by design: it ships inside the bundle on any host,
 *  and RLS plus the token-checked RPCs are what actually constrain it. */
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 5 } },
})
```

Add the env typing in `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string | undefined
  readonly VITE_SUPABASE_ANON_KEY: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add supabase client, parsed domain types, and device claim token"
```

---

### Task 7: Data layer with live-database integration tests

The RPC wrappers, tested against the real local Postgres — including two genuinely concurrent claims on one slot, which is the case the row lock exists for and the one a mock would never catch.

**Files:**
- Create: `src/data/sessions.ts`, `src/data/slots.ts`, `tests/helpers/localSupabase.ts`
- Test: `tests/data/slots.integration.test.ts`, `tests/data/sessions.integration.test.ts`
- Modify: `vitest.config.ts` (add an integration project), `package.json` (add `test:int`)

**Interfaces:**
- Consumes: `supabase`, `parseSession`, `parseSlot`, `Session`, `Slot`, `SessionWithSlots`, `getClaimToken`.
- Produces:
  - `listSessions(): Promise<Session[]>` — newest play date first
  - `getSessionWithSlots(id: string): Promise<SessionWithSlots | null>`
  - `createSession(input: NewSessionInput): Promise<Session>`
  - `updateSession(id: string, patch: SessionPatch): Promise<Session>`
  - `setSessionStatus(id: string, status: SessionStatus): Promise<Session>`
  - `deleteSession(id: string): Promise<void>`
  - `nextSessionNo(): Promise<number>`
  - `claimSlot(slotId: string, playerName: string): Promise<Slot>`
  - `releaseSlot(slotId: string): Promise<Slot>`
  - `moveSlot(fromId: string, toId: string): Promise<Slot>`
  - `adminClearSlot(slotId: string): Promise<void>` — organiser override, direct table write
  - `type NewSessionInput`, `type SessionPatch`

- [ ] **Step 1: Write the test helper**

`tests/helpers/localSupabase.ts`. Reads the local keys at runtime so no key is ever committed.

```ts
import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type Status = { API_URL: string; ANON_KEY: string; SERVICE_ROLE_KEY: string; DB_URL: string }

function readStatus(): Status {
  const raw = execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' })
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('unexpected supabase status output')
  const record = Object.fromEntries(Object.entries(parsed))

  const field = (name: keyof Status): string => {
    const value = record[name]
    if (typeof value !== 'string' || value === '') {
      throw new Error(`supabase status: missing ${name}. Is the local stack running?`)
    }
    return value
  }

  return {
    API_URL: field('API_URL'),
    ANON_KEY: field('ANON_KEY'),
    SERVICE_ROLE_KEY: field('SERVICE_ROLE_KEY'),
    DB_URL: field('DB_URL'),
  }
}

export const localStatus = readStatus()

/** The anon client — the same privileges a real visitor has. */
export function anonClient(): SupabaseClient {
  return createClient(localStatus.API_URL, localStatus.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Service role, used only to seed and tear down fixtures. Local-only, read
 *  from the running stack, never written to disk. */
export function adminClient(): SupabaseClient {
  return createClient(localStatus.API_URL, localStatus.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function seedSession(
  overrides: Partial<{ sessionNo: number; playDate: string; status: 'open' | 'closed'; feeMyr: number | null }> = {},
): Promise<{ sessionId: string; slotIds: Record<string, string | undefined> }> {
  const admin = adminClient()
  const { data, error } = await admin
    .from('sessions')
    .insert({
      session_no: overrides.sessionNo ?? 1,
      title: 'Geng Turun Peluh',
      play_date: overrides.playDate ?? '2026-09-16',
      start_time: '20:00:00',
      venue: 'Padang Presint 8',
      fee_myr: overrides.feeMyr === undefined ? 27 : overrides.feeMyr,
      status: overrides.status ?? 'open',
    })
    .select('id')
    .single()

  if (error !== null) throw new Error(`seed session failed: ${error.message}`)
  const sessionId = parseId(data)

  const positions = ['GK', 'LB', 'CB1', 'CB2', 'RB', 'DM', 'MC', 'AM', 'LWF', 'RWF', 'ST'] as const
  const rows = ['A', 'B', 'C'].flatMap((team) => positions.map((position) => ({ session_id: sessionId, team, position })))

  const inserted = await admin.from('slots').insert(rows).select('id, team, position')
  if (inserted.error !== null) throw new Error(`seed slots failed: ${inserted.error.message}`)

  const slotIds: Record<string, string | undefined> = {}
  for (const row of inserted.data ?? []) {
    const r = Object.fromEntries(Object.entries(row))
    const id = r['id']
    const team = r['team']
    const position = r['position']
    if (typeof id === 'string' && typeof team === 'string' && typeof position === 'string') {
      slotIds[`${team}:${position}`] = id
    }
  }

  return { sessionId, slotIds }
}

function parseId(row: unknown): string {
  if (typeof row !== 'object' || row === null) throw new Error('expected a row')
  const id = Object.fromEntries(Object.entries(row))['id']
  if (typeof id !== 'string') throw new Error('expected an id')
  return id
}

export async function deleteSession(sessionId: string): Promise<void> {
  const { error } = await adminClient().from('sessions').delete().eq('id', sessionId)
  if (error !== null) throw new Error(`cleanup failed: ${error.message}`)
}

export function slotId(ids: Record<string, string | undefined>, team: string, position: string): string {
  const id = ids[`${team}:${position}`]
  if (id === undefined) throw new Error(`no seeded slot for ${team}:${position}`)
  return id
}
```

- [ ] **Step 2: Write the failing integration test for slots**

`tests/data/slots.integration.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { anonClient, deleteSession, seedSession, slotId } from '../helpers/localSupabase'

const TOKEN_A = '44444444-4444-4444-8444-444444444444'
const TOKEN_B = '55555555-5555-4555-8555-555555555555'

async function claim(client: ReturnType<typeof anonClient>, id: string, name: string, token: string) {
  return client.rpc('claim_slot', { p_slot_id: id, p_name: name, p_token: token })
}

describe('slot RPCs against local postgres', () => {
  let sessionId = ''
  let ids: Record<string, string | undefined> = {}
  const client = anonClient()

  beforeEach(async () => {
    const seeded = await seedSession()
    sessionId = seeded.sessionId
    ids = seeded.slotIds
  })

  afterEach(async () => {
    await deleteSession(sessionId)
  })

  it('claims an empty slot', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const { error } = await claim(client, gk, 'Hazmi', TOKEN_A)
    expect(error).toBeNull()

    const { data } = await client.from('slots').select('player_name').eq('id', gk).single()
    expect(data).toMatchObject({ player_name: 'Hazmi' })
  })

  it('lets exactly one of two simultaneous claims win', async () => {
    const gk = slotId(ids, 'A', 'GK')

    const [first, second] = await Promise.all([
      claim(anonClient(), gk, 'Hazmi', TOKEN_A),
      claim(anonClient(), gk, 'Isaac', TOKEN_B),
    ])

    const errors = [first.error, second.error].filter((e) => e !== null)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('slot_taken')

    const { data } = await client.from('slots').select('player_name').eq('id', gk).single()
    const row = Object.fromEntries(Object.entries(data ?? {}))
    expect(['Hazmi', 'Isaac']).toContain(row['player_name'])
  })

  it('refuses to release another device''s slot', async () => {
    const gk = slotId(ids, 'A', 'GK')
    await claim(client, gk, 'Hazmi', TOKEN_A)

    const { error } = await client.rpc('release_slot', { p_slot_id: gk, p_token: TOKEN_B })
    expect(error?.message).toContain('wrong_token')

    const { data } = await client.from('slots').select('player_name').eq('id', gk).single()
    expect(data).toMatchObject({ player_name: 'Hazmi' })
  })

  it('releases with the right token', async () => {
    const gk = slotId(ids, 'A', 'GK')
    await claim(client, gk, 'Hazmi', TOKEN_A)

    const { error } = await client.rpc('release_slot', { p_slot_id: gk, p_token: TOKEN_A })
    expect(error).toBeNull()

    const { data } = await client.from('slots').select('player_name').eq('id', gk).single()
    expect(data).toMatchObject({ player_name: null })
  })

  it('moves a claim between positions atomically', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const st = slotId(ids, 'A', 'ST')
    await claim(client, gk, 'Hazmi', TOKEN_A)

    const { error } = await client.rpc('move_slot', { p_from: gk, p_to: st, p_token: TOKEN_A })
    expect(error).toBeNull()

    const { data } = await client.from('slots').select('id, player_name').in('id', [gk, st])
    const byId = new Map((data ?? []).map((row) => {
      const r = Object.fromEntries(Object.entries(row))
      return [String(r['id']), r['player_name']]
    }))
    expect(byId.get(gk)).toBeNull()
    expect(byId.get(st)).toBe('Hazmi')
  })

  it('cannot write slots directly as anon', async () => {
    const gk = slotId(ids, 'A', 'GK')
    const { error } = await client
      .from('slots')
      .update({ player_name: 'Rogue', claim_token: TOKEN_B, claimed_at: new Date().toISOString() })
      .eq('id', gk)
    expect(error).not.toBeNull()
  })
})
```

Note: in the test title above, escape the apostrophe (`another device\`s slot`) or use double quotes — a raw `'` inside a single-quoted string is a syntax error.

- [ ] **Step 3: Add the integration project to `vitest.config.ts`**

Integration tests need the node environment and a longer timeout, and must not run in the default watch loop.

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          setupFiles: ['./tests/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          globals: true,
          include: ['tests/**/*.integration.test.ts'],
          testTimeout: 20_000,
          fileParallelism: false,
        },
      },
    ],
  },
})
```

Add to `package.json` scripts:

```json
"test": "vitest run --project unit",
"test:int": "vitest run --project integration",
"test:all": "pnpm test && pnpm test:db && pnpm test:int"
```

- [ ] **Step 4: Run the integration test to verify it fails**

```bash
supabase start
pnpm test:int
```

Expected: the RPC assertions PASS already (the functions exist from Task 5) but the suite FAILS to resolve `src/data/slots.ts` once the wrapper tests are added. If everything passes at this point, that is correct — this step validates the harness before the wrappers exist.

- [ ] **Step 5: Implement `src/data/slots.ts`**

```ts
import { getClaimToken } from '../lib/claimToken'
import { supabase } from '../lib/supabase'
import { FALLBACK_ERROR_MESSAGE, RPC_MESSAGES, parseSlot, rpcErrorCode, type Slot } from './types'

export class SlotActionError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message)
    this.name = 'SlotActionError'
  }
}

function fail(error: unknown): never {
  const code = rpcErrorCode(error)
  throw new SlotActionError(code === null ? FALLBACK_ERROR_MESSAGE : RPC_MESSAGES[code], code)
}

export async function claimSlot(slotId: string, playerName: string): Promise<Slot> {
  const { data, error } = await supabase.rpc('claim_slot', {
    p_slot_id: slotId,
    p_name: playerName,
    p_token: getClaimToken(),
  })
  if (error !== null) fail(error)
  return parseSlot(data)
}

export async function releaseSlot(slotId: string): Promise<Slot> {
  const { data, error } = await supabase.rpc('release_slot', {
    p_slot_id: slotId,
    p_token: getClaimToken(),
  })
  if (error !== null) fail(error)
  return parseSlot(data)
}

export async function moveSlot(fromId: string, toId: string): Promise<Slot> {
  const { data, error } = await supabase.rpc('move_slot', {
    p_from: fromId,
    p_to: toId,
    p_token: getClaimToken(),
  })
  if (error !== null) fail(error)
  return parseSlot(data)
}

/** Organiser override for orphaned slots — a player who cleared their browser,
 *  or a joke name. Writes the table directly, which RLS allows only for an
 *  authenticated session. */
export async function adminClearSlot(slotId: string): Promise<void> {
  const { error } = await supabase
    .from('slots')
    .update({ player_name: null, claim_token: null, claimed_at: null })
    .eq('id', slotId)
  if (error !== null) fail(error)
}

/** True when this device owns the slot and may release or move it. */
export function ownsSlot(slot: Slot): boolean {
  return slot.claimToken !== null && slot.claimToken === getClaimToken()
}
```

- [ ] **Step 6: Implement `src/data/sessions.ts`**

```ts
import { supabase } from '../lib/supabase'
import { parseSession, parseSlot, type Session, type SessionStatus, type SessionWithSlots } from './types'

export type NewSessionInput = {
  sessionNo: number
  title: string
  playDate: string
  startTime: string
  durationMins: number
  venue: string
  feeMyr: number | null
  teamAName: string
  teamBName: string
  teamCName: string
}

export type SessionPatch = Partial<Omit<NewSessionInput, 'sessionNo'>> & { sessionNo?: number }

function boom(what: string, message: string): never {
  throw new Error(`${what}: ${message}`)
}

export async function listSessions(): Promise<Session[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .order('play_date', { ascending: false })
    .order('start_time', { ascending: false })
  if (error !== null) boom('listSessions', error.message)
  return (data ?? []).map(parseSession)
}

export async function getSessionWithSlots(id: string): Promise<SessionWithSlots | null> {
  const sessionResult = await supabase.from('sessions').select('*').eq('id', id).maybeSingle()
  if (sessionResult.error !== null) boom('getSession', sessionResult.error.message)
  if (sessionResult.data === null) return null

  const slotsResult = await supabase.from('slots').select('*').eq('session_id', id)
  if (slotsResult.error !== null) boom('getSlots', slotsResult.error.message)

  return {
    session: parseSession(sessionResult.data),
    slots: (slotsResult.data ?? []).map(parseSlot),
  }
}

/** Suggests the next number so the organiser rarely has to think about it. */
export async function nextSessionNo(): Promise<number> {
  const { data, error } = await supabase
    .from('sessions')
    .select('session_no')
    .order('session_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error !== null) boom('nextSessionNo', error.message)
  if (data === null) return 1

  const value = Object.fromEntries(Object.entries(data))['session_no']
  const current = typeof value === 'string' ? Number(value) : value
  return typeof current === 'number' && Number.isFinite(current) ? current + 1 : 1
}

export async function createSession(input: NewSessionInput): Promise<Session> {
  const { data, error } = await supabase.rpc('create_session', {
    p_session_no: input.sessionNo,
    p_title: input.title,
    p_play_date: input.playDate,
    p_start_time: input.startTime,
    p_duration_mins: input.durationMins,
    p_venue: input.venue,
    p_fee_myr: input.feeMyr,
    p_team_a_name: input.teamAName,
    p_team_b_name: input.teamBName,
    p_team_c_name: input.teamCName,
  })
  if (error !== null) boom('createSession', error.message)
  return parseSession(data)
}

export async function updateSession(id: string, patch: SessionPatch): Promise<Session> {
  const row: Record<string, string | number | null> = {}
  if (patch.sessionNo !== undefined) row['session_no'] = patch.sessionNo
  if (patch.title !== undefined) row['title'] = patch.title
  if (patch.playDate !== undefined) row['play_date'] = patch.playDate
  if (patch.startTime !== undefined) row['start_time'] = patch.startTime
  if (patch.durationMins !== undefined) row['duration_mins'] = patch.durationMins
  if (patch.venue !== undefined) row['venue'] = patch.venue
  if (patch.feeMyr !== undefined) row['fee_myr'] = patch.feeMyr
  if (patch.teamAName !== undefined) row['team_a_name'] = patch.teamAName
  if (patch.teamBName !== undefined) row['team_b_name'] = patch.teamBName
  if (patch.teamCName !== undefined) row['team_c_name'] = patch.teamCName

  const { data, error } = await supabase.from('sessions').update(row).eq('id', id).select('*').single()
  if (error !== null) boom('updateSession', error.message)
  return parseSession(data)
}

export async function setSessionStatus(id: string, status: SessionStatus): Promise<Session> {
  const { data, error } = await supabase.from('sessions').update({ status }).eq('id', id).select('*').single()
  if (error !== null) boom('setSessionStatus', error.message)
  return parseSession(data)
}

export async function deleteSession(id: string): Promise<void> {
  const { error } = await supabase.from('sessions').delete().eq('id', id)
  if (error !== null) boom('deleteSession', error.message)
}
```

- [ ] **Step 7: Write the sessions integration test**

`tests/data/sessions.integration.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { adminClient, anonClient, deleteSession } from '../helpers/localSupabase'

describe('session access as anon', () => {
  const created: string[] = []

  afterEach(async () => {
    for (const id of created.splice(0)) await deleteSession(id)
  })

  it('reads sessions and slots', async () => {
    const admin = adminClient()
    const { data, error } = await admin.rpc('create_session', {
      p_session_no: 900,
      p_title: 'Integration',
      p_play_date: '2026-10-01',
      p_start_time: '20:00:00',
      p_duration_mins: 120,
      p_venue: 'Padang Integration',
      p_fee_myr: 27,
      p_team_a_name: 'Merah',
      p_team_b_name: 'Putih',
      p_team_c_name: 'Kuning',
    })
    expect(error).toBeNull()

    const row = Object.fromEntries(Object.entries(data ?? {}))
    const id = String(row['id'])
    created.push(id)

    const client = anonClient()
    const slots = await client.from('slots').select('id').eq('session_id', id)
    expect(slots.error).toBeNull()
    expect(slots.data).toHaveLength(33)
  })

  it('cannot create a session as anon', async () => {
    const { error } = await anonClient().rpc('create_session', {
      p_session_no: 901,
      p_title: 'Rogue',
      p_play_date: '2026-10-08',
      p_start_time: '20:00:00',
      p_duration_mins: 120,
      p_venue: 'Nowhere',
      p_fee_myr: 10,
      p_team_a_name: 'Merah',
      p_team_b_name: 'Putih',
      p_team_c_name: 'Kuning',
    })
    expect(error).not.toBeNull()
  })
})
```

- [ ] **Step 8: Run everything to verify it passes**

```bash
pnpm test && pnpm test:db && pnpm test:int && pnpm typecheck
```

Expected: all PASS. The concurrency case in particular must show exactly one `slot_taken`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add session and slot data layer with live-postgres integration tests"
```

---

### Task 8: Realtime session hook

**Files:**
- Create: `src/data/useSessionRealtime.ts`
- Test: `src/data/useSessionRealtime.test.tsx`

**Interfaces:**
- Consumes: `getSessionWithSlots` from `src/data/sessions.ts`; `supabase` from `src/lib/supabase.ts`; `Slot`, `Session` from `src/data/types.ts`.
- Produces: `useSessionRealtime(sessionId: string | undefined): SessionRealtimeState` where

```ts
export type SessionRealtimeState = {
  session: Session | null
  slots: Slot[]
  loading: boolean
  error: string | null
  notFound: boolean
  applyLocal: (slot: Slot) => void
  refetch: () => void
}
```

`applyLocal` is what makes an optimistic claim feel instant; the realtime event that follows simply confirms it.

- [ ] **Step 1: Write the failing test**

`src/data/useSessionRealtime.test.tsx`:

```tsx
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session, Slot } from './types'

const SESSION: Session = {
  id: 'session-1',
  sessionNo: 5,
  title: 'Geng Turun Peluh',
  playDate: '2026-09-16',
  startTime: '20:00:00',
  durationMins: 120,
  venue: 'Padang Presint 8',
  feeMyr: 27,
  teamNames: { A: 'Merah', B: 'Putih', C: 'Kuning' },
  status: 'open',
  createdAt: '2026-09-10T00:00:00Z',
}

const GK: Slot = {
  id: 'slot-gk',
  sessionId: 'session-1',
  team: 'A',
  position: 'GK',
  playerName: null,
  claimToken: null,
  claimedAt: null,
}

const getSessionWithSlots = vi.fn()
let emit: ((payload: { new: Record<string, unknown> }) => void) | null = null
const unsubscribe = vi.fn()

vi.mock('./sessions', () => ({ getSessionWithSlots: (id: string) => getSessionWithSlots(id) }))

vi.mock('../lib/supabase', () => ({
  supabase: {
    channel: () => ({
      on: (_event: string, _filter: unknown, handler: (payload: { new: Record<string, unknown> }) => void) => {
        emit = handler
        return {
          subscribe: () => ({ unsubscribe }),
        }
      },
    }),
    removeChannel: unsubscribe,
  },
}))

const { useSessionRealtime } = await import('./useSessionRealtime')

function Probe({ id }: { id: string | undefined }) {
  const state = useSessionRealtime(id)
  if (state.loading) return <p>loading</p>
  if (state.notFound) return <p>not-found</p>
  if (state.error !== null) return <p>error: {state.error}</p>
  return (
    <ul>
      {state.slots.map((slot) => (
        <li key={slot.id}>{`${slot.position}:${slot.playerName ?? 'empty'}`}</li>
      ))}
    </ul>
  )
}

describe('useSessionRealtime', () => {
  beforeEach(() => {
    getSessionWithSlots.mockReset()
    unsubscribe.mockReset()
    emit = null
  })

  it('loads the session and its slots', async () => {
    getSessionWithSlots.mockResolvedValue({ session: SESSION, slots: [GK] })
    render(<Probe id="session-1" />)
    expect(screen.getByText('loading')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('GK:empty')).toBeTruthy())
  })

  it('reports a missing session', async () => {
    getSessionWithSlots.mockResolvedValue(null)
    render(<Probe id="ghost" />)
    await waitFor(() => expect(screen.getByText('not-found')).toBeTruthy())
  })

  it('surfaces a fetch failure', async () => {
    getSessionWithSlots.mockRejectedValue(new Error('offline'))
    render(<Probe id="session-1" />)
    await waitFor(() => expect(screen.getByText(/error:/)).toBeTruthy())
  })

  it('applies a realtime slot update without refetching', async () => {
    getSessionWithSlots.mockResolvedValue({ session: SESSION, slots: [GK] })
    render(<Probe id="session-1" />)
    await waitFor(() => expect(screen.getByText('GK:empty')).toBeTruthy())

    act(() => {
      emit?.({
        new: {
          id: 'slot-gk',
          session_id: 'session-1',
          team: 'A',
          position: 'GK',
          player_name: 'Isaac',
          claim_token: '66666666-6666-4666-8666-666666666666',
          claimed_at: '2026-09-10T06:00:00Z',
        },
      })
    })

    await waitFor(() => expect(screen.getByText('GK:Isaac')).toBeTruthy())
    expect(getSessionWithSlots).toHaveBeenCalledTimes(1)
  })

  it('ignores a malformed realtime payload rather than crashing', async () => {
    getSessionWithSlots.mockResolvedValue({ session: SESSION, slots: [GK] })
    render(<Probe id="session-1" />)
    await waitFor(() => expect(screen.getByText('GK:empty')).toBeTruthy())

    act(() => {
      emit?.({ new: { id: 'slot-gk', team: 'NOPE' } })
    })

    expect(screen.getByText('GK:empty')).toBeTruthy()
  })

  it('tears down the channel on unmount', async () => {
    getSessionWithSlots.mockResolvedValue({ session: SESSION, slots: [GK] })
    const view = render(<Probe id="session-1" />)
    await waitFor(() => expect(screen.getByText('GK:empty')).toBeTruthy())
    view.unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('does nothing without a session id', () => {
    render(<Probe id={undefined} />)
    expect(getSessionWithSlots).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/data/useSessionRealtime.test.tsx`
Expected: FAIL — cannot resolve `./useSessionRealtime`.

- [ ] **Step 3: Implement `src/data/useSessionRealtime.ts`**

```ts
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSessionWithSlots } from './sessions'
import { parseSlot, type Session, type Slot } from './types'

export type SessionRealtimeState = {
  session: Session | null
  slots: Slot[]
  loading: boolean
  error: string | null
  notFound: boolean
  applyLocal: (slot: Slot) => void
  refetch: () => void
}

function replace(slots: readonly Slot[], next: Slot): Slot[] {
  const index = slots.findIndex((slot) => slot.id === next.id)
  if (index === -1) return [...slots, next]
  return slots.map((slot) => (slot.id === next.id ? next : slot))
}

export function useSessionRealtime(sessionId: string | undefined): SessionRealtimeState {
  const [session, setSession] = useState<Session | null>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const [loading, setLoading] = useState(sessionId !== undefined)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [nonce, setNonce] = useState(0)

  const refetch = useCallback(() => setNonce((n) => n + 1), [])
  const applyLocal = useCallback((slot: Slot) => setSlots((current) => replace(current, slot)), [])

  useEffect(() => {
    if (sessionId === undefined) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    setNotFound(false)

    getSessionWithSlots(sessionId)
      .then((result) => {
        if (cancelled) return
        if (result === null) {
          setNotFound(true)
          return
        }
        setSession(result.session)
        setSlots(result.slots)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : 'Ada masalah memuatkan sesi.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [sessionId, nonce])

  useEffect(() => {
    if (sessionId === undefined) return

    const channel = supabase
      .channel(`slots:${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'slots', filter: `session_id=eq.${sessionId}` },
        (payload: { new: unknown }) => {
          // A malformed payload must never take the page down; parseSlot throws
          // on anything unexpected and the event is simply dropped.
          try {
            const slot = parseSlot(payload.new)
            setSlots((current) => replace(current, slot))
          } catch {
            // ignore
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [sessionId])

  return { session, slots, loading, error, notFound, applyLocal, refetch }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: subscribe to live slot changes per session"
```

---

### Task 9: UI primitives — toast and bottom sheet

**Files:**
- Create: `src/components/Toast.tsx`, `src/components/Sheet.tsx`
- Test: `src/components/Toast.test.tsx`, `src/components/Sheet.test.tsx`

**Interfaces:**
- Consumes: nothing beyond React.
- Produces:
  - `<ToastProvider>{children}</ToastProvider>` and `useToast(): { show: (message: string, tone?: 'info' | 'error') => void }`
  - `<Sheet open title onClose>{children}</Sheet>` — bottom sheet, closes on backdrop tap and Escape, traps initial focus

- [ ] **Step 1: Write the failing tests**

`src/components/Toast.test.tsx`:

```tsx
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
```

`src/components/Sheet.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/components`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/components/Toast.tsx`**

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type Tone = 'info' | 'error'
type ToastApi = { show: (message: string, tone?: Tone) => void }

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (api === null) throw new Error('useToast must be used inside a ToastProvider')
  return api
}

type Current = { message: string; tone: Tone; key: number }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Current | null>(null)

  const show = useCallback((message: string, tone: Tone = 'info') => {
    setCurrent({ message, tone, key: Date.now() })
  }, [])

  useEffect(() => {
    if (current === null) return
    const timer = setTimeout(() => setCurrent(null), 3200)
    return () => clearTimeout(timer)
  }, [current])

  const api = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {current !== null && (
        <div
          role="status"
          aria-live="polite"
          className={[
            'fixed inset-x-4 bottom-6 z-50 rounded-2xl px-4 py-3 text-center text-sm font-medium shadow-lg',
            current.tone === 'error' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-900',
          ].join(' ')}
        >
          {current.message}
        </div>
      )}
    </ToastContext.Provider>
  )
}
```

- [ ] **Step 4: Implement `src/components/Sheet.tsx`**

```tsx
import { useEffect, useRef, type ReactNode } from 'react'

type SheetProps = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

export function Sheet({ open, title, onClose, children }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.querySelector<HTMLElement>('input, button')?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-end">
      <div
        data-testid="sheet-backdrop"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full rounded-t-3xl bg-slate-900 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-700" aria-hidden="true" />
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add toast and bottom sheet primitives"
```

---

### Task 10: Team views — pitch, list, and session header

The pitch is the point of the whole design: position is spatial, so a player finds their slot by looking where they play rather than reading eleven labels.

**Files:**
- Create: `src/components/SlotChip.tsx`, `src/components/PitchTeam.tsx`, `src/components/ListTeam.tsx`, `src/components/SessionMeta.tsx`
- Test: `src/components/PitchTeam.test.tsx`, `src/components/SessionMeta.test.tsx`

**Interfaces:**
- Consumes: `PITCH_ROWS`, `POSITIONS`, `positionLabel`, `Position`, `TeamKey` from `src/lib/positions.ts`; `formatFee`, `formatPlayDate`, `formatStartTime` from `src/lib/format.ts`; `Session`, `Slot` from `src/data/types.ts`.
- Produces:

```ts
export type SlotView = { slot: Slot | null; position: Position; mine: boolean }
export type TeamViewProps = {
  team: TeamKey
  teamName: string
  slots: readonly Slot[]      // this team's slots only
  myToken: string | null
  disabled: boolean            // true when the session is closed
  onSelect: (view: SlotView) => void
}
```

- `<SlotChip view label disabled onSelect />`
- `<PitchTeam {...TeamViewProps} />`
- `<ListTeam {...TeamViewProps} />`
- `<SessionMeta session={session} filled={n} total={33} />`

- [ ] **Step 1: Write the failing tests**

`src/components/PitchTeam.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Slot } from '../data/types'
import { PitchTeam } from './PitchTeam'

const TOKEN = '77777777-7777-4777-8777-777777777777'

function slot(position: Slot['position'], playerName: string | null, claimToken: string | null = null): Slot {
  return {
    id: `slot-${position}`,
    sessionId: 'session-1',
    team: 'A',
    position,
    playerName,
    claimToken: playerName === null ? null : claimToken,
    claimedAt: playerName === null ? null : '2026-09-10T06:00:00Z',
  }
}

describe('PitchTeam', () => {
  const base = {
    team: 'A' as const,
    teamName: 'Merah',
    myToken: TOKEN,
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

  it('marks the slot this device owns', () => {
    render(<PitchTeam {...base} slots={[slot('ST', 'Hazmi', TOKEN)]} />)
    expect(screen.getByRole('button', { name: /ST.*Hazmi.*slot anda/i })).toBeTruthy()
  })

  it('does not mark a slot owned by another device', () => {
    render(<PitchTeam {...base} slots={[slot('ST', 'Hazmi', 'other-token')]} />)
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
    const mine = slot('ST', 'Hazmi', TOKEN)
    render(<PitchTeam {...base} onSelect={onSelect} slots={[mine]} />)
    await userEvent.click(screen.getByRole('button', { name: /ST/ }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ mine: true, slot: mine }))
  })

  it('ignores taps on another player''s slot', async () => {
    const onSelect = vi.fn()
    render(<PitchTeam {...base} onSelect={onSelect} slots={[slot('ST', 'Amir', 'other-token')]} />)
    await userEvent.click(screen.getByRole('button', { name: /ST/ }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('disables everything when the session is closed', async () => {
    const onSelect = vi.fn()
    render(<PitchTeam {...base} disabled onSelect={onSelect} slots={[]} />)
    for (const button of screen.getAllByRole('button')) expect(button).toHaveProperty('disabled', true)
    await userEvent.click(screen.getAllByRole('button')[0] as HTMLElement)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
```

Escape the apostrophe in the `another player's slot` title, as in Task 7.

`src/components/SessionMeta.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Session } from '../data/types'
import { SessionMeta } from './SessionMeta'

const SESSION: Session = {
  id: 'session-1',
  sessionNo: 5,
  title: 'Geng Turun Peluh',
  playDate: '2026-09-16',
  startTime: '20:00:00',
  durationMins: 120,
  venue: 'Padang Presint 8',
  feeMyr: 27,
  teamNames: { A: 'Merah', B: 'Putih', C: 'Kuning' },
  status: 'open',
  createdAt: '2026-09-10T00:00:00Z',
}

describe('SessionMeta', () => {
  it('shows the session details in the familiar order', () => {
    render(<SessionMeta session={SESSION} filled={24} total={33} />)
    expect(screen.getByText('Sesi 005 Geng Turun Peluh')).toBeTruthy()
    expect(screen.getByText('16/09/2026 (RABU)')).toBeTruthy()
    expect(screen.getByText('8:00 PM')).toBeTruthy()
    expect(screen.getByText('Padang Presint 8')).toBeTruthy()
    expect(screen.getByText('RM 27/pax')).toBeTruthy()
    expect(screen.getByText('24/33 penuh')).toBeTruthy()
  })

  it('omits the fee line for a free session', () => {
    render(<SessionMeta session={{ ...SESSION, feeMyr: null }} filled={0} total={33} />)
    expect(screen.queryByText('Yuran')).toBeNull()
  })

  it('flags a closed session', () => {
    render(<SessionMeta session={{ ...SESSION, status: 'closed' }} filled={33} total={33} />)
    expect(screen.getByText('Sesi ditutup')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/components`
Expected: FAIL — `PitchTeam` and `SessionMeta` not found.

- [ ] **Step 3: Implement `src/components/SlotChip.tsx`**

```tsx
import type { Position } from '../lib/positions'
import type { Slot } from '../data/types'

export type SlotView = { slot: Slot | null; position: Position; mine: boolean }

type SlotChipProps = {
  view: SlotView
  label: string
  disabled: boolean
  onSelect: (view: SlotView) => void
}

export function SlotChip({ view, label, disabled, onSelect }: SlotChipProps) {
  const name = view.slot?.playerName ?? null
  const taken = name !== null
  // Someone else's slot is inert: only its owner or the organiser can change it.
  const inert = disabled || (taken && !view.mine)

  const accessibleName = [label, name ?? 'kosong', view.mine ? 'slot anda' : null]
    .filter((part) => part !== null)
    .join(' — ')

  return (
    <button
      type="button"
      disabled={inert}
      aria-label={accessibleName}
      onClick={() => onSelect(view)}
      className={[
        'flex min-h-14 w-full flex-col items-center justify-center rounded-xl px-1 py-2 text-center transition',
        'disabled:cursor-default',
        view.mine
          ? 'bg-amber-400 text-slate-900 ring-2 ring-amber-200'
          : taken
            ? 'bg-slate-800/90 text-slate-200'
            : 'bg-emerald-600/25 text-emerald-100 ring-1 ring-emerald-400/50 active:bg-emerald-600/40',
      ].join(' ')}
    >
      <span className="text-[10px] font-bold tracking-wide opacity-80">{label}</span>
      <span className="w-full truncate text-xs font-medium">{name ?? '+'}</span>
    </button>
  )
}
```

- [ ] **Step 4: Implement `src/components/PitchTeam.tsx`**

```tsx
import { PITCH_ROWS, positionLabel, type Position, type TeamKey } from '../lib/positions'
import type { Slot } from '../data/types'
import { SlotChip, type SlotView } from './SlotChip'

export type TeamViewProps = {
  team: TeamKey
  teamName: string
  slots: readonly Slot[]
  myToken: string | null
  disabled: boolean
  onSelect: (view: SlotView) => void
}

export function toViews(
  slots: readonly Slot[],
  myToken: string | null,
): Map<Position, SlotView> {
  const views = new Map<Position, SlotView>()
  for (const slot of slots) {
    views.set(slot.position, {
      slot,
      position: slot.position,
      mine: slot.claimToken !== null && slot.claimToken === myToken,
    })
  }
  return views
}

export function PitchTeam({ team, teamName, slots, myToken, disabled, onSelect }: TeamViewProps) {
  const views = toViews(slots, myToken)

  return (
    <section className="rounded-3xl bg-pitch p-3 shadow-inner">
      <h3 className="mb-3 text-center text-sm font-bold tracking-wide text-white/90">
        {`Team ${team} ${teamName}`}
      </h3>

      <div className="space-y-2 rounded-2xl border border-pitch-line/40 bg-black/10 p-2">
        {PITCH_ROWS.map((row, index) => (
          <div
            key={index}
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
          >
            {row.map((position) => (
              <SlotChip
                key={position}
                label={positionLabel(position)}
                disabled={disabled}
                onSelect={onSelect}
                view={views.get(position) ?? { slot: null, position, mine: false }}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Implement `src/components/ListTeam.tsx`**

```tsx
import { POSITIONS, positionLabel } from '../lib/positions'
import { SlotChip } from './SlotChip'
import { toViews, type TeamViewProps } from './PitchTeam'

export function ListTeam({ team, teamName, slots, myToken, disabled, onSelect }: TeamViewProps) {
  const views = toViews(slots, myToken)

  return (
    <section className="rounded-3xl bg-slate-900/70 p-3">
      <h3 className="mb-3 text-sm font-bold tracking-wide text-slate-200">
        {`Team ${team} ${teamName}`}
      </h3>
      <ul className="space-y-1.5">
        {POSITIONS.map((position) => (
          <li key={position}>
            <SlotChip
              label={positionLabel(position)}
              disabled={disabled}
              onSelect={onSelect}
              view={views.get(position) ?? { slot: null, position, mine: false }}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 6: Implement `src/components/SessionMeta.tsx`**

```tsx
import type { Session } from '../data/types'
import { formatFee, formatPlayDate, formatStartTime } from '../lib/format'

type SessionMetaProps = { session: Session; filled: number; total: number }

function Row({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span aria-hidden="true">{icon}</span>
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-slate-100">{value}</span>
    </div>
  )
}

export function SessionMeta({ session, filled, total }: SessionMetaProps) {
  const fee = formatFee(session.feeMyr)

  return (
    <header className="space-y-3 rounded-3xl bg-slate-900/70 p-4">
      <h1 className="text-lg font-bold">
        {`Sesi ${String(session.sessionNo).padStart(3, '0')} ${session.title}`}
      </h1>

      <div className="space-y-1.5">
        <Row icon="📅" label="Tarikh" value={formatPlayDate(session.playDate)} />
        <Row icon="🕒" label="Masa" value={formatStartTime(session.startTime)} />
        <Row icon="🏟️" label="Tempat" value={session.venue} />
        {fee !== null && <Row icon="💵" label="Yuran" value={fee} />}
      </div>

      <div className="flex items-center gap-2">
        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-200">
          {`${filled}/${total} penuh`}
        </span>
        {session.status === 'closed' && (
          <span className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-300">
            Sesi ditutup
          </span>
        )}
      </div>
    </header>
  )
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: both PASS. The "renders all eleven positions even when no slots exist yet" case is the one that proves the pitch is driven by `PITCH_ROWS` rather than by whatever rows happen to be in the database.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: render each team as a tappable pitch with a list fallback"
```

---

### Task 11: Session page — claim, release, move, copy

The screen that matters. Optimistic writes so a booking feels instant, reverted on failure, with realtime confirming.

**Files:**
- Create: `src/routes/SessionPage.tsx`, `src/components/ClaimSheet.tsx`, `src/components/CopyButton.tsx`
- Modify: `src/App.tsx`, `src/main.tsx`
- Test: `src/routes/SessionPage.test.tsx`

**Interfaces:**
- Consumes: `useSessionRealtime`; `claimSlot`, `releaseSlot`, `moveSlot`, `SlotActionError` from `src/data/slots.ts`; `getClaimToken`; `buildWhatsAppMessage`; `PitchTeam`, `ListTeam`, `SessionMeta`, `Sheet`, `useToast`; `TEAM_KEYS`.
- Produces: the `/s/:id` route, and `<CopyButton text label />` reusable by the admin screen.

- [ ] **Step 1: Write the failing test**

`src/routes/SessionPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session, Slot } from '../data/types'

const TOKEN = '88888888-8888-4888-8888-888888888888'

const SESSION: Session = {
  id: 'session-1',
  sessionNo: 5,
  title: 'Geng Turun Peluh',
  playDate: '2026-09-16',
  startTime: '20:00:00',
  durationMins: 120,
  venue: 'Padang Presint 8',
  feeMyr: 27,
  teamNames: { A: 'Merah', B: 'Putih', C: 'Kuning' },
  status: 'open',
  createdAt: '2026-09-10T00:00:00Z',
}

function emptySlots(): Slot[] {
  const positions = ['GK', 'LB', 'CB1', 'CB2', 'RB', 'DM', 'MC', 'AM', 'LWF', 'RWF', 'ST'] as const
  return (['A', 'B', 'C'] as const).flatMap((team) =>
    positions.map((position): Slot => ({
      id: `${team}-${position}`,
      sessionId: 'session-1',
      team,
      position,
      playerName: null,
      claimToken: null,
      claimedAt: null,
    })),
  )
}

const state = {
  session: SESSION as Session | null,
  slots: emptySlots(),
  loading: false,
  error: null as string | null,
  notFound: false,
  applyLocal: vi.fn(),
  refetch: vi.fn(),
}

const claimSlot = vi.fn()
const releaseSlot = vi.fn()
const moveSlot = vi.fn()
const writeText = vi.fn()

vi.mock('../data/useSessionRealtime', () => ({ useSessionRealtime: () => state }))
vi.mock('../lib/claimToken', () => ({ getClaimToken: () => TOKEN }))
vi.mock('../data/slots', () => ({
  claimSlot: (...args: unknown[]) => claimSlot(...args),
  releaseSlot: (...args: unknown[]) => releaseSlot(...args),
  moveSlot: (...args: unknown[]) => moveSlot(...args),
  SlotActionError: class extends Error {
    constructor(message: string, readonly code: string | null) { super(message) }
  },
}))
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router')
  return { ...actual, useParams: () => ({ id: 'session-1' }) }
})

const { ToastProvider } = await import('../components/Toast')
const { default: SessionPage } = await import('./SessionPage')

function view() {
  return render(<ToastProvider><SessionPage /></ToastProvider>)
}

describe('SessionPage', () => {
  beforeEach(() => {
    state.session = SESSION
    state.slots = emptySlots()
    state.loading = false
    state.error = null
    state.notFound = false
    claimSlot.mockReset()
    releaseSlot.mockReset()
    moveSlot.mockReset()
    writeText.mockReset()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })

  it('shows the session header and all three teams', () => {
    view()
    expect(screen.getByText('Sesi 005 Geng Turun Peluh')).toBeTruthy()
    expect(screen.getByText('Team A Merah')).toBeTruthy()
    expect(screen.getByText('Team B Putih')).toBeTruthy()
    expect(screen.getByText('Team C Kuning')).toBeTruthy()
    expect(screen.getByText('0/33 penuh')).toBeTruthy()
  })

  it('claims a slot through the name sheet', async () => {
    claimSlot.mockResolvedValue({ ...state.slots[0], playerName: 'Hazmi', claimToken: TOKEN })
    view()

    await userEvent.click(screen.getAllByRole('button', { name: /^GK/ })[0] as HTMLElement)
    await userEvent.type(screen.getByLabelText('Nama'), 'Hazmi')
    await userEvent.click(screen.getByRole('button', { name: 'Ambil slot' }))

    await waitFor(() => expect(claimSlot).toHaveBeenCalledWith('A-GK', 'Hazmi'))
  })

  it('refuses to submit a blank name', async () => {
    view()
    await userEvent.click(screen.getAllByRole('button', { name: /^GK/ })[0] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: 'Ambil slot' }))
    expect(claimSlot).not.toHaveBeenCalled()
    expect(screen.getByText(/Isi nama/)).toBeTruthy()
  })

  it('reverts the optimistic claim and reports the reason on failure', async () => {
    const { SlotActionError } = await import('../data/slots')
    claimSlot.mockRejectedValue(new SlotActionError('Slot dah diambil.', 'slot_taken'))
    view()

    await userEvent.click(screen.getAllByRole('button', { name: /^GK/ })[0] as HTMLElement)
    await userEvent.type(screen.getByLabelText('Nama'), 'Hazmi')
    await userEvent.click(screen.getByRole('button', { name: 'Ambil slot' }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Slot dah diambil.'))
    expect(screen.queryByText('Hazmi')).toBeNull()
  })

  it('offers release and move on your own slot', async () => {
    const mine = state.slots.map((slot) =>
      slot.id === 'A-ST' ? { ...slot, playerName: 'Hazmi', claimToken: TOKEN, claimedAt: 'now' } : slot,
    )
    state.slots = mine
    releaseSlot.mockResolvedValue({ ...mine[10], playerName: null, claimToken: null })
    view()

    await userEvent.click(screen.getAllByRole('button', { name: /^ST/ })[0] as HTMLElement)
    expect(screen.getByRole('button', { name: 'Lepaskan slot' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tukar posisi' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Lepaskan slot' }))
    await waitFor(() => expect(releaseSlot).toHaveBeenCalledWith('A-ST'))
  })

  it('summarises your slot at the top of the page', () => {
    state.slots = state.slots.map((slot) =>
      slot.id === 'B-MC' ? { ...slot, playerName: 'Hazmi', claimToken: TOKEN, claimedAt: 'now' } : slot,
    )
    view()
    expect(screen.getByText(/Slot anda: Team B Putih — MC/)).toBeTruthy()
  })

  it('copies the WhatsApp message', async () => {
    writeText.mockResolvedValue(undefined)
    view()
    await userEvent.click(screen.getByRole('button', { name: /Salin untuk WhatsApp/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const copied = String(writeText.mock.calls[0]?.[0] ?? '')
    expect(copied).toContain('Sesi 005 Geng Turun Peluh')
    expect(copied).toContain('💵 Yuran: RM 27/pax')
  })

  it('locks the list when the session is closed', () => {
    state.session = { ...SESSION, status: 'closed' }
    view()
    expect(screen.getByText('Sesi ditutup')).toBeTruthy()
    for (const button of screen.getAllByRole('button', { name: /^GK/ })) {
      expect(button).toHaveProperty('disabled', true)
    }
  })

  it('reports a missing session', () => {
    state.notFound = true
    state.session = null
    view()
    expect(screen.getByText('Sesi tak dijumpai.')).toBeTruthy()
  })

  it('offers a retry when loading failed', async () => {
    state.error = 'offline'
    state.session = null
    view()
    await userEvent.click(screen.getByRole('button', { name: 'Cuba lagi' }))
    expect(state.refetch).toHaveBeenCalled()
  })

  it('toggles between pitch and list view', async () => {
    view()
    await userEvent.click(screen.getByRole('button', { name: 'Papar senarai' }))
    expect(screen.getByRole('button', { name: 'Papar padang' })).toBeTruthy()
    expect(localStorage.getItem('sepak.viewMode')).toBe('list')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/routes/SessionPage.test.tsx`
Expected: FAIL — cannot resolve `./SessionPage`.

- [ ] **Step 3: Implement `src/components/CopyButton.tsx`**

```tsx
import { useState } from 'react'
import { useToast } from './Toast'

type CopyButtonProps = { text: string; label: string }

export function CopyButton({ text, label }: CopyButtonProps) {
  const { show } = useToast()
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      show('Gagal menyalin. Cuba tekan lama untuk pilih teks.', 'error')
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="w-full rounded-2xl bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-100 active:bg-slate-700"
    >
      {copied ? '✅ Dah disalin' : `📋 ${label}`}
    </button>
  )
}
```

- [ ] **Step 4: Implement `src/components/ClaimSheet.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { positionLabel } from '../lib/positions'
import type { SlotView } from './SlotChip'
import { Sheet } from './Sheet'

type ClaimSheetProps = {
  view: SlotView | null
  teamName: string
  busy: boolean
  onClose: () => void
  onClaim: (name: string) => void
  onRelease: () => void
  onStartMove: () => void
}

export function ClaimSheet({ view, teamName, busy, onClose, onClaim, onRelease, onStartMove }: ClaimSheetProps) {
  const [name, setName] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    setName('')
    setProblem(null)
  }, [view])

  if (view === null) return null

  const label = positionLabel(view.position)
  const title = `${teamName} — ${label}`

  if (view.mine) {
    return (
      <Sheet open title={title} onClose={onClose}>
        <p className="mb-4 text-sm text-slate-300">{`Slot anda: ${view.slot?.playerName ?? ''}`}</p>
        <div className="space-y-2">
          <button
            type="button"
            disabled={busy}
            onClick={onStartMove}
            className="w-full rounded-2xl bg-slate-800 px-4 py-3 text-sm font-semibold active:bg-slate-700"
          >
            Tukar posisi
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onRelease}
            className="w-full rounded-2xl bg-red-500/90 px-4 py-3 text-sm font-semibold text-white active:bg-red-500"
          >
            Lepaskan slot
          </button>
        </div>
      </Sheet>
    )
  }

  function submit() {
    const trimmed = name.trim()
    if (trimmed === '') {
      setProblem('Isi nama anda dulu.')
      return
    }
    if (trimmed.length > 40) {
      setProblem('Nama terlalu panjang (maksimum 40 aksara).')
      return
    }
    onClaim(trimmed)
  }

  return (
    <Sheet open title={title} onClose={onClose}>
      <label htmlFor="player-name" className="mb-1 block text-sm text-slate-300">Nama</label>
      <input
        id="player-name"
        value={name}
        onChange={(event) => { setName(event.target.value); setProblem(null) }}
        onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
        maxLength={40}
        autoComplete="name"
        className="mb-2 w-full rounded-2xl bg-slate-800 px-4 py-3 text-base outline-none ring-emerald-400 focus:ring-2"
      />
      {problem !== null && <p className="mb-2 text-xs text-red-400">{problem}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950 active:bg-emerald-400 disabled:opacity-60"
      >
        Ambil slot
      </button>
    </Sheet>
  )
}
```

- [ ] **Step 5: Implement `src/routes/SessionPage.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ClaimSheet } from '../components/ClaimSheet'
import { CopyButton } from '../components/CopyButton'
import { ListTeam } from '../components/ListTeam'
import { PitchTeam } from '../components/PitchTeam'
import { SessionMeta } from '../components/SessionMeta'
import type { SlotView } from '../components/SlotChip'
import { useToast } from '../components/Toast'
import { SlotActionError, claimSlot, moveSlot, releaseSlot } from '../data/slots'
import type { Slot } from '../data/types'
import { useSessionRealtime } from '../data/useSessionRealtime'
import { getClaimToken } from '../lib/claimToken'
import { TEAM_KEYS, positionLabel, type TeamKey } from '../lib/positions'
import { buildWhatsAppMessage } from '../lib/whatsapp'

const VIEW_MODE_KEY = 'sepak.viewMode'

function readViewMode(): 'pitch' | 'list' {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'pitch'
  } catch {
    return 'pitch'
  }
}

export default function SessionPage() {
  const { id } = useParams()
  const { session, slots, loading, error, notFound, applyLocal, refetch } = useSessionRealtime(id)
  const { show } = useToast()

  const [selected, setSelected] = useState<SlotView | null>(null)
  const [movingFrom, setMovingFrom] = useState<Slot | null>(null)
  const [busy, setBusy] = useState(false)
  const [viewMode, setViewMode] = useState<'pitch' | 'list'>(readViewMode)

  const token = getClaimToken()
  const mySlot = slots.find((slot) => slot.claimToken !== null && slot.claimToken === token) ?? null
  const filled = slots.filter((slot) => slot.playerName !== null).length
  const closed = session?.status === 'closed'

  const whatsappText = useMemo(() => {
    if (session === null) return ''
    return buildWhatsAppMessage({
      sessionNo: session.sessionNo,
      title: session.title,
      playDate: session.playDate,
      startTime: session.startTime,
      venue: session.venue,
      feeMyr: session.feeMyr,
      teamNames: session.teamNames,
      slots: slots.map(({ team, position, playerName }) => ({ team, position, playerName })),
    })
  }, [session, slots])

  function toggleViewMode() {
    const next = viewMode === 'pitch' ? 'list' : 'pitch'
    setViewMode(next)
    try {
      localStorage.setItem(VIEW_MODE_KEY, next)
    } catch {
      // a remembered preference is a convenience, not a requirement
    }
  }

  /** Optimistic: the slot changes immediately, and is put back if the write
   *  loses. The realtime event that follows simply confirms what is on screen. */
  async function run(action: () => Promise<Slot>, optimistic: Slot | null, revert: Slot | null) {
    setBusy(true)
    if (optimistic !== null) applyLocal(optimistic)
    try {
      applyLocal(await action())
      setSelected(null)
      setMovingFrom(null)
    } catch (cause: unknown) {
      if (revert !== null) applyLocal(revert)
      show(cause instanceof SlotActionError ? cause.message : 'Ada masalah. Cuba lagi.', 'error')
      refetch()
    } finally {
      setBusy(false)
    }
  }

  function onSelect(view: SlotView) {
    if (movingFrom !== null && view.slot?.playerName == null) {
      const target = view.slot
      if (target === null) return
      void run(() => moveSlot(movingFrom.id, target.id), null, null)
      return
    }
    setSelected(view)
  }

  function onClaim(name: string) {
    const slot = selected?.slot
    if (slot === undefined || slot === null) return
    void run(
      () => claimSlot(slot.id, name),
      { ...slot, playerName: name, claimToken: token, claimedAt: new Date().toISOString() },
      slot,
    )
  }

  function onRelease() {
    const slot = selected?.slot
    if (slot === undefined || slot === null) return
    void run(
      () => releaseSlot(slot.id),
      { ...slot, playerName: null, claimToken: null, claimedAt: null },
      slot,
    )
  }

  if (loading) return <p className="p-6 text-slate-400">Memuatkan…</p>

  if (notFound) {
    return (
      <div className="space-y-3 p-6">
        <p>Sesi tak dijumpai.</p>
        <Link to="/" className="text-emerald-400 underline">Balik ke senarai sesi</Link>
      </div>
    )
  }

  if (error !== null || session === null) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-red-400">Gagal memuatkan sesi.</p>
        <button
          type="button"
          onClick={refetch}
          className="rounded-2xl bg-slate-800 px-4 py-2 text-sm font-semibold"
        >
          Cuba lagi
        </button>
      </div>
    )
  }

  const TeamView = viewMode === 'pitch' ? PitchTeam : ListTeam

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pb-24">
      <SessionMeta session={session} filled={filled} total={33} />

      {mySlot !== null && (
        <p className="rounded-2xl bg-amber-400/15 px-4 py-2 text-sm text-amber-200">
          {`Slot anda: Team ${mySlot.team} ${session.teamNames[mySlot.team]} — ${positionLabel(mySlot.position)}`}
        </p>
      )}

      {movingFrom !== null && (
        <p className="rounded-2xl bg-sky-400/15 px-4 py-2 text-sm text-sky-200">
          Pilih posisi kosong untuk bertukar.{' '}
          <button type="button" onClick={() => setMovingFrom(null)} className="underline">Batal</button>
        </p>
      )}

      <button
        type="button"
        onClick={toggleViewMode}
        className="w-full rounded-2xl bg-slate-800/70 px-4 py-2 text-xs font-semibold text-slate-300"
      >
        {viewMode === 'pitch' ? 'Papar senarai' : 'Papar padang'}
      </button>

      {TEAM_KEYS.map((team: TeamKey) => (
        <TeamView
          key={team}
          team={team}
          teamName={session.teamNames[team]}
          slots={slots.filter((slot) => slot.team === team)}
          myToken={token}
          disabled={closed || busy}
          onSelect={onSelect}
        />
      ))}

      <CopyButton text={whatsappText} label="Salin untuk WhatsApp" />

      <ClaimSheet
        view={selected}
        teamName={selected === null ? '' : `Team ${selected.slot?.team ?? ''}`}
        busy={busy}
        onClose={() => setSelected(null)}
        onClaim={onClaim}
        onRelease={onRelease}
        onStartMove={() => {
          setMovingFrom(selected?.slot ?? null)
          setSelected(null)
        }}
      />
    </div>
  )
}
```

- [ ] **Step 6: Wire the router in `src/App.tsx` and `src/main.tsx`**

`src/App.tsx`:

```tsx
import { Route, Routes } from 'react-router'
import Admin from './routes/Admin'
import SessionList from './routes/SessionList'
import SessionPage from './routes/SessionPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<SessionList />} />
      <Route path="/s/:id" element={<SessionPage />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<p className="p-6">Halaman tak dijumpai.</p>} />
    </Routes>
  )
}
```

`src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import { ToastProvider } from './components/Toast'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  <StrictMode>
    {/* basename matches Vite's base so GitHub Pages' subpath resolves */}
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)
```

Create placeholder route files so the build resolves; Tasks 12 and 13 fill them in:

```tsx
// src/routes/SessionList.tsx
export default function SessionList() {
  return <p className="p-6">Senarai sesi</p>
}
```

```tsx
// src/routes/Admin.tsx
export default function Admin() {
  return <p className="p-6">Admin</p>
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add the session page with optimistic claim, release and move"
```

---

### Task 12: Session list

**Files:**
- Create: `src/routes/SessionList.tsx` (replacing the placeholder)
- Test: `src/routes/SessionList.test.tsx`

**Interfaces:**
- Consumes: `listSessions` from `src/data/sessions.ts`; `formatFee`, `formatPlayDate`, `formatStartTime`; `supabase` for the aggregate fill count.
- Produces: the `/` route.

- [ ] **Step 1: Write the failing test**

`src/routes/SessionList.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../data/types'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    sessionNo: 5,
    title: 'Geng Turun Peluh',
    playDate: '2026-09-16',
    startTime: '20:00:00',
    durationMins: 120,
    venue: 'Padang Presint 8',
    feeMyr: 27,
    teamNames: { A: 'Merah', B: 'Putih', C: 'Kuning' },
    status: 'open',
    createdAt: '2026-09-10T00:00:00Z',
    ...overrides,
  }
}

const listSessions = vi.fn()
const fillCounts = vi.fn()

vi.mock('../data/sessions', () => ({
  listSessions: () => listSessions(),
  fillCounts: (ids: string[]) => fillCounts(ids),
}))

const { default: SessionList } = await import('./SessionList')

function view() {
  return render(<MemoryRouter><SessionList /></MemoryRouter>)
}

describe('SessionList', () => {
  beforeEach(() => {
    listSessions.mockReset()
    fillCounts.mockReset()
    fillCounts.mockResolvedValue(new Map([['session-1', 24]]))
  })

  it('lists an upcoming session with its details and fill count', async () => {
    listSessions.mockResolvedValue([session()])
    view()
    await waitFor(() => expect(screen.getByText('Sesi 005 Geng Turun Peluh')).toBeTruthy())
    expect(screen.getByText('16/09/2026 (RABU)')).toBeTruthy()
    expect(screen.getByText('8:00 PM')).toBeTruthy()
    expect(screen.getByText('Padang Presint 8')).toBeTruthy()
    expect(screen.getByText('RM 27/pax')).toBeTruthy()
    expect(screen.getByText('24/33 penuh')).toBeTruthy()
  })

  it('links each session to its page', async () => {
    listSessions.mockResolvedValue([session()])
    view()
    const link = await waitFor(() => screen.getByRole('link', { name: /Sesi 005/ }))
    expect(link.getAttribute('href')).toBe('/s/session-1')
  })

  it('separates past sessions from upcoming ones', async () => {
    listSessions.mockResolvedValue([
      session({ id: 'future', sessionNo: 6, playDate: '2099-01-01' }),
      session({ id: 'past', sessionNo: 4, playDate: '2020-01-01' }),
    ])
    fillCounts.mockResolvedValue(new Map())
    view()
    await waitFor(() => expect(screen.getByText('Akan datang')).toBeTruthy())
    expect(screen.getByText('Sesi lepas')).toBeTruthy()
  })

  it('omits the fee for a free session', async () => {
    listSessions.mockResolvedValue([session({ feeMyr: null })])
    view()
    await waitFor(() => expect(screen.getByText('Sesi 005 Geng Turun Peluh')).toBeTruthy())
    expect(screen.queryByText(/RM/)).toBeNull()
  })

  it('invites the organiser when there is nothing yet', async () => {
    listSessions.mockResolvedValue([])
    view()
    await waitFor(() => expect(screen.getByText(/Belum ada sesi/)).toBeTruthy())
  })

  it('reports a failure', async () => {
    listSessions.mockRejectedValue(new Error('offline'))
    view()
    await waitFor(() => expect(screen.getByText(/Gagal memuatkan/)).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/routes/SessionList.test.tsx`
Expected: FAIL — `fillCounts` is not exported from `../data/sessions`.

- [ ] **Step 3: Add `fillCounts` to `src/data/sessions.ts`**

One query for every session's claimed count, rather than 33 rows per card.

```ts
/** Claimed-slot counts keyed by session id. One round trip for the whole list. */
export async function fillCounts(sessionIds: readonly string[]): Promise<Map<string, number>> {
  if (sessionIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('slots')
    .select('session_id')
    .in('session_id', [...sessionIds])
    .not('player_name', 'is', null)
  if (error !== null) boom('fillCounts', error.message)

  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    const id = Object.fromEntries(Object.entries(row))['session_id']
    if (typeof id === 'string') counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}
```

- [ ] **Step 4: Implement `src/routes/SessionList.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { fillCounts, listSessions } from '../data/sessions'
import type { Session } from '../data/types'
import { formatFee, formatPlayDate, formatStartTime } from '../lib/format'

const TOTAL_SLOTS = 33

function todayIso(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function SessionCard({ session, filled }: { session: Session; filled: number }) {
  const fee = formatFee(session.feeMyr)

  return (
    <Link
      to={`/s/${session.id}`}
      className="block space-y-2 rounded-3xl bg-slate-900/70 p-4 active:bg-slate-900"
    >
      <h2 className="font-bold">
        {`Sesi ${String(session.sessionNo).padStart(3, '0')} ${session.title}`}
      </h2>
      <div className="space-y-1 text-sm text-slate-300">
        <p>📅 {formatPlayDate(session.playDate)}</p>
        <p>🕒 {formatStartTime(session.startTime)}</p>
        <p>🏟️ {session.venue}</p>
        {fee !== null && <p>💵 {fee}</p>}
      </div>
      <div className="flex gap-2">
        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold">
          {`${filled}/${TOTAL_SLOTS} penuh`}
        </span>
        {session.status === 'closed' && (
          <span className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-300">
            Ditutup
          </span>
        )}
      </div>
    </Link>
  )
}

export default function SessionList() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false

    listSessions()
      .then(async (rows) => {
        if (cancelled) return
        setSessions(rows)
        setCounts(await fillCounts(rows.map((row) => row.id)))
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (loading) return <p className="p-6 text-slate-400">Memuatkan…</p>
  if (failed) return <p className="p-6 text-red-400">Gagal memuatkan senarai sesi.</p>

  const today = todayIso()
  const upcoming = sessions.filter((s) => s.playDate >= today).reverse()
  const past = sessions.filter((s) => s.playDate < today)

  return (
    <div className="mx-auto max-w-md space-y-6 p-4">
      <h1 className="text-2xl font-bold">Sepak</h1>

      {sessions.length === 0 && (
        <p className="text-slate-400">Belum ada sesi. Admin boleh buat sesi baru di /admin.</p>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Akan datang</h2>
          {upcoming.map((session) => (
            <SessionCard key={session.id} session={session} filled={counts.get(session.id) ?? 0} />
          ))}
        </section>
      )}

      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Sesi lepas</h2>
          {past.map((session) => (
            <SessionCard key={session.id} session={session} filled={counts.get(session.id) ?? 0} />
          ))}
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: list upcoming and past sessions with fill counts"
```

---

### Task 13: Admin — login, create, duplicate, edit, close, clear

**Files:**
- Create: `src/routes/Admin.tsx` (replacing the placeholder), `src/components/SessionForm.tsx`, `src/data/auth.ts`
- Test: `src/routes/Admin.test.tsx`, `src/components/SessionForm.test.tsx`

**Interfaces:**
- Consumes: `createSession`, `updateSession`, `setSessionStatus`, `deleteSession`, `listSessions`, `nextSessionNo` from `src/data/sessions.ts`; `adminClearSlot` from `src/data/slots.ts`; `supabase.auth`.
- Produces:
  - `src/data/auth.ts`: `signIn(email, password): Promise<void>`, `signOut(): Promise<void>`, `useAuthUser(): { email: string | null; loading: boolean }`
  - `<SessionForm initial submitLabel busy onSubmit />` with

```ts
export type SessionFormValues = {
  sessionNo: number
  title: string
  playDate: string
  startTime: string
  durationMins: number
  venue: string
  feeMyr: number | null
  teamAName: string
  teamBName: string
  teamCName: string
}
```

- [ ] **Step 1: Write the failing form test**

`src/components/SessionForm.test.tsx`:

```tsx
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
  teamAName: 'Merah',
  teamBName: 'Putih',
  teamCName: 'Kuning',
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
```

- [ ] **Step 2: Write the failing admin test**

`src/routes/Admin.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../data/types'

const SESSION: Session = {
  id: 'session-1',
  sessionNo: 5,
  title: 'Geng Turun Peluh',
  playDate: '2026-09-16',
  startTime: '20:00:00',
  durationMins: 120,
  venue: 'Padang Presint 8',
  feeMyr: 27,
  teamNames: { A: 'Merah', B: 'Putih', C: 'Kuning' },
  status: 'open',
  createdAt: '2026-09-10T00:00:00Z',
}

const auth = { email: null as string | null, loading: false }
const signIn = vi.fn()
const signOut = vi.fn()
const listSessions = vi.fn()
const createSession = vi.fn()
const setSessionStatus = vi.fn()
const deleteSessionFn = vi.fn()
const nextSessionNo = vi.fn()

vi.mock('../data/auth', () => ({
  useAuthUser: () => auth,
  signIn: (email: string, password: string) => signIn(email, password),
  signOut: () => signOut(),
}))

vi.mock('../data/sessions', () => ({
  listSessions: () => listSessions(),
  createSession: (input: unknown) => createSession(input),
  updateSession: vi.fn(),
  setSessionStatus: (id: string, status: string) => setSessionStatus(id, status),
  deleteSession: (id: string) => deleteSessionFn(id),
  nextSessionNo: () => nextSessionNo(),
  fillCounts: () => Promise.resolve(new Map()),
}))

const { ToastProvider } = await import('../components/Toast')
const { default: Admin } = await import('./Admin')

function view() {
  return render(<MemoryRouter><ToastProvider><Admin /></ToastProvider></MemoryRouter>)
}

describe('Admin', () => {
  beforeEach(() => {
    auth.email = null
    auth.loading = false
    signIn.mockReset()
    signOut.mockReset()
    listSessions.mockReset().mockResolvedValue([SESSION])
    createSession.mockReset().mockResolvedValue({ ...SESSION, id: 'new-session' })
    setSessionStatus.mockReset().mockResolvedValue({ ...SESSION, status: 'closed' })
    deleteSessionFn.mockReset().mockResolvedValue(undefined)
    nextSessionNo.mockReset().mockResolvedValue(6)
  })

  it('asks for a login when signed out', () => {
    view()
    expect(screen.getByLabelText('E-mel')).toBeTruthy()
    expect(screen.getByLabelText('Kata laluan')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Sesi baru/ })).toBeNull()
  })

  it('signs in', async () => {
    signIn.mockResolvedValue(undefined)
    view()
    await userEvent.type(screen.getByLabelText('E-mel'), 'hazmi@example.com')
    await userEvent.type(screen.getByLabelText('Kata laluan'), 'rahsia123')
    await userEvent.click(screen.getByRole('button', { name: 'Masuk' }))
    expect(signIn).toHaveBeenCalledWith('hazmi@example.com', 'rahsia123')
  })

  it('reports a bad login', async () => {
    signIn.mockRejectedValue(new Error('Invalid login credentials'))
    view()
    await userEvent.type(screen.getByLabelText('E-mel'), 'hazmi@example.com')
    await userEvent.type(screen.getByLabelText('Kata laluan'), 'salah')
    await userEvent.click(screen.getByRole('button', { name: 'Masuk' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('E-mel atau kata laluan salah.'))
  })

  it('lists sessions once signed in', async () => {
    auth.email = 'hazmi@example.com'
    view()
    await waitFor(() => expect(screen.getByText(/Sesi 005/)).toBeTruthy())
  })

  it('creates a session, prefilling the next number', async () => {
    auth.email = 'hazmi@example.com'
    view()
    await userEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Sesi baru' })))
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Sesi no.').value).toBe('6'))

    await userEvent.type(screen.getByLabelText('Nama sesi'), 'Geng Turun Peluh')
    await userEvent.type(screen.getByLabelText('Tarikh'), '2026-09-23')
    await userEvent.type(screen.getByLabelText('Tempat'), 'Padang Presint 8')
    await userEvent.click(screen.getByRole('button', { name: 'Cipta sesi' }))

    await waitFor(() => expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionNo: 6, venue: 'Padang Presint 8' }),
    ))
  })

  it('duplicates the last session, keeping venue and fee but clearing nothing else', async () => {
    auth.email = 'hazmi@example.com'
    view()
    await userEvent.click(await waitFor(() => screen.getByRole('button', { name: /Duplikasi sesi lepas/ })))

    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Tempat').value).toBe('Padang Presint 8')
      expect(screen.getByLabelText<HTMLInputElement>('Yuran (RM)').value).toBe('27')
      expect(screen.getByLabelText<HTMLInputElement>('Sesi no.').value).toBe('6')
      // The date is deliberately blank: it is the one thing that must change.
      expect(screen.getByLabelText<HTMLInputElement>('Tarikh').value).toBe('')
    })
  })

  it('closes a session', async () => {
    auth.email = 'hazmi@example.com'
    view()
    await userEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Tutup sesi' })))
    expect(setSessionStatus).toHaveBeenCalledWith('session-1', 'closed')
  })

  it('requires confirmation before deleting', async () => {
    auth.email = 'hazmi@example.com'
    view()
    await userEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Hapus' })))
    expect(deleteSessionFn).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Ya, hapus' }))
    expect(deleteSessionFn).toHaveBeenCalledWith('session-1')
  })

  it('signs out', async () => {
    auth.email = 'hazmi@example.com'
    view()
    await userEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Keluar' })))
    expect(signOut).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `pnpm test src/routes/Admin.test.tsx src/components/SessionForm.test.tsx`
Expected: FAIL — `../data/auth` and `SessionForm` do not exist.

- [ ] **Step 4: Implement `src/data/auth.ts`**

```ts
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error !== null) throw new Error(error.message)
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error !== null) throw new Error(error.message)
}

/** Sign-ups are disabled in the Supabase project, so the only account is the
 *  organiser's, created from the dashboard. */
export function useAuthUser(): { email: string | null; loading: boolean } {
  const [email, setEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setEmail(data.session?.user.email ?? null)
      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null)
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [])

  return { email, loading }
}
```

- [ ] **Step 5: Implement `src/components/SessionForm.tsx`**

```tsx
import { useState } from 'react'
import { formatPlayDate } from '../lib/format'

export type SessionFormValues = {
  sessionNo: number
  title: string
  playDate: string
  startTime: string
  durationMins: number
  venue: string
  feeMyr: number | null
  teamAName: string
  teamBName: string
  teamCName: string
}

type SessionFormProps = {
  initial: SessionFormValues
  submitLabel: string
  busy: boolean
  onSubmit: (values: SessionFormValues) => void
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-400">{label}</label>
      {children}
    </div>
  )
}

const inputClass =
  'w-full rounded-2xl bg-slate-800 px-4 py-3 text-base outline-none ring-emerald-400 focus:ring-2'

export function SessionForm({ initial, submitLabel, busy, onSubmit }: SessionFormProps) {
  const [values, setValues] = useState(initial)
  // Fee is held as text so an empty box stays empty rather than snapping to 0.
  const [feeText, setFeeText] = useState(initial.feeMyr === null ? '' : String(initial.feeMyr))
  const [problem, setProblem] = useState<string | null>(null)

  function set<K extends keyof SessionFormValues>(key: K, value: SessionFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
    setProblem(null)
  }

  function submit() {
    if (values.title.trim() === '') return setProblem('Isi nama sesi.')
    if (values.venue.trim() === '') return setProblem('Isi tempat.')
    if (values.playDate === '') return setProblem('Pilih tarikh.')
    if (values.startTime === '') return setProblem('Pilih masa.')

    const trimmedFee = feeText.trim()
    const fee = trimmedFee === '' ? null : Number(trimmedFee)
    if (fee !== null && (!Number.isFinite(fee) || fee < 0)) return setProblem('Yuran tak sah.')

    onSubmit({
      ...values,
      title: values.title.trim(),
      venue: values.venue.trim(),
      feeMyr: fee,
    })
  }

  let dayHint: string | null = null
  if (values.playDate !== '') {
    try {
      dayHint = formatPlayDate(values.playDate)
    } catch {
      dayHint = null
    }
  }

  return (
    <div className="space-y-3">
      <Field id="session-no" label="Sesi no.">
        <input
          id="session-no"
          type="number"
          inputMode="numeric"
          value={values.sessionNo}
          onChange={(e) => set('sessionNo', Number(e.target.value))}
          className={inputClass}
        />
      </Field>

      <Field id="title" label="Nama sesi">
        <input id="title" value={values.title} onChange={(e) => set('title', e.target.value)} className={inputClass} />
      </Field>

      <Field id="play-date" label="Tarikh">
        <input
          id="play-date"
          type="date"
          value={values.playDate}
          onChange={(e) => set('playDate', e.target.value)}
          className={inputClass}
        />
      </Field>
      {dayHint !== null && <p className="text-xs text-emerald-400">{dayHint}</p>}

      <Field id="start-time" label="Masa">
        <input
          id="start-time"
          type="time"
          value={values.startTime}
          onChange={(e) => set('startTime', e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field id="duration" label="Tempoh (minit)">
        <input
          id="duration"
          type="number"
          inputMode="numeric"
          value={values.durationMins}
          onChange={(e) => set('durationMins', Number(e.target.value))}
          className={inputClass}
        />
      </Field>

      <Field id="venue" label="Tempat">
        <input id="venue" value={values.venue} onChange={(e) => set('venue', e.target.value)} className={inputClass} />
      </Field>

      <Field id="fee" label="Yuran (RM)">
        <input
          id="fee"
          type="number"
          inputMode="decimal"
          step="0.50"
          placeholder="Kosongkan jika percuma"
          value={feeText}
          onChange={(e) => { setFeeText(e.target.value); setProblem(null) }}
          className={inputClass}
        />
      </Field>

      <div className="grid grid-cols-3 gap-2">
        <Field id="team-a" label="Pasukan A">
          <input id="team-a" value={values.teamAName} onChange={(e) => set('teamAName', e.target.value)} className={inputClass} />
        </Field>
        <Field id="team-b" label="Pasukan B">
          <input id="team-b" value={values.teamBName} onChange={(e) => set('teamBName', e.target.value)} className={inputClass} />
        </Field>
        <Field id="team-c" label="Pasukan C">
          <input id="team-c" value={values.teamCName} onChange={(e) => set('teamCName', e.target.value)} className={inputClass} />
        </Field>
      </div>

      {problem !== null && <p className="text-xs text-red-400">{problem}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950 active:bg-emerald-400 disabled:opacity-60"
      >
        {submitLabel}
      </button>
    </div>
  )
}
```

- [ ] **Step 6: Implement `src/routes/Admin.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { SessionForm, type SessionFormValues } from '../components/SessionForm'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { signIn, signOut, useAuthUser } from '../data/auth'
import { createSession, deleteSession, listSessions, nextSessionNo, setSessionStatus } from '../data/sessions'
import type { Session } from '../data/types'
import { formatPlayDate, formatStartTime } from '../lib/format'

const DEFAULTS: SessionFormValues = {
  sessionNo: 1,
  title: '',
  playDate: '',
  startTime: '20:00',
  durationMins: 120,
  venue: '',
  feeMyr: null,
  teamAName: 'Merah',
  teamBName: 'Putih',
  teamCName: 'Kuning',
}

function LoginForm() {
  const { show } = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      await signIn(email, password)
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : ''
      show(
        message.includes('Invalid login credentials')
          ? 'E-mel atau kata laluan salah.'
          : 'Gagal masuk. Cuba lagi.',
        'error',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-3 p-6">
      <h1 className="text-xl font-bold">Admin</h1>
      <div className="space-y-1">
        <label htmlFor="email" className="block text-xs font-semibold text-slate-400">E-mel</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-2xl bg-slate-800 px-4 py-3 text-base outline-none focus:ring-2 focus:ring-emerald-400"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="password" className="block text-xs font-semibold text-slate-400">Kata laluan</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-2xl bg-slate-800 px-4 py-3 text-base outline-none focus:ring-2 focus:ring-emerald-400"
        />
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-60"
      >
        Masuk
      </button>
    </div>
  )
}

export default function Admin() {
  const { email, loading } = useAuthUser()
  const { show } = useToast()

  const [sessions, setSessions] = useState<Session[]>([])
  const [formValues, setFormValues] = useState<SessionFormValues | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Session | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      setSessions(await listSessions())
    } catch {
      show('Gagal memuatkan senarai sesi.', 'error')
    }
  }, [show])

  useEffect(() => {
    if (email === null) return
    void reload()
  }, [email, reload])

  if (loading) return <p className="p-6 text-slate-400">Memuatkan…</p>
  if (email === null) return <LoginForm />

  async function openNew() {
    setFormValues({ ...DEFAULTS, sessionNo: await nextSessionNo() })
  }

  /** The weekly path: everything carries over except the date, which is the
   *  one field that genuinely changes. */
  async function openDuplicate() {
    const last = sessions[0]
    if (last === undefined) {
      show('Belum ada sesi untuk diduplikasi.', 'error')
      return
    }
    setFormValues({
      sessionNo: await nextSessionNo(),
      title: last.title,
      playDate: '',
      startTime: last.startTime.slice(0, 5),
      durationMins: last.durationMins,
      venue: last.venue,
      feeMyr: last.feeMyr,
      teamAName: last.teamNames.A,
      teamBName: last.teamNames.B,
      teamCName: last.teamNames.C,
    })
  }

  async function submit(values: SessionFormValues) {
    setBusy(true)
    try {
      await createSession({
        sessionNo: values.sessionNo,
        title: values.title,
        playDate: values.playDate,
        startTime: values.startTime,
        durationMins: values.durationMins,
        venue: values.venue,
        feeMyr: values.feeMyr,
        teamAName: values.teamAName,
        teamBName: values.teamBName,
        teamCName: values.teamCName,
      })
      setFormValues(null)
      await reload()
      show('Sesi dicipta.')
    } catch {
      show('Gagal mencipta sesi.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function toggleStatus(session: Session) {
    try {
      await setSessionStatus(session.id, session.status === 'open' ? 'closed' : 'open')
      await reload()
    } catch {
      show('Gagal menukar status sesi.', 'error')
    }
  }

  async function remove(session: Session) {
    try {
      await deleteSession(session.id)
      setConfirmDelete(null)
      await reload()
      show('Sesi dihapus.')
    } catch {
      show('Gagal menghapus sesi.', 'error')
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Admin</h1>
        <button type="button" onClick={() => void signOut()} className="text-sm text-slate-400 underline">
          Keluar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void openNew()}
          className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950"
        >
          Sesi baru
        </button>
        <button
          type="button"
          onClick={() => void openDuplicate()}
          className="rounded-2xl bg-slate-800 px-4 py-3 text-sm font-semibold"
        >
          Duplikasi sesi lepas
        </button>
      </div>

      <ul className="space-y-3">
        {sessions.map((session) => (
          <li key={session.id} className="space-y-2 rounded-3xl bg-slate-900/70 p-4">
            <p className="font-semibold">
              {`Sesi ${String(session.sessionNo).padStart(3, '0')} ${session.title}`}
            </p>
            <p className="text-sm text-slate-400">
              {`${formatPlayDate(session.playDate)} · ${formatStartTime(session.startTime)} · ${session.venue}`}
            </p>
            <div className="flex flex-wrap gap-2">
              <Link to={`/s/${session.id}`} className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold">
                Buka
              </Link>
              <button
                type="button"
                onClick={() => void toggleStatus(session)}
                className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold"
              >
                {session.status === 'open' ? 'Tutup sesi' : 'Buka semula'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(session)}
                className="rounded-xl bg-red-500/20 px-3 py-2 text-xs font-semibold text-red-300"
              >
                Hapus
              </button>
            </div>
          </li>
        ))}
      </ul>

      {formValues !== null && (
        <Sheet open title="Sesi" onClose={() => setFormValues(null)}>
          <div className="max-h-[70vh] overflow-y-auto">
            <SessionForm initial={formValues} submitLabel="Cipta sesi" busy={busy} onSubmit={(v) => void submit(v)} />
          </div>
        </Sheet>
      )}

      {confirmDelete !== null && (
        <Sheet open title="Hapus sesi?" onClose={() => setConfirmDelete(null)}>
          <p className="mb-4 text-sm text-slate-300">
            {`Sesi ${String(confirmDelete.sessionNo).padStart(3, '0')} dan semua slotnya akan hilang.`}
          </p>
          <button
            type="button"
            onClick={() => void remove(confirmDelete)}
            className="w-full rounded-2xl bg-red-500 px-4 py-3 text-sm font-bold text-white"
          >
            Ya, hapus
          </button>
        </Sheet>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add admin login, session creation, duplication and lifecycle"
```

---

### Task 14: End-to-end tests against the built site

These are the tests that prove the two things unit tests structurally cannot: that a deep link survives a refresh on the static build, and that two real browsers racing one slot resolve to one winner with the loser told immediately.

**Files:**
- Create: `playwright.config.ts`, `e2e/fixtures.ts`, `e2e/booking.spec.ts`, `e2e/deeplink.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the built site in `dist/`, served by `vite preview`; the local Supabase stack; the seeding helpers from `tests/helpers/localSupabase.ts`.
- Produces: `pnpm e2e`.

- [ ] **Step 1: Install Playwright**

```bash
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

- [ ] **Step 2: Write `playwright.config.ts`**

Serving the *built* site rather than the dev server is the point: `404.html` only exists after a build, so only this configuration can catch a broken deep link.

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4173/sepak/',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'mobile', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/sepak/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
```

- [ ] **Step 3: Write `e2e/fixtures.ts`**

```ts
import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function status(): { url: string; serviceKey: string } {
  const raw = execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' })
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('bad supabase status')
  const record = Object.fromEntries(Object.entries(parsed))
  const url = record['API_URL']
  const serviceKey = record['SERVICE_ROLE_KEY']
  if (typeof url !== 'string' || typeof serviceKey !== 'string') {
    throw new Error('supabase status missing API_URL or SERVICE_ROLE_KEY')
  }
  return { url, serviceKey }
}

const { url, serviceKey } = status()

export function admin(): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

export async function createTestSession(sessionNo: number): Promise<string> {
  const { data, error } = await admin().rpc('create_session', {
    p_session_no: sessionNo,
    p_title: 'E2E Geng',
    p_play_date: '2026-12-16',
    p_start_time: '20:00:00',
    p_duration_mins: 120,
    p_venue: 'Padang E2E',
    p_fee_myr: 27,
    p_team_a_name: 'Merah',
    p_team_b_name: 'Putih',
    p_team_c_name: 'Kuning',
  })
  if (error !== null) throw new Error(`create_session failed: ${error.message}`)

  const row = Object.fromEntries(Object.entries(data ?? {}))
  const id = row['id']
  if (typeof id !== 'string') throw new Error('create_session returned no id')
  return id
}

export async function dropTestSession(id: string): Promise<void> {
  await admin().from('sessions').delete().eq('id', id)
}
```

- [ ] **Step 4: Write `e2e/booking.spec.ts`**

```ts
import { expect, test } from '@playwright/test'
import { createTestSession, dropTestSession } from './fixtures'

let sessionId = ''

test.beforeEach(async () => {
  sessionId = await createTestSession(800 + Math.floor(Math.random() * 100))
})

test.afterEach(async () => {
  await dropTestSession(sessionId)
})

test('a player claims, sees, and releases a slot', async ({ page }) => {
  await page.goto(`s/${sessionId}`)
  await expect(page.getByText('E2E Geng')).toBeVisible()
  await expect(page.getByText('0/33 penuh')).toBeVisible()

  await page.getByRole('button', { name: /^GK/ }).first().click()
  await page.getByLabel('Nama').fill('Hazmi')
  await page.getByRole('button', { name: 'Ambil slot' }).click()

  await expect(page.getByText('Hazmi')).toBeVisible()
  await expect(page.getByText('1/33 penuh')).toBeVisible()
  await expect(page.getByText(/Slot anda: Team A Merah — GK/)).toBeVisible()

  await page.getByRole('button', { name: /GK.*Hazmi/ }).click()
  await page.getByRole('button', { name: 'Lepaskan slot' }).click()
  await expect(page.getByText('0/33 penuh')).toBeVisible()
})

test('a claim appears live in another browser', async ({ browser }) => {
  const one = await browser.newContext()
  const two = await browser.newContext()
  const pageOne = await one.newPage()
  const pageTwo = await two.newPage()

  await pageOne.goto(`s/${sessionId}`)
  await pageTwo.goto(`s/${sessionId}`)

  await pageOne.getByRole('button', { name: /^ST/ }).first().click()
  await pageOne.getByLabel('Nama').fill('Zulazhar')
  await pageOne.getByRole('button', { name: 'Ambil slot' }).click()

  // No reload: realtime must deliver it.
  await expect(pageTwo.getByText('Zulazhar')).toBeVisible({ timeout: 10_000 })

  await one.close()
  await two.close()
})

test('two players racing one slot: one wins, the other is told', async ({ browser }) => {
  const one = await browser.newContext()
  const two = await browser.newContext()
  const pageOne = await one.newPage()
  const pageTwo = await two.newPage()

  await pageOne.goto(`s/${sessionId}`)
  await pageTwo.goto(`s/${sessionId}`)

  for (const [page, name] of [[pageOne, 'Isaac'], [pageTwo, 'Kimie']] as const) {
    await page.getByRole('button', { name: /^MC/ }).first().click()
    await page.getByLabel('Nama').fill(name)
  }

  await Promise.all([
    pageOne.getByRole('button', { name: 'Ambil slot' }).click(),
    pageTwo.getByRole('button', { name: 'Ambil slot' }).click(),
  ])

  const loserToast = pageOne
    .getByRole('status')
    .filter({ hasText: 'Slot dah diambil.' })
    .or(pageTwo.getByRole('status').filter({ hasText: 'Slot dah diambil.' }))
  await expect(loserToast.first()).toBeVisible({ timeout: 10_000 })

  // Exactly one name landed.
  await expect(pageOne.getByText('1/33 penuh')).toBeVisible({ timeout: 10_000 })

  await one.close()
  await two.close()
})

test('a closed session is read-only', async ({ page }) => {
  const { admin } = await import('./fixtures')
  await admin().from('sessions').update({ status: 'closed' }).eq('id', sessionId)

  await page.goto(`s/${sessionId}`)
  await expect(page.getByText('Sesi ditutup')).toBeVisible()
  await expect(page.getByRole('button', { name: /^GK/ }).first()).toBeDisabled()
})
```

- [ ] **Step 5: Write `e2e/deeplink.spec.ts`**

```ts
import { expect, test } from '@playwright/test'
import { createTestSession, dropTestSession } from './fixtures'

let sessionId = ''

test.beforeEach(async () => {
  sessionId = await createTestSession(900 + Math.floor(Math.random() * 90))
})

test.afterEach(async () => {
  await dropTestSession(sessionId)
})

test('a pasted session link opens directly', async ({ page }) => {
  // This is the WhatsApp case: a cold navigation straight to a nested route.
  await page.goto(`s/${sessionId}`)
  await expect(page.getByText('E2E Geng')).toBeVisible()
})

test('refreshing a session page keeps it working', async ({ page }) => {
  await page.goto(`s/${sessionId}`)
  await expect(page.getByText('E2E Geng')).toBeVisible()
  await page.reload()
  await expect(page.getByText('E2E Geng')).toBeVisible()
  await expect(page.getByText('Team A Merah')).toBeVisible()
})

test('an unknown session id says so instead of breaking', async ({ page }) => {
  await page.goto('s/11111111-1111-4111-8111-999999999999')
  await expect(page.getByText('Sesi tak dijumpai.')).toBeVisible()
})
```

- [ ] **Step 6: Add the e2e script and run it**

`package.json`:

```json
"e2e": "playwright test"
```

```bash
supabase start
pnpm e2e
```

Expected: all specs PASS. If the refresh test fails, `scripts/postbuild.mjs` did not run — that is exactly the regression this spec exists to catch.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test: add e2e coverage for booking races, realtime and deep links"
```

---

### Task 15: Deployment and README

**Files:**
- Create: `.github/workflows/deploy.yml`, `README.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `pnpm build`.
- Produces: a GitHub Pages deployment on every push to `main`.

- [ ] **Step 1: Write the workflow**

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test

      - run: pnpm build
        env:
          # Public by design: both values ship inside the bundle, so they are
          # repository variables rather than secrets. The service_role key is
          # never referenced here.
          VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ vars.VITE_SUPABASE_ANON_KEY }}

      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Write `README.md`**

````markdown
# Sepak

Mobile-first booking for weekly football sessions. An admin creates a session;
players open the link and tap the position they want. Three teams of eleven.

## Setup

```bash
pnpm install
supabase start
printf 'VITE_SUPABASE_URL=%s\nVITE_SUPABASE_ANON_KEY=%s\n' \
  "$(supabase status -o json | jq -r .API_URL)" \
  "$(supabase status -o json | jq -r .ANON_KEY)" > .env.local
pnpm dev
```

## Tests

| Command | Covers |
|---|---|
| `pnpm test` | Pure logic and components |
| `pnpm test:db` | Schema constraints, RLS, RPC error paths |
| `pnpm test:int` | Data layer against local Postgres, including claim races |
| `pnpm e2e` | Built site: booking, realtime, deep links |
| `pnpm test:all` | The first three |

## Deploying

1. Create a Supabase project. Apply migrations: `supabase link` then `supabase db push`.
2. **Disable sign-ups** in Authentication → Providers → Email, then create the
   single organiser account from the dashboard. Without this, anyone could
   register themselves into admin.
3. Add repository *variables* (not secrets) `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`. They ship inside the public bundle by design.
4. Enable Pages with the GitHub Actions source. Push to `main`.

The `service_role` key is never committed and never used by the app.

## Security model

The booking list is public: anyone with the link can read it and claim a slot.
That is deliberate — it replaces a WhatsApp message.

Enforcement lives in Postgres, not in the client. `anon` has read-only table
access and may execute exactly three functions (`claim_slot`, `release_slot`,
`move_slot`), each of which row-locks before deciding. Every device holds a
UUID in `localStorage`; presenting it is what authorises releasing or moving a
slot, so a player can edit their own booking and nobody else's.

Known limitations, accepted deliberately:

1. Anyone with the link can claim a slot, under any name.
2. Clearing browser data orphans a slot until the admin clears it.
3. Three teams of eleven is hard-coded; five-a-side needs a schema change.
4. There is no audit trail of claims and releases.
````

- [ ] **Step 3: Update `.gitignore`**

```
node_modules/
dist/
.env
.env.local
.DS_Store
playwright-report/
test-results/
/supabase/.branches
/supabase/.temp
```

- [ ] **Step 4: Verify the full suite and build**

```bash
pnpm install
pnpm typecheck && pnpm test && pnpm test:db && pnpm test:int && pnpm build && pnpm e2e
```

Expected: everything PASS, `dist/404.html` present.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: add github pages deployment and README"
```

---

### Task 16: Close the remaining spec gaps

Four spec requirements have data-layer support but no screen or behaviour yet: editing an existing session, the organiser's slot override, the duplicate-name warning, and refetching after a realtime disconnect.

**Files:**
- Modify: `src/routes/Admin.tsx`, `src/routes/SessionPage.tsx`, `src/components/ClaimSheet.tsx`, `src/data/useSessionRealtime.ts`
- Test: `src/routes/Admin.test.tsx`, `src/routes/SessionPage.test.tsx`, `src/data/useSessionRealtime.test.tsx` (all extended)

**Interfaces:**
- Consumes: `updateSession` from `src/data/sessions.ts`; `adminClearSlot`, `ownsSlot` from `src/data/slots.ts`; `useAuthUser` from `src/data/auth.ts`.
- Produces: no new modules. `ClaimSheet` gains an optional `duplicateName: string | null` prop and an `isAdmin: boolean` prop with an `onAdminClear: () => void` handler.

- [ ] **Step 1: Write the failing tests**

Append to `src/routes/Admin.test.tsx`:

```tsx
it('edits an existing session, prefilled from its current values', async () => {
  const { updateSession } = await import('../data/sessions')
  auth.email = 'hazmi@example.com'
  view()

  await userEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Sunting' })))
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Tempat').value).toBe('Padang Presint 8'))

  await userEvent.clear(screen.getByLabelText('Yuran (RM)'))
  await userEvent.type(screen.getByLabelText('Yuran (RM)'), '30')
  await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }))

  await waitFor(() => expect(updateSession).toHaveBeenCalledWith('session-1', expect.objectContaining({ feeMyr: 30 })))
})

it('keeps a session editable after it has been closed', async () => {
  auth.email = 'hazmi@example.com'
  listSessions.mockResolvedValue([{ ...SESSION, status: 'closed' }])
  view()
  expect(await waitFor(() => screen.getByRole('button', { name: 'Sunting' }))).toBeTruthy()
})
```

Add `updateSession: (id: string, patch: unknown) => updateSession(id, patch)` to the existing `vi.mock('../data/sessions', ...)` block, with `const updateSession = vi.fn()` alongside the other mocks and `updateSession.mockReset().mockResolvedValue(SESSION)` in `beforeEach`.

Append to `src/routes/SessionPage.test.tsx`:

```tsx
it('warns about a duplicate name but still allows the claim', async () => {
  state.slots = state.slots.map((slot) =>
    slot.id === 'B-GK' ? { ...slot, playerName: 'Hazmi', claimToken: 'other', claimedAt: 'now' } : slot,
  )
  claimSlot.mockResolvedValue({ ...state.slots[0], playerName: 'Hazmi', claimToken: TOKEN })
  view()

  await userEvent.click(screen.getAllByRole('button', { name: /^GK/ })[0] as HTMLElement)
  await userEvent.type(screen.getByLabelText('Nama'), 'Hazmi')

  expect(screen.getByText(/Nama ini dah ada dalam sesi/)).toBeTruthy()

  await userEvent.click(screen.getByRole('button', { name: 'Ambil slot' }))
  await waitFor(() => expect(claimSlot).toHaveBeenCalledWith('A-GK', 'Hazmi'))
})

it('does not warn when the name is unique', async () => {
  view()
  await userEvent.click(screen.getAllByRole('button', { name: /^GK/ })[0] as HTMLElement)
  await userEvent.type(screen.getByLabelText('Nama'), 'Zulazhar')
  expect(screen.queryByText(/Nama ini dah ada/)).toBeNull()
})

it('offers the organiser an override on any occupied slot', async () => {
  authState.email = 'hazmi@example.com'
  state.slots = state.slots.map((slot) =>
    slot.id === 'A-LB' ? { ...slot, playerName: 'Joke Name', claimToken: 'other', claimedAt: 'now' } : slot,
  )
  view()

  await userEvent.click(screen.getAllByRole('button', { name: /^LB/ })[0] as HTMLElement)
  await userEvent.click(screen.getByRole('button', { name: 'Kosongkan slot (admin)' }))
  await waitFor(() => expect(adminClearSlot).toHaveBeenCalledWith('A-LB'))
})

it('does not offer the override to a player', async () => {
  authState.email = null
  state.slots = state.slots.map((slot) =>
    slot.id === 'A-LB' ? { ...slot, playerName: 'Amir', claimToken: 'other', claimedAt: 'now' } : slot,
  )
  view()
  await userEvent.click(screen.getAllByRole('button', { name: /^LB/ })[0] as HTMLElement)
  expect(screen.queryByRole('button', { name: /admin/i })).toBeNull()
})
```

Add to the mocks at the top of that file:

```tsx
const authState = { email: null as string | null, loading: false }
const adminClearSlot = vi.fn()

vi.mock('../data/auth', () => ({ useAuthUser: () => authState }))
```

and extend the existing `vi.mock('../data/slots', ...)` with
`adminClearSlot: (id: string) => adminClearSlot(id),`. Reset both in `beforeEach`
(`authState.email = null`, `adminClearSlot.mockReset().mockResolvedValue(undefined)`).

Note the change this forces: an occupied slot must become tappable for an
admin, so `SlotChip`'s `inert` rule needs an escape hatch. Append to
`src/components/PitchTeam.test.tsx`:

```tsx
it('lets an admin tap an occupied slot owned by someone else', async () => {
  const onSelect = vi.fn()
  render(<PitchTeam {...base} adminOverride onSelect={onSelect} slots={[slot('ST', 'Amir', 'other-token')]} />)
  await userEvent.click(screen.getByRole('button', { name: /ST/ }))
  expect(onSelect).toHaveBeenCalled()
})
```

Append to `src/data/useSessionRealtime.test.tsx`:

```tsx
it('refetches when the channel reports it has reconnected', async () => {
  getSessionWithSlots.mockResolvedValue({ session: SESSION, slots: [GK] })
  render(<Probe id="session-1" />)
  await waitFor(() => expect(getSessionWithSlots).toHaveBeenCalledTimes(1))

  act(() => {
    subscribeCallback?.('SUBSCRIBED')
  })
  act(() => {
    subscribeCallback?.('CHANNEL_ERROR')
  })
  act(() => {
    subscribeCallback?.('SUBSCRIBED')
  })

  // The first SUBSCRIBED is the initial connect and must not refetch; only the
  // one after an error does, because state may have moved on while offline.
  await waitFor(() => expect(getSessionWithSlots).toHaveBeenCalledTimes(2))
})
```

Extend that file's `supabase` mock so `subscribe` captures its status callback:

```tsx
let subscribeCallback: ((status: string) => void) | null = null
// inside the channel mock:
subscribe: (cb?: (status: string) => void) => {
  subscribeCallback = cb ?? null
  return { unsubscribe }
},
```

and reset `subscribeCallback = null` in `beforeEach`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — no `Sunting` button, no `adminOverride` prop, no `duplicateName` warning, and the reconnect case sees only one fetch.

- [ ] **Step 3: Add the reconnect refetch to `src/data/useSessionRealtime.ts`**

Replace the `.subscribe()` call in the realtime effect:

```ts
    let everConnected = false

    const channel = supabase
      .channel(`slots:${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'slots', filter: `session_id=eq.${sessionId}` },
        (payload: { new: unknown }) => {
          try {
            setSlots((current) => replace(current, parseSlot(payload.new)))
          } catch {
            // a malformed payload is dropped rather than taking the page down
          }
        },
      )
      .subscribe((status: string) => {
        // Slots may have changed while the socket was down, so a reconnect
        // refetches rather than trusting what is on screen. The first connect
        // is skipped: the initial load already fetched.
        if (status === 'SUBSCRIBED') {
          if (everConnected) refetch()
          everConnected = true
        }
      })
```

Add `refetch` to that effect's dependency array: `[sessionId, refetch]`. `refetch` is already `useCallback`-stable, so this does not re-subscribe on every render.

- [ ] **Step 4: Add `adminOverride` to `SlotChip`, `PitchTeam` and `ListTeam`**

In `src/components/SlotChip.tsx`, add the prop and relax `inert`:

```tsx
type SlotChipProps = {
  view: SlotView
  label: string
  disabled: boolean
  adminOverride?: boolean
  onSelect: (view: SlotView) => void
}

export function SlotChip({ view, label, disabled, adminOverride = false, onSelect }: SlotChipProps) {
  const name = view.slot?.playerName ?? null
  const taken = name !== null
  // Someone else's slot is inert for players; the organiser can still open it
  // to clear an orphaned or joke entry.
  const inert = disabled || (taken && !view.mine && !adminOverride)
  // ...unchanged below
```

In `src/components/PitchTeam.tsx`, extend the props type and forward the flag:

```tsx
export type TeamViewProps = {
  team: TeamKey
  teamName: string
  slots: readonly Slot[]
  myToken: string | null
  disabled: boolean
  adminOverride?: boolean
  onSelect: (view: SlotView) => void
}
```

Destructure `adminOverride = false` and pass `adminOverride={adminOverride}` to each `<SlotChip>`. Make the identical change in `src/components/ListTeam.tsx`.

- [ ] **Step 5: Add the duplicate warning and admin clear to `src/components/ClaimSheet.tsx`**

Extend the props:

```tsx
type ClaimSheetProps = {
  view: SlotView | null
  teamName: string
  busy: boolean
  duplicateName: boolean
  isAdmin: boolean
  onClose: () => void
  onClaim: (name: string) => void
  onRelease: () => void
  onStartMove: () => void
  onAdminClear: () => void
}
```

In the `view.mine` branch, and in a new branch for an occupied slot the device
does not own, offer the override. Replace the early `if (view.mine)` block with:

```tsx
  const occupiedByOther = view.slot?.playerName != null && !view.mine

  if (view.mine || occupiedByOther) {
    return (
      <Sheet open title={title} onClose={onClose}>
        <p className="mb-4 text-sm text-slate-300">
          {view.mine ? `Slot anda: ${view.slot?.playerName ?? ''}` : view.slot?.playerName ?? ''}
        </p>
        <div className="space-y-2">
          {view.mine && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={onStartMove}
                className="w-full rounded-2xl bg-slate-800 px-4 py-3 text-sm font-semibold active:bg-slate-700"
              >
                Tukar posisi
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onRelease}
                className="w-full rounded-2xl bg-red-500/90 px-4 py-3 text-sm font-semibold text-white active:bg-red-500"
              >
                Lepaskan slot
              </button>
            </>
          )}
          {isAdmin && (
            <button
              type="button"
              disabled={busy}
              onClick={onAdminClear}
              className="w-full rounded-2xl bg-amber-500/20 px-4 py-3 text-sm font-semibold text-amber-200"
            >
              Kosongkan slot (admin)
            </button>
          )}
        </div>
      </Sheet>
    )
  }
```

Add the warning below the name input, before the submit button. It informs
rather than blocks, because nicknames genuinely repeat:

```tsx
      {duplicateName && (
        <p className="mb-2 text-xs text-amber-300">
          Nama ini dah ada dalam sesi. Teruskan jika memang anda.
        </p>
      )}
```

- [ ] **Step 6: Wire it up in `src/routes/SessionPage.tsx`**

Add the imports and derived state:

```tsx
import { useAuthUser } from '../data/auth'
import { SlotActionError, adminClearSlot, claimSlot, moveSlot, releaseSlot } from '../data/slots'
```

```tsx
  const { email: adminEmail } = useAuthUser()
  const isAdmin = adminEmail !== null
  const [pendingName, setPendingName] = useState('')

  const duplicateName =
    pendingName.trim() !== '' &&
    slots.some((slot) => slot.playerName?.toLowerCase() === pendingName.trim().toLowerCase())
```

`ClaimSheet` needs the typed name to detect a duplicate as it is entered, so
lift it: add an `onNameChange` prop to `ClaimSheet` that calls `setPendingName`
on every keystroke, alongside the local `name` state it already keeps. Clear
`pendingName` whenever `selected` changes.

Add the clear handler:

```tsx
  async function onAdminClear() {
    const slot = selected?.slot
    if (slot === undefined || slot === null) return
    setBusy(true)
    try {
      await adminClearSlot(slot.id)
      applyLocal({ ...slot, playerName: null, claimToken: null, claimedAt: null })
      setSelected(null)
    } catch {
      show('Gagal mengosongkan slot.', 'error')
      refetch()
    } finally {
      setBusy(false)
    }
  }
```

Pass `adminOverride={isAdmin}` to each `<TeamView>`, and the new props to
`<ClaimSheet>`: `duplicateName`, `isAdmin`, `onAdminClear={() => void onAdminClear()}`.

Also fix the sheet title, which currently reads `Team A — GK` rather than
naming the colour:

```tsx
        teamName={selected?.slot === undefined || selected.slot === null
          ? ''
          : `Team ${selected.slot.team} ${session.teamNames[selected.slot.team]}`}
```

- [ ] **Step 7: Add session editing to `src/routes/Admin.tsx`**

Track which session is being edited, and reuse `SessionForm`:

```tsx
import { createSession, deleteSession, listSessions, nextSessionNo, setSessionStatus, updateSession } from '../data/sessions'
```

```tsx
  const [editing, setEditing] = useState<Session | null>(null)

  function openEdit(session: Session) {
    setEditing(session)
    setFormValues({
      sessionNo: session.sessionNo,
      title: session.title,
      playDate: session.playDate,
      startTime: session.startTime.slice(0, 5),
      durationMins: session.durationMins,
      venue: session.venue,
      feeMyr: session.feeMyr,
      teamAName: session.teamNames.A,
      teamBName: session.teamNames.B,
      teamCName: session.teamNames.C,
    })
  }
```

Make `submit` branch on whether it is editing. Every field stays editable
after creation, including the fee:

```tsx
  async function submit(values: SessionFormValues) {
    setBusy(true)
    try {
      const payload = {
        sessionNo: values.sessionNo,
        title: values.title,
        playDate: values.playDate,
        startTime: values.startTime,
        durationMins: values.durationMins,
        venue: values.venue,
        feeMyr: values.feeMyr,
        teamAName: values.teamAName,
        teamBName: values.teamBName,
        teamCName: values.teamCName,
      }

      if (editing !== null) {
        await updateSession(editing.id, payload)
        show('Sesi dikemas kini.')
      } else {
        await createSession(payload)
        show('Sesi dicipta.')
      }

      setFormValues(null)
      setEditing(null)
      await reload()
    } catch {
      show(editing !== null ? 'Gagal mengemas kini sesi.' : 'Gagal mencipta sesi.', 'error')
    } finally {
      setBusy(false)
    }
  }
```

Add a `Sunting` button to each session row, next to `Buka`:

```tsx
              <button
                type="button"
                onClick={() => openEdit(session)}
                className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold"
              >
                Sunting
              </button>
```

And make the sheet's label reflect the mode:

```tsx
        <Sheet open title={editing !== null ? 'Sunting sesi' : 'Sesi baru'} onClose={() => { setFormValues(null); setEditing(null) }}>
          <div className="max-h-[70vh] overflow-y-auto">
            <SessionForm
              initial={formValues}
              submitLabel={editing !== null ? 'Simpan perubahan' : 'Cipta sesi'}
              busy={busy}
              onSubmit={(v) => void submit(v)}
            />
          </div>
        </Sheet>
```

`openNew` and `openDuplicate` must both `setEditing(null)` so a create never
posts as an edit.

- [ ] **Step 8: Run everything to verify it passes**

```bash
pnpm test && pnpm typecheck && pnpm test:db && pnpm test:int && pnpm build && pnpm e2e
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add session editing, admin slot override, duplicate-name warning and reconnect refetch"
```

---

## Coverage

Every spec section maps to a task:

| Spec section | Task |
|---|---|
| Architecture, GitHub Pages specifics | 1, 15 |
| Data model (`sessions`, `slots`) | 4 |
| Identity: the claim token | 6 |
| Security model (RLS, RPCs, locking) | 5, 7 |
| Realtime | 8, 16 |
| `/` session list | 12 |
| `/s/:id` session page, pitch layout, list toggle | 10, 11 |
| `/admin` login, create, duplicate, edit, close, delete, clear slot | 13, 16 |
| "Salin untuk WhatsApp" | 3, 11 |
| Error handling table | 5, 11, 12, 13, 16 |
| Language (Malay) | 2, 6, and all UI tasks |
| Testing (unit, SQL, e2e) | 2–8, 14 |
| Deployment | 15 |
| Known limitations | documented in 15's README |
