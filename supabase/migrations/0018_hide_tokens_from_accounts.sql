-- Signed-in accounts could read every player's booking token.
--
-- 0002_rls.sql and 0007_waitlist.sql gave `authenticated` table-wide SELECT
-- on slots and waitlist, back when only the organiser ever signed in. Sign-up
-- is open (config.toml, [auth] enable_signup), so anyone can become
-- `authenticated` with the public key and any email address -- and with the
-- token read off the row, release_slot, move_slot, set_slot_paid and
-- leave_waitlist all accept it as proof of ownership.
--
-- Same column list anon already has. Nothing in the app reads claim_token
-- back: ownership is proven through my_slot_ids / my_waitlist_entry, which
-- take the token rather than return it. Realtime checks column privileges
-- too, so the token also stops arriving in change payloads.
--
-- Writes are untouched: admins still clear slots and queue entries directly,
-- and RLS (sepak.is_admin()) still decides who may.

revoke select on sepak.slots from authenticated;
grant select (id, session_id, team, position, player_name, claimed_at, paid)
  on sepak.slots to authenticated;

revoke select on sepak.waitlist from authenticated;
grant select (id, session_id, player_name, positions, created_at)
  on sepak.waitlist to authenticated;
