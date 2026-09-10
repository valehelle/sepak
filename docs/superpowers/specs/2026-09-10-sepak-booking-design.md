# Sepak — Football Session Booking

**Date:** 2026-09-10
**Status:** Approved design

## Purpose

A mobile-first website that replaces the weekly WhatsApp position list. An
admin creates a session (date, time, venue, fee); players open a shared link
and tap the position they want to play. Three teams of eleven, two hours.

Today the list lives in a WhatsApp message that anyone can overwrite, where
two players can claim the same position without noticing, and where the
organiser retypes the whole thing every week. This fixes those three
problems and nothing else.

## Success criteria

1. A player claims a position in under ten seconds, on a phone, without an account.
2. Two players claiming the same slot at the same time — one wins, the other is told immediately.
3. The organiser creates next week's session in two taps.
4. The list can still be pasted into WhatsApp, in the existing format.
5. Runs on free infrastructure indefinitely.

## Non-goals

- Payment collection or tracking. The fee is displayed only; money is settled in the group.
- Player accounts, profiles, attendance history, or statistics.
- Private or invite-only sessions. Anyone with the link can claim.
- Multiple concurrent organisers, roles, or permissions beyond one admin.
- Notifications, reminders, or calendar integration.
- Configurable formations or team counts. Three teams of eleven, fixed.

## Architecture

A static single-page app talking directly to Supabase. There is no
application server.

```
Browser (React SPA, static files)
  |
  |-- anon key ---> Supabase
  |                   |- Postgres (sessions, slots)
  |                   |- Realtime (slot changes broadcast)
  |                   |- Auth (admin only)
  |                   `- RLS + RPCs (the security boundary)
  |
  `-- served from GitHub Pages
```

**Stack:** Vite + React + TypeScript, Tailwind CSS, `@supabase/supabase-js`.
**Host:** GitHub Pages, public repo, deployed by GitHub Actions.
**Database:** Supabase free tier.

### Why no server

Every write is either a read anyone may perform or a mutation expressible as
a database function. Putting the rules in Postgres rather than in a Node
process removes the only component that would cost money, and makes the
rules enforceable rather than merely implemented — a client editing the
JavaScript bundle gains nothing.

### GitHub Pages specifics

- Vite `base` is set to the repository name, since the site is served from a subpath.
- The build copies `index.html` to `404.html`. GitHub Pages has no rewrite
  rules, so this is what makes a deep link such as `/s/12` survive a direct
  open or a refresh.
- The `service_role` key is never committed and never referenced by
  application code. The anon key is embedded in the bundle, which is
  expected: it is public by design and constrained entirely by RLS.

## Data model

### `sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `session_no` | `int` | display number, e.g. 5 → "Sesi 005" |
| `title` | `text` | e.g. "Geng Turun Peluh" |
| `play_date` | `date` | day name derived at render, never stored |
| `start_time` | `time` | |
| `duration_mins` | `int` | default 120 |
| `venue` | `text` | |
| `fee_myr` | `numeric(6,2)` null | null or 0 means free; the fee line is then omitted everywhere |
| `team_a_name` | `text` | default "Merah" |
| `team_b_name` | `text` | default "Putih" |
| `team_c_name` | `text` | default "Kuning" |
| `status` | `text` | `open` or `closed`; closed rejects claims |
| `created_at` | `timestamptz` | |

Every field is editable after creation, including `fee_myr` — fees change,
venues get switched, kick-off slips.

### `slots`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `session_id` | `uuid` fk → sessions, on delete cascade | |
| `team` | `text` | `A`, `B`, or `C` |
| `position` | `text` | one of the eleven, below |
| `player_name` | `text` null | null means empty |
| `claim_token` | `uuid` null | the claiming device's token |
| `claimed_at` | `timestamptz` null | |

Constraints: `unique (session_id, team, position)`, and a check that
`player_name`, `claim_token` and `claimed_at` are either all null or all
non-null. A slot is therefore never half-claimed.

