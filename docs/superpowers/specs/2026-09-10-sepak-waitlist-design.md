# Sepak — Waitlist (Increment 2)

**Date:** 2026-09-10
**Status:** Approved design, awaiting spec review
**Builds on:** `2026-09-10-sepak-booking-design.md` (the MVP)

## Purpose

When all 33 slots are taken, a player can join a waitlist with the positions
they are willing to play. The moment a matching slot frees up — someone
releases it, someone moves away from it, or the organiser clears it — the
longest-waiting player whose preferences include that position is placed into
it automatically.

Today a full list means the conversation moves to WhatsApp: "aku standby",
"kalau ada orang tarik diri bagitahu". The organiser then has to remember who
asked first. This makes that queue explicit and self-serving.

## Success criteria

1. A player joins the waitlist in under fifteen seconds, on a phone, without an account.
2. Joining with a preference that is *already* free claims the slot immediately rather than queueing.
3. When a slot frees, the correct player is placed into it with no organiser action.
4. Auto-fill cannot be raced, double-filled, or skipped, however the slot came free.
5. Nobody occupies a slot and a waitlist place at the same time.

## Non-goals

- Notifications of any kind. A placed player finds out by looking at the page
  (which updates live) or from the organiser's WhatsApp paste. No push, SMS,
  email, or WhatsApp integration — that would require a server and end the
  RM 0 property.
- Priority, seniority, or reputation. Strict first-come-first-served.
- Waitlisting for a *better* position while already holding a slot.
- A cap on waitlist length.
- Position-specialist preference (a GK-only waiter does not jump an
  earlier any-position waiter for a GK slot).

## Decisions taken

**Ordering is strict FIFO.** The earliest `created_at` whose position set
includes the freed position wins. Simple, explainable to the group, and
impossible to game. The accepted cost: someone who lists only GK may wait a
long time, which is their own choice and visible to them.

**A player is either in a slot or on the waitlist, never both.** Joining
requires holding no slot in that session; being placed deletes the waitlist
row. This stops one person taking two of the 33 places.

**Notification is the page itself.** The slot fills over the existing realtime
subscription, and the device knows the slot is its own through the same
`my_slot_ids` mechanism the MVP uses.

## Data model

### `waitlist`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `session_id` | `uuid` fk → sessions, on delete cascade | |
| `player_name` | `text` | trimmed, 1–40 chars |
| `claim_token` | `uuid` | the device's token — **never readable by `anon`** |
| `positions` | `text[]` | acceptable positions; non-empty, each one of the eleven |
| `created_at` | `timestamptz` | the queue order |

Constraints:

- `unique (session_id, claim_token)` — one entry per device per session.
- `check (array_length(positions, 1) between 1 and 11)`.
- `check (positions <@ array['GK','LB','CB1','CB2','RB','DM','MC','AM','LWF','RWF','ST'])`
  — the set is validated in the database, not only in the client.
- Index on `(session_id, created_at)`, which is the order auto-fill reads.

`positions` stores the **expanded set**, not a preset name. "Semua posisi" and
"Semua kecuali GK" are buttons in the UI that fill in all eleven or all but
`GK`; the database knows only sets. This keeps a future custom selection from
being a special case, and means `CB1`/`CB2` are simply both present.

## Security model

Identical in shape to the MVP's, and for the same reason: the token is a
secret the device **presents**, never a value the server hands out.

| Role | `waitlist` |
|---|---|
| `anon` | `select (id, session_id, player_name, positions, created_at)` — **not `claim_token`** |
| `authenticated` | full |

`anon` gets no direct DML. All player mutations go through
`SECURITY DEFINER` functions:

- `join_waitlist(p_session_id uuid, p_name text, p_positions text[], p_token uuid) returns jsonb`
  Validates the name (trimmed, 1–40), that the session is `open`, that
  `p_positions` is a non-empty subset of the eleven, that this device holds no
  slot in the session, and that it has no existing waitlist entry.
  **If any position in the set is already free, it claims that slot
  immediately** — earliest in pitch order — and returns
  `{"placed": true, "slot_id": "…"}` rather than queueing. Otherwise it
  inserts the waitlist row and returns `{"placed": false, "waitlist_id": "…"}`.
  Errors: `invalid_name`, `session_closed`, `invalid_positions`,
  `already_in_slot`, `already_waitlisted`, `invalid_token`.
- `leave_waitlist(p_session_id uuid, p_token uuid) returns void`
  Errors: `not_waitlisted`.
