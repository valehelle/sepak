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

Sepak lives in its own `sepak` schema so it can share one Supabase project
with an unrelated app that already owns `public` (Supabase's Free plan caps
active projects at two). This app owns nothing in `public` and must never be
given anything there.

1. Create (or reuse) a Supabase project. Apply migrations: `supabase link`
   then `supabase db push` — the first migration creates the `sepak` schema
   itself, so no manual schema-creation step is needed first.
2. In the dashboard, go to **Settings → API → Exposed schemas** and add
   `sepak` alongside whatever the other app already exposes. Without this,
   PostgREST will not serve any of this app's tables or functions, even
   though the migrations applied cleanly.
3. **Keep sign-ups disabled** (Authentication → Providers → Email, or
   `[auth] enable_signup` if you manage this project's config in code). This
   matters more than it would for a dedicated project: `auth.users` here is
   **shared with the other app**, so an open sign-up would let a stranger
   register themselves as an `authenticated` user against that app too, not
   just this one. Create the organiser account(s) from the dashboard
   instead, then add their email to `sepak.admins` (see
   `supabase/migrations/0006_admins.sql`).
4. Add repository *variables* (not secrets) `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`. They ship inside the public bundle by design.
5. Enable Pages with the GitHub Actions source. Push to `main`.

The `service_role` key is never committed and never used by the app.

## Security model

The booking list is public: anyone with the link can read it and claim a slot.
That is deliberate — it replaces a WhatsApp message.

Enforcement lives in Postgres, not in the client. `anon` has read-only table
access and may execute exactly three functions (`claim_slot`, `release_slot`,
`my_slot_ids`), each of which row-locks (or, for `my_slot_ids`, simply reads)
before deciding. Every device holds a UUID in `localStorage`; presenting it
is what authorises releasing a slot, so a player can edit their own booking
and nobody else's.

Known limitations, accepted deliberately:

1. Anyone with the link can claim a slot, under any name.
2. Clearing browser data orphans a slot until the admin clears it.
3. Three teams of eleven is hard-coded; five-a-side needs a schema change.
4. There is no audit trail of claims and releases.