**The eleven positions**, in pitch order back to front:
`GK, LB, CB1, CB2, RB, DM, MC, AM, LWF, RWF, ST`.

`CB1`/`CB2` are stored distinctly and both render as "CB", because the
source format lists two centre-backs and a unique constraint needs to tell
them apart.

Thirty-three slots exist per session from the moment it is created.

## Identity: the claim token

There are no player accounts. On first visit the app generates a UUID and
stores it in `localStorage` as the device's `claim_token`. Claiming a slot
writes that token alongside the name; releasing or moving a slot requires
presenting it.

This means a player can free or move **their own** slot and nobody else's.
It deliberately does not prevent someone typing another player's name into
a slot — that is a social problem, and the admin override is the answer.

Consequences accepted: clearing browser data or switching phones orphans a
slot, which the admin can clear. This is the correct trade for a booking
list that must be usable in ten seconds by people who will not create an
account.

## Security model

RLS is enabled on both tables and is the whole enforcement story.

| Role | `sessions` | `slots` |
|---|---|---|
| `anon` | select (all columns) | select, **excluding `claim_token`** |
| `authenticated` | select, insert, update, delete | select, insert, update, delete |

> **Correction (found in review):** the design originally specified a
> table-wide `select` grant to `anon` on `slots`, with no column exclusion.
> That would have let any visitor read every claim's `claim_token` straight
> off the row — the very value `release_slot`/`move_slot` treat as proof of
> ownership — defeating the whole "presenting the token authorises you"
> model. What shipped instead is a column-level grant
> (`grant select (id, session_id, team, position, player_name, claimed_at)
> on public.slots to anon`, see `supabase/migrations/0002_rls.sql`) that
> excludes `claim_token` entirely.

`anon` has **no** direct write access, and cannot read `claim_token` off
`slots` at all. Player mutations, and the one ownership lookup a device
needs, happen only through `SECURITY DEFINER` functions — five of them in
total, four of which `anon` may execute:

- `claim_slot(p_slot_id uuid, p_name text, p_token uuid)` — claims an empty
  slot in an open session. Errors: `slot_taken`, `session_closed`,
  `invalid_name`.
- `release_slot(p_slot_id uuid, p_token uuid)` — empties a slot only when
  the token matches. Errors: `wrong_token`, `slot_empty`, `session_closed`.
- `move_slot(p_from uuid, p_to uuid, p_token uuid)` — releases and claims in
  one transaction, so a move cannot lose the player's place. Errors as above.
- `my_slot_ids(p_session_id uuid, p_token uuid)` — the read side of
  ownership: returns the ids of slots claimed with the presented token, and
  nothing else (no names, no tokens). Since `claim_token` is not readable
  off `slots` directly, this is the only way a device learns which slots
  are its own. It explicitly raises if called inside a read-only
  transaction, which is what PostgREST always uses for GET/HEAD regardless
  of a function's declared volatility — so this refuses GET (which would
  put the token in the URL, and therefore in access logs and browser
  history) and only ever succeeds over POST.
- `create_session(...)` — **`authenticated`-only**, not executable by
  `anon`. Inserts the session and its thirty-three slots in one
  transaction, so a session is never half-built.

Ownership of a slot is therefore proven by *presenting* `claim_token` to one
of these functions, never by reading it back off `slots` — the column grant
above makes that structurally true, not just conventional.

Each of `claim_slot`/`release_slot`/`move_slot` locks the target rows
(`select ... for update`) before mutating, which is what makes the
simultaneous-claim case resolve to exactly one winner rather than a lost
update.

Name input is trimmed, limited to 40 characters, and rejected if empty.
Names are rendered as text, never as markup.

Sign-ups are disabled in the Supabase project. The single admin user is
created from the dashboard.

## Realtime

The session page subscribes to `postgres_changes` on `slots`, filtered to
that `session_id`. Slots fill and empty live while several people book at
once, which is the behaviour the WhatsApp message cannot offer and the main
reason players will trust the list.

