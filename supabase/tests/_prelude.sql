-- Prepended to every SQL test by scripts/sqltest.sh, which wraps the file in
-- one transaction and rolls it back, so none of this outlives the test.

\set ON_ERROR_STOP on

-- The local admin login used throughout the tests, with a fixed account id.
-- Admin rights belong to an account since 0019_accounts.sql, and claims
-- in the tests name it as "sub", the way a real signed-in JWT does.
-- The other addresses are the admin-list tests' cast: an admin can only be
-- added once their account exists.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000ad', 'admin@sepak.local'),
  ('00000000-0000-4000-8000-0000000000a1', 'hazmiirfan92@gmail.com'),
  ('00000000-0000-4000-8000-0000000000a2', 'temp-admin@example.test'),
  ('00000000-0000-4000-8000-0000000000a3', 'temp-super@example.test'),
  ('00000000-0000-4000-8000-0000000000a4', 'sneaky@example.test')
on conflict (id) do nothing;
update sepak.admins set user_id = '00000000-0000-4000-8000-0000000000ad'
 where email = 'admin@sepak.local';
update sepak.admins set user_id = '00000000-0000-4000-8000-0000000000a1'
 where email = 'hazmiirfan92@gmail.com';

-- Most suites test the booking rules themselves, through the key-taking
-- functions that 0019 made internal. Reopened for this transaction only;
-- supabase/tests/accounts_test.sql tests the public, signed-in versions and
-- runs without this.
grant execute on function sepak.claim_slot(uuid, text, text, uuid)              to anon, authenticated;
grant execute on function sepak.join_waitlist(uuid, text, text, text[], uuid)   to anon, authenticated;
grant execute on function sepak.leave_waitlist(uuid, uuid)                      to anon, authenticated;
grant execute on function sepak.move_slot(uuid, uuid, uuid)                     to anon, authenticated;
grant execute on function sepak.release_slot(uuid, uuid)                        to anon, authenticated;
grant execute on function sepak.set_slot_paid(uuid, uuid, boolean)             to anon, authenticated;
grant execute on function sepak.my_slot_ids(uuid, uuid)                         to anon, authenticated;
grant execute on function sepak.my_waitlist_entry(uuid, uuid)                   to anon, authenticated;
grant execute on function sepak.create_telegram_link(uuid)                      to anon, authenticated;
grant execute on function sepak.has_telegram_chat(uuid)                         to anon, authenticated;
grant execute on function sepak.save_push_subscription(uuid, text, text, text, text) to anon, authenticated;
grant execute on function sepak.delete_push_subscription(uuid, text)            to anon, authenticated;
grant execute on function sepak.has_push_subscription(uuid)                     to anon, authenticated;
