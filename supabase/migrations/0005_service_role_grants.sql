-- service_role is the trusted server-side key: never shipped to the browser,
-- used only by tests and fixtures here. Supabase's default ACL grants it
-- nothing on new tables, so seeding fails without this.
grant select, insert, update, delete on sepak.sessions to service_role;
grant select, insert, update, delete on sepak.slots    to service_role;

-- No additional RLS policies are needed: service_role has rolbypassrls = true
-- on this project (verified via `select rolbypassrls from pg_roles where
-- rolname = 'service_role'`), so it bypasses RLS entirely once it holds the
-- table-level privileges above.

-- EXECUTE is a separate ACL from RLS and from the table grants above --
-- rolbypassrls does not touch it. 0003_rpcs.sql revokes EXECUTE from PUBLIC
-- on every RPC and grants it back only to anon/authenticated, so service_role
-- (used by the integration test fixture in sessions.integration.test.ts to
-- create a session via the same RPC the app uses) needs it granted here too,
-- or seeding fails with "permission denied for function create_session".
grant execute on function sepak.create_session(int, text, date, time, int, text, numeric, text, text, text)
  to service_role;
