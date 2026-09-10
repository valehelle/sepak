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

-- This local stack matches the new Supabase cloud default (see
-- supabase/config.toml, api.auto_expose_new_tables): a table created by
-- `postgres` grants nothing to anon/authenticated until stated explicitly.
-- RLS policies alone do not expose a table -- Postgres also requires the
-- underlying table-level privilege -- so each role's access is granted here
-- to match the policies above.

-- authenticated (the organiser) sees and writes everything, tokens included.
grant select, insert, update, delete on public.sessions, public.slots to authenticated;

-- anon gets read-only access, and nothing else. Revoke-all-then-regrant (not
-- a narrower revoke of insert/update/delete alone) matters here: Supabase's
-- default ACL also hands anon TRUNCATE, TRIGGER and REFERENCES on every new
-- table, and CREATE POLICY has no TRUNCATE form -- RLS cannot gate it, so it
-- can only be closed by revoking it outright.
revoke all on public.sessions from anon;
revoke all on public.slots    from anon;

grant select on public.sessions to anon;
-- claim_token is deliberately excluded: it is a secret the device PRESENTS
-- to prove ownership, never a value the server hands out. A whole-table
-- grant here would let any visitor read another player's token and then
-- legitimately pass the wrong_token / claim_token checks in release_slot and
-- move_slot -- the token would stop being a secret. Ownership lookups go
-- through public.my_slot_ids(), which requires presenting the token, not
-- reading it off the row.
grant select (id, session_id, team, position, player_name, claimed_at)
  on public.slots to anon;
