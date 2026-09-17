\set ON_ERROR_STOP on

---------------------------------------------------------------------------
-- Schema / RLS / grants
---------------------------------------------------------------------------
do $$
declare
  v_session_id uuid;
  v_gk         uuid;
  v_token      uuid := gen_random_uuid();
begin
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  select id into v_session_id from sepak.create_session(
    901, 'Waitlist Test', '2026-09-16', '20:00:00', 120, 'Padang Presint 8', 27,
    'Merah', 'Putih', 'Kuning');
  select id into v_gk from sepak.slots where session_id = v_session_id and team = 'A' and position = 'GK';
  reset role;

  ---------------------------------------------------------------------------
  -- an empty positions array is rejected -- array_length('{}', 1) is NULL,
  -- so this specifically exercises the coalesce(...) in the check, not just
  -- the subset check.
  ---------------------------------------------------------------------------
  begin
    insert into sepak.waitlist (session_id, player_name, claim_token, positions)
    values (v_session_id, 'Rogue', gen_random_uuid(), array[]::text[]);
    raise exception 'expected waitlist_positions_length to reject an empty array';
  exception when check_violation then null;
  end;

  begin
    insert into sepak.waitlist (session_id, player_name, claim_token, positions)
    values (v_session_id, 'Rogue', gen_random_uuid(), array['SWEEPER']);
    raise exception 'expected waitlist_positions_subset to reject an unknown position';
  exception when check_violation then null;
  end;

  begin
    insert into sepak.waitlist (session_id, player_name, claim_token, positions)
    values (v_session_id, 'Rogue', gen_random_uuid(),
      array['GK','GK','GK','GK','GK','GK','GK','GK','GK','GK','GK','LB']);
    raise exception 'expected waitlist_positions_length to reject more than eleven positions';
  exception when check_violation then null;
  end;

  begin
    insert into sepak.waitlist (session_id, player_name, claim_token, positions)
    values (v_session_id, '   ', gen_random_uuid(), array['GK']);
    raise exception 'expected waitlist_name_length to reject a blank name';
  exception when check_violation then null;
  end;

  ---------------------------------------------------------------------------
  -- anon: reads the public columns, never claim_token, and has no direct
  -- write access at all.
  ---------------------------------------------------------------------------
  set local request.jwt.claims = '{}';
  set local role anon;

  assert (select count(*) from sepak.waitlist) = 0, 'sanity: no waitlist rows yet';

  begin
    perform claim_token from sepak.waitlist limit 1;
    raise exception 'anon must not read waitlist.claim_token';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into sepak.waitlist (session_id, player_name, claim_token, positions)
    values (v_session_id, 'Rogue', gen_random_uuid(), array['GK']);
    raise exception 'anon must not insert into waitlist directly';
  exception when insufficient_privilege then null;
  end;

  reset role;
  delete from sepak.sessions where id = v_session_id;
  raise notice 'waitlist_test: schema/RLS/grants assertions passed';
end $$;