- `my_waitlist_entry(p_session_id uuid, p_token uuid) returns table(id uuid, positions text[], created_at timestamptz)`
  The device learns its own entry by presenting the token, mirroring
  `my_slot_ids`.

Every function pins `search_path = public, pg_temp`, and each is
`revoke all … from public` then granted to `anon, authenticated`.

## Auto-fill

A trigger on `slots`, `after update`, firing when `player_name` transitions
from non-null to null and the session is `open`:

1. Lock the freed slot row.
2. Select the earliest `waitlist` row for that session where
   `slots.position = any(waitlist.positions)`, `for update skip locked`.
3. If one exists, write its name and token into the slot and delete the
   waitlist row — in the same transaction as the release.

Why a trigger rather than logic inside `release_slot`: the slot can also be
freed by `move_slot` vacating its source and by the organiser's admin clear.
A trigger covers all three paths and cannot be forgotten by a future caller.
Being in the releasing transaction is what makes it unraceable — there is no
window in which the slot is visibly empty and unclaimed.

**Recursion is not a risk:** the trigger's own write moves `player_name` from
null to non-null, which does not satisfy the firing condition.

**Chained fills do not occur**, because a waitlisted player holds no slot —
placing them frees nothing.

`move_slot` is the interesting interaction: vacating the source may
immediately hand it to a waitlister, which is correct and desirable.

## UI

### Session page additions

- When every slot is taken, the empty-slot affordance is replaced by
  **"Sertai senarai tunggu"**.
- The button is also available whenever the device holds no slot, so a player
  can queue for a specific position that is currently occupied without waiting
  for the list to fill.
- **Waitlist sheet:** name field, then position selection — a tappable grid of
  the eleven positions, plus two presets, **"Semua posisi"** and **"Semua
  kecuali GK"**. At least one position must be chosen.
- **The queue is visible to everyone**, in order, showing each player's name
  and their positions (`Semua`, `Semua kecuali GK`, or the list). Consistent
  with the booking list itself being public.
- The device's own entry is highlighted and offers **"Keluar dari senarai
  tunggu"**.
- If joining results in an immediate placement, the sheet closes and the
  claimed slot is highlighted — the player sees they are in the game, not in a
  queue.

### WhatsApp text

A **`Senarai Tunggu`** block is appended when the waitlist is non-empty:

```
Senarai Tunggu
1. Faiz (Semua kecuali GK)
2. Nabil (MC, AM)
```

Omitted entirely when empty, so the existing message is unchanged for a
session with no queue.

## Error handling

| Case | Behaviour |
|---|---|
| Joining while holding a slot | "Anda dah ada slot dalam sesi ini." |
| Joining twice from one device | "Anda dah dalam senarai tunggu." |
| No position selected | Inline validation, no request sent |
| Joining a closed session | "Sesi dah ditutup." |
| Two devices join as the last matching slot frees | The trigger's `for update` serialises them; one is placed, the other stays queued |
| Leaving when not queued | "Anda tak dalam senarai tunggu." |

## Testing

- **SQL:** `anon` cannot read `waitlist.claim_token` or write the table
  directly; the positions subset and non-empty checks fire; FIFO order is
  respected when two entries match; a narrower-but-later entry does **not**
  jump an earlier broader one; `join_waitlist` claims immediately when a
  preferred slot is free; the slot-and-waitlist invariant holds both ways;
  auto-fill fires on `release_slot`, on `move_slot`'s vacated source, and on
  an admin clear; auto-fill does **not** fire on a closed session; the trigger
  does not recurse.
- **Integration:** the four RPC wrappers against local Postgres, including two
  concurrent `join_waitlist` calls racing one free slot.
- **End-to-end:** two browsers — one holding a slot, one waitlisted; the first
  releases; the second's page shows them placed **without a reload**, proving
  auto-fill reaches the client over realtime.
- **Unit:** the preset expansion (all / all-except-GK), the positions summary
  formatter, and the WhatsApp block including the empty-waitlist case.

## Known limitations

Accepted deliberately:

1. A placed player is not actively told; they must look at the page or the
   group. This is the main functional cost of having no backend.
2. A GK-only waiter can be passed over indefinitely by earlier broad entries.
3. Losing `localStorage` orphans a waitlist entry as it orphans a slot; the
   organiser can delete it.
4. Anyone with the link can join the waitlist under any name, as with slots.
5. No cap on waitlist length.