The subscription is torn down on unmount. If the socket drops, the client
refetches the session on reconnect rather than trusting stale state.

## Screens

All layouts are designed at 390px first and widen from there.

### `/` — session list

Upcoming sessions as cards: session number, title, date with day name, time,
venue, fee, and fill count ("24/33 penuh"). Past sessions collapse below.

### `/s/:id` — the session

The screen that matters. Header carries the session details in the familiar
order — Tarikh, Masa, Tempat, Yuran — followed by three teams.

Each team renders as **a pitch**, not a list: GK at the back, then
LB-CB-CB-RB, then DM-MC-AM, then LWF-RWF-ST. Position is spatial, so a
player finds their slot by looking where they play rather than by reading
eleven labels. A list-view toggle is available and its choice is remembered.

- Tapping an empty slot opens a sheet asking for a name, then claims it.
- Tapping your own slot offers release or move.
- Tapping someone else's slot does nothing.
- Your slot is highlighted and summarised at the top of the page.
- A closed session shows the list read-only with a "Sesi ditutup" banner.

### `/admin` — organiser

Email and password login. Then: create session, edit or reschedule any
session, close a session, clear any slot, delete a session.

**"Duplikasi sesi lepas"** clones the previous session's venue, time,
duration, fee and team names, leaves every slot empty, increments the
session number, and asks only for the new date. This is the two-tap path
for a weekly fixture and the button the organiser will use most.

### "Salin untuk WhatsApp"

Regenerates the existing message format exactly — emoji, bold date, day
name, team headings, `POSITION- name` lines with empty positions left blank
— and copies it to the clipboard. The fee line is omitted when there is no
fee. This keeps the site compatible with the group rather than competing
with it.

## Error handling

| Case | Behaviour |
|---|---|
| Simultaneous claim | Loser sees "Slot dah diambil"; realtime already shows the winner |
| Claim on closed session | "Sesi dah ditutup", list becomes read-only |
| Release without matching token | "Slot ini bukan milik anda" |
| Empty or whitespace name | Inline validation, no request sent |
| Network failure | Optimistic update reverts, toast offers retry |
| Realtime disconnect | Silent reconnect, then refetch |
| Unknown session id | "Sesi tak dijumpai" with a link home |
| Duplicate name in a session | Allowed with a warning; nicknames genuinely repeat |

Writes are optimistic, because a booking that feels instant is the point,
and every one of them is reverted on failure.

## Language

The interface is Malay, matching the group: Tarikh, Masa, Tempat, Yuran,
Sesi, Pasukan. Position abbreviations stay in their conventional English
form (GK, CB, ST) as footballers use them.

## Testing

- **Unit (Vitest):** the WhatsApp formatter against the original message as a
  snapshot, including the no-fee variant; day-name derivation; pitch layout
  mapping; name validation.
- **SQL:** RLS denies `anon` direct writes to both tables; `release_slot`
  rejects a wrong token; `claim_slot` on an occupied slot raises
  `slot_taken`; two concurrent `claim_slot` calls produce exactly one winner;
  `create_session` yields exactly thirty-three slots and rolls back whole on
  failure.
- **End-to-end (Playwright, local Supabase):** claim, release, move; two
  browser contexts racing one slot; realtime propagation between contexts;
  deep link and refresh on `/s/:id` against the built site, which is what
  proves the `404.html` step works.

## Deployment

GitHub Actions builds on push to `main` and publishes to Pages. Supabase URL
and anon key are injected at build time from repository variables — not
secrets, since they end up in the public bundle regardless. Schema changes
live in `supabase/migrations` and are applied with the Supabase CLI.

## Known limitations

Accepted deliberately, recorded so they are not rediscovered as bugs:

1. Anyone with the link can claim a slot, and can claim it under any name.
2. Losing `localStorage` orphans a slot until an admin clears it.
3. Three teams of eleven is hard-coded. A five-a-side session needs a schema change.
4. No audit trail of who claimed or released what.
