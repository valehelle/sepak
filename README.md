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
3. In the dashboard, go to **Authentication → Sign In / Providers → Email**
   and turn **Confirm email off**. Sign-ups are open: a new organiser
   registers themselves at `/admin` ("Admin baru? Daftar di sini") once a
   super admin has added their email on the admin page. Authorisation comes
   from that allowlist (`sepak.admins`, migration `0006_admins.sql`), so a
   stranger who registers gets no access.

   With Confirm email left on, registration silently breaks: the account is
   created with no session, and Supabase's built-in mailer refuses to deliver
   the confirmation to anyone outside the project's team. The form now says
   so instead of claiming success, but the fix is the dashboard toggle.

   Do not share the project with another app: an open sign-up would also
   create a user in that app's `auth.users`.
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

Phone numbers are the one private thing collected. They live in
`sepak.contacts`, a table with no grant to `anon` or `authenticated` and
outside the Realtime publication, so they never appear in the public read
or the live feed. The only way to read one is `contact_phone()`, which
checks the admin allowlist itself. Admins see a number by tapping a filled
slot, or "Lihat nombor" on a queue entry. The device also remembers its
last name and number in `localStorage` to prefill the next booking.

One booking per person per session: `claim_slot` refuses a device that
already holds a slot, and refuses a phone number already on a slot or in the
queue anywhere in that session (`already_in_slot` / `phone_in_use`). The
device check alone was not enough -- a second browser mints a fresh token --
so the number is the real guard. Duplicate names stay allowed, since two
players really are sometimes both called Amir.

The index page lists nothing. Sessions are reached by their own link, shared
in the group chat; organisers see the full list on `/admin`. Note this is
about the page, not the data: `sepak.sessions` is still world-readable
through the API, as the link-sharing model has always assumed.

Known limitations, accepted deliberately:

1. Anyone with the link can claim a slot, under any name and any phone
   number they care to type -- numbers are not verified, only deduplicated.
2. Clearing browser data orphans a slot until the admin clears it.
3. Three teams of eleven is hard-coded; five-a-side needs a schema change.
4. There is no audit trail of claims and releases.
