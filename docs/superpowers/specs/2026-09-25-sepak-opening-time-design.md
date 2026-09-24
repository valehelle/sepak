# Opening time (Dibuka pada) — design

Status: built on branch `feat/opening-time`, not merged. Agreed with the organiser on 2026-09-25.

## Problem

A session link goes out to the group before booking should start. Today the
slots are open from the moment the session is created, so whoever sees the
link first books first, and the fastest people to read WhatsApp take the
places before most of the group has seen the message.

## What it does

- Every session has an opening time. The admin sets it on the session form
  ("Dibuka pada"). It is required: the form will not save without it.
- Before the opening time:
  - anyone with the link sees the whole page: date, venue, teams, pitches;
  - a big timer counts down every second, with the opening time under it
    (for example "Khamis 25/09, 9:00 PM");
  - claiming a slot, moving and joining the queue are locked, on the page
    and on the server;
  - an admin can still book or move their own slot. Admins book only
    themselves, never other people;
  - the admin can change the opening time: postpone it or bring it earlier.
- At the opening time the slots unlock by themselves on every open page, with
  no refresh. Nothing runs on the server at that moment.
- Once the opening time has passed, it is locked for good. Nobody can change
  it, including admins and direct database edits. This stops an admin from
  opening a session, letting friends book, and closing it again.
- Every change to the opening time is logged in the admin activity feed
  ("Masa dibuka ditukar: Khamis 9:00 PM → Khamis 8:00 PM").
- While the session is not open yet, the WhatsApp message carries a line
  `⏰ Dibuka: <day> <date>, <time>`.
- No notifications at the opening time.

## Why the queue is locked too

Joining the queue while a chosen position is empty seats you in it straight
away (join_waitlist). Before opening every slot is empty, so an open queue
would be a way to book early.

## Keeping 200 phones fair

The server decides, not the phones. claim_slot, move_slot and join_waitlist
each compare the session's opening time against the database's now() on every
call. A tap that arrives before the opening time is refused with
`not_open_yet`, whatever the phone shows.

The countdown runs on server time, not the phone's clock:

- On load, the page calls `server_now()` and measures the round trip, and
  keeps the difference between the phone's clock and the server's. That is
  usually accurate to about 0.1 s, even when the phone's clock is minutes off.
- It re-syncs when the page comes back from the background or the lock
  screen, because phones pause timers there.
- A tap refused with `not_open_yet` in the last moment is retried once,
  automatically, shortly after.

The server does not send an "it is open" message. That would depend on the
live connection (capped at roughly 200 browsers on the free plan, shared
with the other app in the same Supabase project), on a job firing exactly on
time, and on the message reaching 200 phones one after another. Each phone
unlocking from its own synced countdown is closer to simultaneous and does
not depend on any of those.

### When the admin changes the time

- Pages with a live connection get the new time within a second or so, and
  the countdown jumps to it, with a short note "Masa dibuka ditukar ke …".
  This needs `sepak.sessions` added to the realtime publication (anon can
  already read every column of sessions, so nothing new is exposed).
- A live connection can drop without the page noticing (locked phone, wifi to
  4G, over the cap), and Supabase does not replay what was missed. So when a
  page's countdown reaches zero, it asks the server for the current opening
  time before unlocking. If the time moved, it restarts the countdown
  instead. That is one small read per user at the moment of opening.
- If even that fails (no internet), the page unlocks, and every tap is
  refused by the server with "Belum dibuka"; the page then fetches the new
  time and counts down again.

### What cannot be made equal

Network speed. Someone on fast wifi reaches the server a fraction of a second
before someone on weak 4G. The server serves in order of arrival.

## Database changes

One migration, pasted by hand in the Supabase SQL editor before the frontend
ships (see the deploy order note in memory).

- `sessions.opens_at timestamptz not null`. Existing sessions are backfilled
  with `created_at`, so everything already running stays open. The column
  default is `now()`, for direct inserts only (tests, seeding).
- `open_to_caller(session_id)`: true when `opens_at <= now()` or the caller
  is an admin.
- The check `not_open_yet` added to `claim_slot`, `move_slot` and
  `join_waitlist`, right after the existing `session_closed` check.
  `release_slot` is not gated: leaving is always allowed.
- `server_now()`, callable by anon, for the countdown.
- A BEFORE UPDATE trigger on `sessions` refusing any change to `opens_at`
  once `OLD.opens_at <= now()`. On the table, so no RPC or admin edit can get
  round it.
- An activity line for every change to `opens_at` (new kind, for example
  `opens_changed`, with the old and new times).
- `create_session` gets a `p_opens_at` parameter.
- `sepak.sessions` added to the `supabase_realtime` publication.

The migration is `supabase/migrations/0018_opens_at.sql`, tested by `supabase/tests/opens_test.sql`.

Shown and entered in Malaysia time (UTC+8, no daylight saving) whatever the
phone's own time zone, like the session's date and start time.

## Frontend changes

- Session form: "Dibuka pada" as a required `datetime-local`, converted to
  and from the browser's local time zone. Duplicating a session leaves it
  empty, so it has to be set each time. Once a session's opening time has
  passed, the field is shown but disabled, with a note that it can no longer
  change.
- `Session.opensAt` parsed from `opens_at`.
- A server-clock hook (offset from `server_now()`, re-synced on
  `visibilitychange`).
- A countdown component: large ticking `HH:MM:SS` (days shown when more than
  24 hours away), the opening time underneath.
- Session page: while not open, slots are disabled and the booking panel and
  the "Sertai senarai tunggu" button are replaced by the countdown. For an
  admin, the countdown shows with a line saying they can book early.
- At zero: re-read the opening time, then unlock or restart.
- New error message for `not_open_yet`: "Belum dibuka. Tunggu kiraan tamat."
- WhatsApp message: the `⏰ Dibuka:` line while not open.

## Tests

- SQL: refusals before opening for claim, move and queue; admin allowed;
  a player presenting an admin's device token still refused; release always
  allowed; opens at the time with nothing running; changing `opens_at` before
  opening allowed and logged; changing it after opening refused for everyone,
  including admins and direct updates.
- Unit: countdown formatting and ticking with fake timers; the page locked and
  then unlocking at zero; the recheck at zero restarting the countdown when
  the time moved; the form requiring the field and disabling it once passed;
  the WhatsApp line.
- Integration: an anon client refused with `not_open_yet` against the local
  stack; `server_now` reachable.
- e2e: a session opening a few seconds after the page loads unlocks without a
  reload; an admin change to the time reaches a second browser live.
