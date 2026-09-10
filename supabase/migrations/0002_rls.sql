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
-- to match the policies above: read for everyone, write for authenticated.
grant select on public.sessions, public.slots to anon, authenticated;
grant insert, update, delete on public.sessions, public.slots to authenticated;

-- Belt and braces: anon is never granted DML above, but revoke it explicitly
-- too, so the denial is a privilege error rather than resting solely on the
-- absence of a grant -- clearer to debug, and what the tests assert.
revoke insert, update, delete on public.sessions from anon;
revoke insert, update, delete on public.slots    from anon;
