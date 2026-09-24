\set ON_ERROR_STOP on

do $$
declare
  v_session_id uuid;
  v_gk uuid;
  v_st uuid;
  v_token uuid := gen_random_uuid();
  v_intruder uuid := gen_random_uuid();
  -- A third device: since 0010_one_booking_per_person.sql a token may hold
  -- only one slot per session, so the second claim below needs its own.
  v_zul uuid := gen_random_uuid();
  v_count int;
  v_claimed sepak.slots;
begin
  -- create_session builds a whole session in one shot. It now needs an
  -- allowlisted caller (sessions_write/slots_write gate on sepak.is_admin()
  -- as of migration 0006_admins.sql), so the JWT carries a seeded admin's
  -- email -- auth.jwt() ->> 'email' is what is_admin() actually reads.
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  select id into v_session_id from sepak.create_session(
    1, 'Geng Turun Peluh', '2026-09-16', '20:00:00', 120, 'Padang Presint 8', 27,
    'Merah', 'Putih', 'Kuning');

  select count(*) into v_count from sepak.slots where session_id = v_session_id;
  assert v_count = 44, format('expected 44 slots, got %s', v_count);
  assert (select count(distinct team) from sepak.slots where session_id = v_session_id) = 4,
    'expected four teams';
  assert (select count(*) from sepak.slots where session_id = v_session_id and team = 'A') = 11,
    'expected eleven positions per team';

  select id into v_gk from sepak.slots where session_id = v_session_id and team = 'A' and position = 'GK';
  select id into v_st from sepak.slots where session_id = v_session_id and team = 'A' and position = 'ST';
  reset role;

  ---------------------------------------------------------------------------
  -- anon has no direct write access to either table
  ---------------------------------------------------------------------------
  set local request.jwt.claims = '{}';
  set local role anon;

  assert (select count(*) from sepak.sessions) >= 1, 'anon should be able to read sessions';
  assert (select count(*) from sepak.slots) >= 33, 'anon should be able to read slots';

  begin
    insert into sepak.sessions (session_no, title, play_date, start_time, venue)
    values (99, 'Rogue', '2026-09-20', '20:00:00', 'Nowhere');
    raise exception 'anon must not insert sessions';
  exception when insufficient_privilege then null;
  end;

  begin
    update sepak.slots set player_name = 'Rogue', claim_token = gen_random_uuid(), claimed_at = now()
    where id = v_gk;
    raise exception 'anon must not update slots directly';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from sepak.slots where id = v_gk;
    raise exception 'anon must not delete slots';
  exception when insufficient_privilege then null;
  end;

  begin
    perform sepak.create_session(2, 'Rogue', '2026-09-20', '20:00:00', 120, 'Nowhere', 10,
      'Merah', 'Putih', 'Kuning');
    raise exception 'anon must not create sessions';
  exception when insufficient_privilege then null;
  end;

  begin
    truncate sepak.slots;
    raise exception 'anon must not truncate slots';
  exception when insufficient_privilege then null;
  end;

  begin
    perform claim_token from sepak.slots where id = v_gk;
    raise exception 'anon must not read claim_token';
  exception when insufficient_privilege then null;
  end;

  ---------------------------------------------------------------------------
  -- claim_slot
  ---------------------------------------------------------------------------
  -- claim_token comes back on the returned row (the API's own answer to "what
  -- did you just store"), never by reading the column back off the table --
  -- anon holds no select privilege on it, by design.
  select * into v_claimed from sepak.claim_slot(v_gk, 'Hazmi', '60123456789', v_token);
  assert v_claimed.player_name = 'Hazmi', 'claim should set the name';
  assert v_claimed.claim_token = v_token, 'claim should store the token';

  begin
    perform sepak.claim_slot(v_gk, 'Intruder', '60122200002', v_intruder);
    raise exception 'claiming an occupied slot must fail';
  exception when others then
    assert sqlerrm = 'slot_taken', format('expected slot_taken, got %s', sqlerrm);
  end;

  begin
    perform sepak.claim_slot(v_st, '   ', '60123456789', v_token);
    raise exception 'a blank name must be rejected';
  exception when others then
    assert sqlerrm = 'invalid_name', format('expected invalid_name, got %s', sqlerrm);
  end;

  begin
    perform sepak.claim_slot(v_st, repeat('x', 41), '60123456789', v_token);
    raise exception 'an over-long name must be rejected';
  exception when others then
    assert sqlerrm = 'invalid_name', format('expected invalid_name, got %s', sqlerrm);
  end;

  begin
    perform sepak.claim_slot(gen_random_uuid(), 'Ghost', '60123456789', v_token);
    raise exception 'claiming a nonexistent slot must fail';
  exception when others then
    assert sqlerrm = 'slot_not_found', format('expected slot_not_found, got %s', sqlerrm);
  end;

  -- names are trimmed on the way in
  perform sepak.claim_slot(v_st, '  Zulazhar  ', '60122200003', v_zul);
  assert (select player_name from sepak.slots where id = v_st) = 'Zulazhar', 'claim should trim the name';

  ---------------------------------------------------------------------------
  -- my_slot_ids: how a device discovers its own slots now that claim_token
  -- is no longer directly readable -- it must present the token, not read it.
  ---------------------------------------------------------------------------
  assert (select count(*) from sepak.my_slot_ids(v_session_id, v_token)) = 1,
    'one slot per device, so this token holds exactly one';
  assert v_gk in (select * from sepak.my_slot_ids(v_session_id, v_token)),
    'my_slot_ids should include the GK slot';
  assert (select count(*) from sepak.my_slot_ids(v_session_id, v_zul)) = 1,
    'the other device holds its own single slot';
  assert v_st in (select * from sepak.my_slot_ids(v_session_id, v_zul)),
    'my_slot_ids should include the ST slot for the device that claimed it';
  assert (select count(*) from sepak.my_slot_ids(v_session_id, v_intruder)) = 0,
    'my_slot_ids should return nothing for a token that claimed nothing';

  ---------------------------------------------------------------------------
  -- release_slot: the token is the authorisation
  ---------------------------------------------------------------------------
  begin
    perform sepak.release_slot(v_gk, v_intruder);
    raise exception 'releasing another device''s slot must fail';
  exception when others then
    assert sqlerrm = 'wrong_token', format('expected wrong_token, got %s', sqlerrm);
  end;
  assert (select player_name from sepak.slots where id = v_gk) = 'Hazmi',
    'a rejected release must leave the slot untouched';

  -- Again read the token off the returned row, not the table.
  select * into v_claimed from sepak.release_slot(v_gk, v_token);
  assert v_claimed.player_name is null, 'release should empty the slot';
  assert v_claimed.claim_token is null, 'release should clear the token';

  begin
    perform sepak.release_slot(v_gk, v_token);
    raise exception 'releasing an empty slot must fail';
  exception when others then
    assert sqlerrm = 'slot_empty', format('expected slot_empty, got %s', sqlerrm);
  end;

  ---------------------------------------------------------------------------
  -- a closed session rejects every mutation
  ---------------------------------------------------------------------------
  reset role;
  update sepak.sessions set status = 'closed' where id = v_session_id;
  set local role anon;

  begin
    perform sepak.claim_slot(v_st, 'Latecomer', '60123456789', v_intruder);
    raise exception 'claiming in a closed session must fail';
  exception when others then
    assert sqlerrm = 'session_closed', format('expected session_closed, got %s', sqlerrm);
  end;

  begin
    perform sepak.release_slot(v_gk, v_token);
    raise exception 'releasing in a closed session must fail';
  exception when others then
    assert sqlerrm = 'session_closed', format('expected session_closed, got %s', sqlerrm);
  end;

  reset role;
  raise notice 'rls_test: all assertions passed';
end $$;

---------------------------------------------------------------------------
-- Admin allowlist (migration 0006_admins.sql): membership, not merely being
-- authenticated, is what authorises a write; only a super admin may manage
-- the allowlist itself; admins is unreadable to anon; and a super admin can
-- never be deleted or demoted once they are the only one left.
---------------------------------------------------------------------------
do $$
declare
  v_session_id uuid;
  v_slot_id    uuid;
  v_count      int;
begin
  ---------------------------------------------------------------------------
  -- authenticated but NOT on the allowlist: refused, directly and via RPC
  ---------------------------------------------------------------------------
  set local role authenticated;
  set local request.jwt.claims = '{"email":"stranger@example.test","role":"authenticated"}';

  begin
    insert into sepak.sessions (session_no, title, play_date, start_time, venue)
    values (997, 'Stranger', '2026-11-01', '20:00:00', 'Nowhere');
    raise exception 'a non-allowlisted authenticated user must not insert sessions';
  exception when insufficient_privilege then null;
  end;

  begin
    perform sepak.create_session(998, 'Stranger', '2026-11-02', '20:00:00', 120, 'Nowhere', 10,
      'Merah', 'Putih', 'Kuning');
    raise exception 'a non-allowlisted authenticated user must not create a session via the RPC';
  exception when insufficient_privilege then null;
  end;

  ---------------------------------------------------------------------------
  -- an allowlisted admin CAN write sessions/slots directly, not just via RPC
  ---------------------------------------------------------------------------
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';

  insert into sepak.sessions (session_no, title, play_date, start_time, venue)
  values (996, 'Allowlisted', '2026-11-03', '20:00:00', 'Padang Allowlist')
  returning id into v_session_id;

  insert into sepak.slots (session_id, team, position)
  values (v_session_id, 'A', 'GK')
  returning id into v_slot_id;

  update sepak.slots set player_name = 'Hazmi', claim_token = gen_random_uuid(), claimed_at = now()
   where id = v_slot_id;
  assert (select player_name from sepak.slots where id = v_slot_id) = 'Hazmi',
    'an allowlisted admin should be able to write slots directly';

  delete from sepak.sessions where id = v_session_id;

  ---------------------------------------------------------------------------
  -- admins table: a plain admin may read it, but not write it
  ---------------------------------------------------------------------------
  assert (select count(*) from sepak.admins) >= 2, 'a plain admin should be able to read admins';

  begin
    insert into sepak.admins (email, role) values ('sneaky@example.test', 'admin');
    raise exception 'a plain admin must not insert into admins';
  exception when insufficient_privilege then null;
  end;

  -- UPDATE/DELETE are gated by admins_update/admins_delete's USING clause,
  -- which filters which rows the caller may even touch -- unlike INSERT's
  -- WITH CHECK above, a row a non-super cannot see simply matches nothing
  -- (0 rows affected) rather than raising, so the assertion here is on the
  -- row count and the row's untouched state, not on catching an exception.
  update sepak.admins set role = 'super' where email = 'admin@sepak.local';
  get diagnostics v_count = row_count;
  assert v_count = 0, 'a plain admin''s update to admins must match no rows';
  assert (select role from sepak.admins where email = 'admin@sepak.local') = 'admin',
    'a plain admin must not be able to change any admins row';

  delete from sepak.admins where email = 'hazmiirfan92@gmail.com';
  get diagnostics v_count = row_count;
  assert v_count = 0, 'a plain admin''s delete from admins must match no rows';
  assert (select count(*) from sepak.admins where email = 'hazmiirfan92@gmail.com') = 1,
    'a plain admin must not be able to delete any admins row';

  ---------------------------------------------------------------------------
  -- a super admin CAN manage the allowlist
  ---------------------------------------------------------------------------
  set local request.jwt.claims = '{"email":"hazmiirfan92@gmail.com","role":"authenticated"}';

  insert into sepak.admins (email, role, added_by)
  values ('temp-admin@example.test', 'admin', 'hazmiirfan92@gmail.com');

  update sepak.admins set role = 'super' where email = 'temp-admin@example.test';
  assert (select role from sepak.admins where email = 'temp-admin@example.test') = 'super',
    'a super admin should be able to promote another admin';

  delete from sepak.admins where email = 'temp-admin@example.test';
  assert (select count(*) from sepak.admins where email = 'temp-admin@example.test') = 0,
    'a super admin should be able to remove an admin';

  ---------------------------------------------------------------------------
  -- anon cannot read admins at all -- it is a list of organisers' own emails
  ---------------------------------------------------------------------------
  reset role;
  set local request.jwt.claims = '{}';
  set local role anon;

  begin
    perform count(*) from sepak.admins;
    raise exception 'anon must not read admins';
  exception when insufficient_privilege then null;
  end;

  ---------------------------------------------------------------------------
  -- last-super protection (prevent_last_super_removal trigger): a super
  -- admin can never be deleted or demoted once they are the only one left.
  ---------------------------------------------------------------------------
  reset role;
  set local role authenticated;
  set local request.jwt.claims = '{"email":"hazmiirfan92@gmail.com","role":"authenticated"}';

  insert into sepak.admins (email, role, added_by)
  values ('temp-super@example.test', 'super', 'hazmiirfan92@gmail.com');

  -- with two supers, one may remove the other.
  set local request.jwt.claims = '{"email":"temp-super@example.test","role":"authenticated"}';
  delete from sepak.admins where email = 'hazmiirfan92@gmail.com';
  assert (select count(*) from sepak.admins where email = 'hazmiirfan92@gmail.com') = 0,
    'deleting a super admin should succeed while another super remains';

  -- temp-super@example.test is now the only super left.
  begin
    delete from sepak.admins where email = 'temp-super@example.test';
    raise exception 'deleting the last super admin must fail';
  exception when others then
    assert sqlerrm = 'last_super_admin', format('expected last_super_admin, got %s', sqlerrm);
  end;

  begin
    update sepak.admins set role = 'admin' where email = 'temp-super@example.test';
    raise exception 'demoting the last super admin must fail';
  exception when others then
    assert sqlerrm = 'last_super_admin', format('expected last_super_admin, got %s', sqlerrm);
  end;

  assert (select role from sepak.admins where email = 'temp-super@example.test') = 'super',
    'a rejected demotion must leave the last super admin untouched';

  -- restore the seeded state: hazmiirfan92@gmail.com back as super, and the
  -- temporary super gone -- deleting it now succeeds because, with
  -- hazmiirfan92 reinserted, temp-super is no longer the last one.
  insert into sepak.admins (email, role) values ('hazmiirfan92@gmail.com', 'super');
  delete from sepak.admins where email = 'temp-super@example.test';

  reset role;
  assert (select role from sepak.admins where email = 'hazmiirfan92@gmail.com') = 'super',
    'the seeded super admin should be restored';
  assert (select count(*) from sepak.admins where email = 'temp-super@example.test') = 0,
    'the temporary super admin should be cleaned up';

  raise notice 'admins_test: all assertions passed';
end $$;