---------------------------------------------------------------------------
-- join_waitlist / leave_waitlist / my_waitlist_entry, and the invariant
-- that a device is either in a slot or on the waitlist, never both.
---------------------------------------------------------------------------
do $$
declare
  v_session_id uuid;
  v_gk         uuid;
  v_st         uuid;
  v_mc_a       uuid;
  v_mc_b       uuid;
  v_mc_c       uuid;
  v_token      uuid := gen_random_uuid(); -- Hazmi's device
  v_other      uuid := gen_random_uuid(); -- Faiz's device
  v_nabil      uuid := gen_random_uuid(); -- Nabil's device
  v_amir       uuid := gen_random_uuid(); -- Amir's device
  v_result     jsonb;
  v_count      int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  select id into v_session_id from sepak.create_session(
    902, 'Waitlist Test 2', '2026-09-16', '20:00:00', 120, 'Padang Presint 8', 27,
    'Merah', 'Putih', 'Kuning');
  select id into v_gk from sepak.slots where session_id = v_session_id and team = 'A' and position = 'GK';
  select id into v_st from sepak.slots where session_id = v_session_id and team = 'A' and position = 'ST';
  select id into v_mc_a from sepak.slots where session_id = v_session_id and team = 'A' and position = 'MC';
  select id into v_mc_b from sepak.slots where session_id = v_session_id and team = 'B' and position = 'MC';
  select id into v_mc_c from sepak.slots where session_id = v_session_id and team = 'C' and position = 'MC';
  reset role;

  set local request.jwt.claims = '{}';
  set local role anon;

  ---------------------------------------------------------------------------
  -- immediate claim: MC is free (all three teams), so joining with it
  -- claims Team A's MC (earliest in pitch order) rather than queueing.
  ---------------------------------------------------------------------------
  v_result := sepak.join_waitlist(v_session_id, 'Hazmi', '60123456789', array['MC'], v_token);
  assert (v_result ->> 'placed')::boolean = true, 'a free preferred position should claim immediately';
  assert (v_result ->> 'slot_id')::uuid = v_mc_a, 'the earliest matching slot in pitch order should be claimed';
  assert (select player_name from sepak.slots where id = v_mc_a) = 'Hazmi',
    'join_waitlist should have written the name onto the claimed slot';
  assert (select count(*) from sepak.waitlist where session_id = v_session_id) = 0,
    'an immediate claim must not also create a waitlist row';

  -- Invariant, direction one: a device holding a slot cannot also join the
  -- waitlist.
  begin
    perform sepak.join_waitlist(v_session_id, 'Hazmi', '60123456789', array['ST'], v_token);
    raise exception 'a device already holding a slot must not be able to join the waitlist';
  exception when others then
    assert sqlerrm = 'already_in_slot', format('expected already_in_slot, got %s', sqlerrm);
  end;

  -- Fill every still-empty slot (Hazmi's MC/A claim above is left alone) so
  -- nothing is free any more -- GK, ST and MC alike -- and the next joins
  -- below are forced to queue rather than claim. Direct table writes need
  -- an elevated role -- anon has no write grant on slots (see
  -- 0002_rls.sql) -- so this switches out and back rather than writing
  -- while still `set local role anon`.
  reset role;
  update sepak.slots
     set player_name = 'Filler', claim_token = gen_random_uuid(), claimed_at = now()
   where session_id = v_session_id and player_name is null;
  set local request.jwt.claims = '{}';
  set local role anon;

  ---------------------------------------------------------------------------
  -- queueing, FIFO order, and narrower-but-later not jumping the queue
  ---------------------------------------------------------------------------
  v_result := sepak.join_waitlist(v_session_id, 'Faiz', '60133000002', array['GK','ST','MC'], v_other);
  assert (v_result ->> 'placed')::boolean = false, 'GK is taken -- Faiz should queue';

  -- a GK-specific, later entry
  perform pg_sleep(0.01);
  v_result := sepak.join_waitlist(v_session_id, 'Nabil', '60133000003', array['GK'], v_nabil);
  assert (v_result ->> 'placed')::boolean = false, 'GK is still taken -- Nabil should queue too';

  assert (select count(*) from sepak.waitlist where session_id = v_session_id) = 2,
    'both Faiz and Nabil should be queued';

  -- my_waitlist_entry: presenting the token, not reading it.
  assert (select count(*) from sepak.my_waitlist_entry(v_session_id, v_nabil)) = 1,
    'my_waitlist_entry should find Nabil''s own entry';
  assert (select positions from sepak.my_waitlist_entry(v_session_id, v_nabil)) = array['GK'],
    'my_waitlist_entry should return the right positions';
  assert (select count(*) from sepak.my_waitlist_entry(v_session_id, gen_random_uuid())) = 0,
    'my_waitlist_entry should return nothing for a token that joined nothing';

  -- Release GK: Faiz (earlier, broader) must win, not Nabil (later,
  -- GK-specific) -- narrower-but-later does not jump the queue.
  reset role;
  update sepak.slots set player_name = null, claim_token = null, claimed_at = null where id = v_gk;
  set local request.jwt.claims = '{}';
  set local role anon;
  assert (select player_name from sepak.slots where id = v_gk) = 'Faiz',
    'FIFO: the earliest matching entry (Faiz) should be placed, not the later GK-specific one (Nabil)';
  assert (select count(*) from sepak.waitlist where session_id = v_session_id and player_name = 'Faiz') = 0,
    'auto-fill should delete the placed entry''s waitlist row';
  assert (select count(*) from sepak.waitlist where session_id = v_session_id and player_name = 'Nabil') = 1,
    'Nabil should remain queued';

  -- Invariant, direction two: being auto-placed removed the waitlist row,
  -- so Faiz''s device now holds a slot and nothing else.
  assert (select count(*) from sepak.my_waitlist_entry(v_session_id, v_other)) = 0,
    'a placed device should have no waitlist entry left';

  ---------------------------------------------------------------------------
  -- leave_waitlist
  ---------------------------------------------------------------------------
  perform sepak.leave_waitlist(v_session_id, v_nabil);
  assert (select count(*) from sepak.waitlist where session_id = v_session_id) = 0,
    'leave_waitlist should remove Nabil''s row';

  begin
    perform sepak.leave_waitlist(v_session_id, v_nabil);
    raise exception 'leaving twice should fail';
  exception when others then
    assert sqlerrm = 'not_waitlisted', format('expected not_waitlisted, got %s', sqlerrm);
  end;

  ---------------------------------------------------------------------------
  -- validation errors
  ---------------------------------------------------------------------------
  begin
    perform sepak.join_waitlist(v_session_id, '   ', '60123456789', array['GK'], gen_random_uuid());
    raise exception 'a blank name must be rejected';
  exception when others then
    assert sqlerrm = 'invalid_name', format('expected invalid_name, got %s', sqlerrm);
  end;

  begin
    perform sepak.join_waitlist(v_session_id, 'Ghost', '60123456789', array[]::text[], gen_random_uuid());
    raise exception 'an empty positions array must be rejected';
  exception when others then
    assert sqlerrm = 'invalid_positions', format('expected invalid_positions, got %s', sqlerrm);
  end;

  begin
    perform sepak.join_waitlist(v_session_id, 'Ghost', '60123456789', array['SWEEPER'], gen_random_uuid());
    raise exception 'an unknown position must be rejected';
  exception when others then
    assert sqlerrm = 'invalid_positions', format('expected invalid_positions, got %s', sqlerrm);
  end;

  -- already_waitlisted: fill everything (a fresh, unclaimed device -- v_amir
  -- -- so a fresh join cannot claim), then join once and try again with the
  -- same token.
  reset role;
  update sepak.slots
     set player_name = 'Filler', claim_token = gen_random_uuid(), claimed_at = now()
   where session_id = v_session_id and player_name is null;
  set local request.jwt.claims = '{}';
  set local role anon;
  v_result := sepak.join_waitlist(v_session_id, 'Amir', '60133000004', array['GK'], v_amir);
  assert (v_result ->> 'placed')::boolean = false, 'sanity: Amir should queue with everything filled';
  begin
    perform sepak.join_waitlist(v_session_id, 'Amir Lagi', '60133000004', array['ST'], v_amir);
    raise exception 'joining twice from one device must fail';
  exception when others then
    assert sqlerrm = 'already_waitlisted', format('expected already_waitlisted, got %s', sqlerrm);
  end;

  ---------------------------------------------------------------------------
  -- a closed session rejects join_waitlist
  ---------------------------------------------------------------------------
  reset role;
  update sepak.sessions set status = 'closed' where id = v_session_id;
  set local role anon;

  begin
    perform sepak.join_waitlist(v_session_id, 'Latecomer', '60123456789', array['GK'], gen_random_uuid());
    raise exception 'joining a closed session must fail';
  exception when others then
    assert sqlerrm = 'session_closed', format('expected session_closed, got %s', sqlerrm);
  end;

  reset role;
  delete from sepak.sessions where id = v_session_id;
  raise notice 'waitlist_test: join/leave/my_waitlist_entry assertions passed';
end $$;

---------------------------------------------------------------------------
-- Auto-fill trigger: path-independent -- it fires on any player_name
-- non-null -> null transition on sepak.slots, so it must fire whichever of
-- the two ways a slot can vacate produced that transition. Asserted
-- separately for each: release_slot (an RPC write) and an admin clear (a
-- direct table write) -- plus that it does not fire on a closed session and
-- does not recurse.
---------------------------------------------------------------------------
do $$
declare
  v_session_id uuid;
  v_gk         uuid;
  v_rb         uuid;
  v_faiz_token uuid := gen_random_uuid();
begin
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  select id into v_session_id from sepak.create_session(
    903, 'Waitlist Trigger Test', '2026-09-16', '20:00:00', 120, 'Padang Presint 8', 27,
    'Merah', 'Putih', 'Kuning');
  select id into v_gk from sepak.slots where session_id = v_session_id and team = 'A' and position = 'GK';
  select id into v_rb from sepak.slots where session_id = v_session_id and team = 'A' and position = 'RB';

  ---------------------------------------------------------------------------
  -- fires on release_slot
  ---------------------------------------------------------------------------
  update sepak.slots set player_name = 'Holder', claim_token = gen_random_uuid(), claimed_at = now() where id = v_gk;
  insert into sepak.waitlist (session_id, player_name, claim_token, positions)
  values (v_session_id, 'Faiz', v_faiz_token, array['GK']);

  perform sepak.release_slot(v_gk, (select claim_token from sepak.slots where id = v_gk));
  assert (select player_name from sepak.slots where id = v_gk) = 'Faiz',
    'auto-fill should place Faiz when release_slot frees a matching slot';
  assert (select count(*) from sepak.waitlist where session_id = v_session_id) = 0,
    'auto-fill should delete the placed entry';

  ---------------------------------------------------------------------------
  -- fires on an admin clear (a direct table update, not an RPC)
  ---------------------------------------------------------------------------
  update sepak.slots set player_name = 'Holder', claim_token = gen_random_uuid(), claimed_at = now() where id = v_rb;
  insert into sepak.waitlist (session_id, player_name, claim_token, positions)
  values (v_session_id, 'Amir', gen_random_uuid(), array['RB']);

  update sepak.slots set player_name = null, claim_token = null, claimed_at = null where id = v_rb;
  assert (select player_name from sepak.slots where id = v_rb) = 'Amir',
    'auto-fill should fire on a direct admin-clear update too';

  ---------------------------------------------------------------------------
  -- does not fire on a closed session
  ---------------------------------------------------------------------------
  update sepak.slots set player_name = 'Holder', claim_token = gen_random_uuid(), claimed_at = now() where id = v_gk;
  insert into sepak.waitlist (session_id, player_name, claim_token, positions)
  values (v_session_id, 'Latecomer', gen_random_uuid(), array['GK']);
  update sepak.sessions set status = 'closed' where id = v_session_id;

  update sepak.slots set player_name = null, claim_token = null, claimed_at = null where id = v_gk;
  assert (select player_name from sepak.slots where id = v_gk) is null,
    'auto-fill must not fire while the session is closed';
  assert (select count(*) from sepak.waitlist where session_id = v_session_id) = 1,
    'the queued entry must survive untouched while the session is closed';

  update sepak.sessions set status = 'open' where id = v_session_id;
  delete from sepak.waitlist where session_id = v_session_id;

  ---------------------------------------------------------------------------
  -- does not recurse: two entries match one freed slot; only the earliest
  -- is consumed. If the trigger recursed, its own placing write (null ->
  -- non-null) would re-fire itself looking for a second match and consume
  -- Nabil too (or the statement would error outright on runaway recursion).
  ---------------------------------------------------------------------------
  update sepak.slots set player_name = 'Holder', claim_token = gen_random_uuid(), claimed_at = now() where id = v_gk;
  insert into sepak.waitlist (session_id, player_name, claim_token, positions, created_at)
  values (v_session_id, 'Faiz', gen_random_uuid(), array['GK'], now());
  insert into sepak.waitlist (session_id, player_name, claim_token, positions, created_at)
  values (v_session_id, 'Nabil', gen_random_uuid(), array['GK'], now() + interval '1 second');

  update sepak.slots set player_name = null, claim_token = null, claimed_at = null where id = v_gk;

  assert (select player_name from sepak.slots where id = v_gk) = 'Faiz',
    'exactly the earliest entry should be placed -- no recursive extra fill';
  assert (select count(*) from sepak.waitlist where session_id = v_session_id) = 1,
    'exactly one waitlist row should remain -- recursion would have consumed both';
  assert (select player_name from sepak.waitlist where session_id = v_session_id) = 'Nabil',
    'the remaining row should be Nabil''s, untouched by the release';

  delete from sepak.sessions where id = v_session_id;
  reset role;
  raise notice 'waitlist_test: auto-fill trigger assertions passed (release_slot, admin clear, closed session, non-recursion)';
end $$;

---------------------------------------------------------------------------
-- The "never both" invariant against the hole claim_slot used to leave
-- open: a queued device that taps a free slot directly (rather than
-- waiting on auto-fill) must leave the queue, and must not be eligible for
-- a second, later auto-fill.
---------------------------------------------------------------------------
do $$
declare
  v_session_id uuid;
  v_gk         uuid;
  v_st         uuid;
  v_dev        uuid := gen_random_uuid(); -- the queued device that claims directly
  v_other      uuid := gen_random_uuid(); -- a second device, still properly queued
  v_claimed    sepak.slots;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  select id into v_session_id from sepak.create_session(
    904, 'Waitlist Invariant Test', '2026-09-16', '20:00:00', 120, 'Padang Presint 8', 27,
    'Merah', 'Putih', 'Kuning');
  select id into v_gk from sepak.slots where session_id = v_session_id and team = 'A' and position = 'GK';
  select id into v_st from sepak.slots where session_id = v_session_id and team = 'A' and position = 'ST';

  -- Fill every slot except ST -- GK (all three teams) is taken, so joining
  -- for GK genuinely queues; ST stays free for the device to tap directly.
  update sepak.slots
     set player_name = 'Filler', claim_token = gen_random_uuid(), claimed_at = now()
   where session_id = v_session_id and id <> v_st;
  reset role;

  set local request.jwt.claims = '{}';
  set local role anon;

  -- Both devices queue for GK, which is taken -- Dev first, Other second.
  perform sepak.join_waitlist(v_session_id, 'Dev', '60133000005', array['GK'], v_dev);
  perform pg_sleep(0.01);
  perform sepak.join_waitlist(v_session_id, 'Other', '60133000006', array['GK'], v_other);
  assert (select count(*) from sepak.waitlist where session_id = v_session_id) = 2,
    'sanity: both Dev and Other should be queued';

  -- Dev sees ST open and taps it directly, bypassing auto-fill entirely.
  select * into v_claimed from sepak.claim_slot(v_st, 'Dev', '60133000005', v_dev);
  assert v_claimed.player_name = 'Dev', 'claim_slot should have claimed ST for Dev';

  -- The fix: claiming removes the queue row for that device.
  assert (select count(*) from sepak.my_waitlist_entry(v_session_id, v_dev)) = 0,
    'claim_slot should remove the claiming device''s own waitlist entry';
  assert (select count(*) from sepak.waitlist where session_id = v_session_id) = 1,
    'only Other should remain queued after Dev claims directly';

  -- The consequence that actually matters: GK frees up next. Dev must NOT
  -- be placed a second time -- Other (still genuinely queued) gets it.
  reset role;
  update sepak.slots set player_name = null, claim_token = null, claimed_at = null where id = v_gk;
  set local request.jwt.claims = '{}';
  set local role anon;

  assert (select player_name from sepak.slots where id = v_gk) = 'Other',
    'auto-fill must place the still-queued device (Other), not the one that already claimed directly (Dev)';
  assert (select player_name from sepak.slots where id = v_st) = 'Dev',
    'Dev''s directly-claimed slot must be untouched by the later auto-fill';
  assert (select count(*) from sepak.waitlist where session_id = v_session_id) = 0,
    'Other''s entry should be consumed by the auto-fill; none of Dev''s should reappear';

  reset role;
  delete from sepak.sessions where id = v_session_id;
  raise notice 'waitlist_test: claim_slot-clears-the-queue invariant assertions passed';
end $$;
