\set ON_ERROR_STOP on

do $$
declare
  v_session_id uuid;
  v_st_a uuid; v_lb_a uuid;
  v_t1 uuid := gen_random_uuid();  -- Hazmi
  v_t2 uuid := gen_random_uuid();  -- Amir (cleared by admin)
  v_t3 uuid := gen_random_uuid();  -- Queued, then leaves
  v_t4 uuid := gen_random_uuid();  -- Naik, promoted by auto-fill
  v_t5 uuid := gen_random_uuid();  -- Occupant, whose release promotes Naik
  v_t6 uuid := gen_random_uuid();  -- Direct, queues then claims outright
  v_count int;
  v_row   record;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  select id into v_session_id from sepak.create_session(
    906, 'Activity Test', '2026-10-07', '20:00:00', 120, 'Padang Presint 8', 27,
    'Merah', 'Putih', 'Kuning');
  select id into v_st_a from sepak.slots where session_id = v_session_id and team = 'A' and position = 'ST';
  select id into v_lb_a from sepak.slots where session_id = v_session_id and team = 'A' and position = 'LB';
  reset role;
  set local request.jwt.claims = '{}';

  -- Creating a session logs nothing: 33 empty slots is not activity.
  select count(*) into v_count from sepak.activity where session_id = v_session_id;
  assert v_count = 0, format('create_session should log nothing, logged %s', v_count);

  ---------------------------------------------------------------------------
  -- A player claiming, ticking, unticking, and releasing.
  ---------------------------------------------------------------------------
  set local role anon;
  perform sepak.claim_slot(v_st_a, 'Hazmi', '60123456789', v_t1);
  reset role;

  select kind, actor, player_name, phone, team, position, slot_id into v_row
    from sepak.activity where session_id = v_session_id order by created_at desc, id desc limit 1;
  assert v_row.kind = 'claim', format('expected claim, got %s', v_row.kind);
  assert v_row.actor = 'player', format('expected actor player, got %s', v_row.actor);
  assert v_row.player_name = 'Hazmi', 'the claim should name the player';
  assert v_row.phone = '60123456789', format('the claim should carry the phone, got %s', v_row.phone);
  assert v_row.team = 'A' and v_row.position = 'ST', 'the claim should name the position';
  assert v_row.slot_id = v_st_a, 'the claim should point at the slot';

  set local role anon;
  perform sepak.set_slot_paid(v_st_a, v_t1, true);
  perform sepak.set_slot_paid(v_st_a, v_t1, false);
  reset role;

  select count(*) into v_count from sepak.activity
   where session_id = v_session_id and player_name = 'Hazmi' and kind = 'paid';
  assert v_count = 1, format('expected one paid line, got %s', v_count);
  select count(*) into v_count from sepak.activity
   where session_id = v_session_id and player_name = 'Hazmi' and kind = 'unpaid';
  assert v_count = 1, format('expected one unpaid line, got %s', v_count);

  -- Releasing: the number survives here even though the contacts row is
  -- dropped by the same update.
  set local role anon;
  perform sepak.release_slot(v_st_a, v_t1);
  reset role;

  select kind, actor, phone into v_row from sepak.activity
   where session_id = v_session_id and player_name = 'Hazmi'
   order by created_at desc, id desc limit 1;
  assert v_row.kind = 'release', format('expected release, got %s', v_row.kind);
  assert v_row.actor = 'player', 'a player releasing their own slot is not an admin action';
  assert v_row.phone = '60123456789', 'a release line must still identify who left';
  select count(*) into v_count from sepak.contacts where slot_id = v_st_a;
  assert v_count = 0, 'the contacts row should be gone, proving the log kept its own copy';

  -- Vacating a paid slot is one line, not two: the tick reset is a side
  -- effect of leaving, not an event of its own.
  set local role anon;
  perform sepak.claim_slot(v_st_a, 'Hazmi', '60123456789', v_t1);
  perform sepak.set_slot_paid(v_st_a, v_t1, true);
  perform sepak.release_slot(v_st_a, v_t1);
  reset role;
  select count(*) into v_count from sepak.activity
   where session_id = v_session_id and player_name = 'Hazmi' and kind = 'unpaid';
  assert v_count = 1, format('releasing a paid slot must not log a second unpaid line, got %s', v_count);

  ---------------------------------------------------------------------------
  -- The organiser emptying somebody else's slot, through the same direct
  -- update PostgREST performs.
  ---------------------------------------------------------------------------
  set local role anon;
  perform sepak.claim_slot(v_lb_a, 'Amir', '60111112222', v_t2);
  reset role;

  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  update sepak.slots set player_name = null, claim_token = null, claimed_at = null
   where id = v_lb_a;
  reset role;
  set local request.jwt.claims = '{}';

  select kind, actor, phone into v_row from sepak.activity
   where session_id = v_session_id and player_name = 'Amir'
   order by created_at desc, id desc limit 1;
  assert v_row.kind = 'admin_clear', format('expected admin_clear, got %s', v_row.kind);
  assert v_row.actor = 'admin', format('expected actor admin, got %s', v_row.actor);
  assert v_row.phone = '60111112222', 'an admin clear must record who was removed';

  ---------------------------------------------------------------------------
  -- The queue: joining, leaving, and being promoted.
  ---------------------------------------------------------------------------
  -- Everything except A-ST is taken, so a preference other than ST queues.
  update sepak.slots
     set player_name = 'Filler', claim_token = gen_random_uuid(), claimed_at = now()
   where session_id = v_session_id and id <> v_st_a and player_name is null;

  set local role anon;
  perform sepak.join_waitlist(v_session_id, 'Queued', '60155556666', array['GK'], v_t3);
  reset role;
  select kind, actor, phone, team into v_row from sepak.activity
   where session_id = v_session_id and player_name = 'Queued'
   order by created_at desc, id desc limit 1;
  assert v_row.kind = 'waitlist_join', format('expected waitlist_join, got %s', v_row.kind);
  assert v_row.actor = 'player', 'joining the queue is a player action';
  assert v_row.phone = '60155556666', 'a queue line needs the number to be useful';
  assert v_row.team is null, 'a queue line belongs to no position yet';

  set local role anon;
  perform sepak.leave_waitlist(v_session_id, v_t3);
  reset role;
  select count(*) into v_count from sepak.activity
   where session_id = v_session_id and player_name = 'Queued' and kind = 'waitlist_leave';
  assert v_count = 1, format('expected one waitlist_leave line, got %s', v_count);

  -- Auto-fill: A-ST is occupied, Naik queues for ST, the occupant leaves.
  set local role anon;
  perform sepak.claim_slot(v_st_a, 'Occupant', '60177778888', v_t5);
  perform sepak.join_waitlist(v_session_id, 'Naik', '60199990000', array['ST'], v_t4);
  perform sepak.release_slot(v_st_a, v_t5);
  reset role;

  select kind, actor, phone, team, position into v_row from sepak.activity
   where session_id = v_session_id and player_name = 'Naik'
   order by created_at desc, id desc limit 1;
  assert v_row.kind = 'autofill', format('expected autofill, got %s', v_row.kind);
  assert v_row.actor = 'system', format('a promotion is nobody''s action, got %s', v_row.actor);
  assert v_row.phone = '60199990000', 'a promotion should carry the number forward';
  assert v_row.team = 'A' and v_row.position = 'ST', 'a promotion should name the position won';

  -- ...and the entry being consumed is not somebody leaving the queue.
  select count(*) into v_count from sepak.activity
   where session_id = v_session_id and player_name = 'Naik' and kind = 'waitlist_leave';
  assert v_count = 0, 'a promotion must not also log a waitlist_leave';

  -- The same suppression when a queued player claims a free slot outright.
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  update sepak.slots set player_name = null, claim_token = null, claimed_at = null
   where id = v_lb_a;
  reset role;
  set local request.jwt.claims = '{}';

  set local role anon;
  -- Queues for GK (all taken), so the freed LB does not auto-fill them.
  perform sepak.join_waitlist(v_session_id, 'Direct', '60122223333', array['GK'], v_t6);
  perform sepak.claim_slot(v_lb_a, 'Direct', '60122223333', v_t6);
  reset role;

  select count(*) into v_count from sepak.activity
   where session_id = v_session_id and player_name = 'Direct' and kind = 'claim';
  assert v_count = 1, format('expected one claim for Direct, got %s', v_count);
  select count(*) into v_count from sepak.activity
   where session_id = v_session_id and player_name = 'Direct' and kind = 'waitlist_leave';
  assert v_count = 0, 'claiming out of the queue must not also log a leave';

  ---------------------------------------------------------------------------
  -- Reading it. The table itself is closed to anon and to authenticated;
  -- activity_feed() is the only door, and it checks the allowlist.
  ---------------------------------------------------------------------------
  set local role anon;
  begin
    perform 1 from sepak.activity limit 1;
    raise exception 'anon must not read the activity table';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform sepak.activity_feed(10);
    raise exception 'anon must not call activity_feed';
  exception when insufficient_privilege then
    null;
  end;
  reset role;

  set local role authenticated;
  set local request.jwt.claims = '{"email":"nobody@example.test","role":"authenticated"}';
  begin
    perform 1 from sepak.activity limit 1;
    raise exception 'a signed-in non-admin must not read the activity table';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform sepak.activity_feed(10);
    raise exception 'a signed-in non-admin must not read the feed';
  exception when others then
    assert sqlerrm = 'not_admin', format('expected not_admin, got %s', sqlerrm);
  end;
  reset role;

  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  select count(*) into v_count from sepak.activity_feed(500);
  assert v_count > 0, 'an admin should see the feed';
  -- Newest first, and the session number comes along for the line's label.
  select kind, session_no into v_row from sepak.activity_feed(500) limit 1;
  assert v_row.kind = 'claim', format('the newest line should be Direct''s claim, got %s', v_row.kind);
  assert v_row.session_no = 906, format('the feed should carry session_no, got %s', v_row.session_no);
  -- The cap is enforced server-side, whatever the caller asks for.
  select count(*) into v_count from sepak.activity_feed(1);
  assert v_count = 1, format('expected the limit to be honoured, got %s', v_count);
  reset role;
  set local request.jwt.claims = '{}';

  ---------------------------------------------------------------------------
  -- Deleting a session takes its lines with it, and logs nothing on the way
  -- out. 'Direct' is still in the queue here, which is the case that used to
  -- fail: the cascade fired the leave trigger after the session row was gone.
  ---------------------------------------------------------------------------
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  delete from sepak.sessions where id = v_session_id;
  reset role;
  set local request.jwt.claims = '{}';

  select count(*) into v_count from sepak.activity where session_id = v_session_id;
  assert v_count = 0, format('deleting a session should take its lines, %s left', v_count);

  raise notice 'activity_test: ok';
  raise exception 'ROLLBACK_MARKER';
exception when others then
  if sqlerrm = 'ROLLBACK_MARKER' then
    raise notice 'activity_test: rolled back';
  else
    raise;
  end if;
end $$;
