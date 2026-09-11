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

Sepak needs **its own Supabase project**, not a schema inside someone else's.

It lives in a dedicated `sepak` schema rather than `public`, which keeps its
objects clearly delineated — but a schema is not an isolation boundary. One
Supabase project has **one anon key and one `auth.users` pool**, and the anon
key necessarily ships inside this app's public JavaScript bundle. So anyone
who opens devtools on the booking page can call `GET /rest/v1/` with that key
and enumerate every table and column in the whole project, and anyone given
an organiser login becomes an `authenticated` user of that project — which is
enough to read any other app there whose policies trust `authenticated`
(the common default). Both were demonstrated, not assumed.

Share a project only if every app in it is yours *and* you accept that its
users can reach the others.

1. Create (or reuse) a Supabase project. Apply migrations: `supabase link`
   then `supabase db push` — the first migration creates the `sepak` schema
   itself, so no manual schema-creation step is needed first.
2. In the dashboard, go to **Settings → API → Exposed schemas** and add
   `sepak`. **Do not skip this.** Without it PostgREST serves none of this
   app's tables or functions even though the migrations applied cleanly — the
   site loads and then every request 404s, which looks like a broken app
   rather than a missing setting.
3. **Sign-ups are disabled in the committed config**, and each organiser's
   login is created from the dashboard (Authentication → Users), then their
   email added to `sepak.admins` (see
   `supabase/migrations/0006_admins.sql`). Authorisation comes from that
   allowlist, so a login on its own grants nothing.

   You *may* enable sign-ups on a dedicated project if you would rather
   admins set their own passwords — the allowlist still gates everything, and
   a stranger who registers gets no access. Do not enable them on a project
   shared with another app, for the reason above.
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
