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
