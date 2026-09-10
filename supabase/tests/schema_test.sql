\set ON_ERROR_STOP on

do $$
declare
  v_session_id uuid;
  v_slot_id uuid;
begin
  insert into public.sessions (session_no, title, play_date, start_time, venue, fee_myr)
  values (1, 'Test', '2026-09-16', '20:00:00', 'Padang Test', 27)
  returning id into v_session_id;

  -- defaults land as specified
  assert (select duration_mins from public.sessions where id = v_session_id) = 120,
    'duration_mins should default to 120';
  assert (select status from public.sessions where id = v_session_id) = 'open',
    'status should default to open';
  assert (select team_a_name from public.sessions where id = v_session_id) = 'Merah',
    'team_a_name should default to Merah';
  assert (select team_b_name from public.sessions where id = v_session_id) = 'Putih',
    'team_b_name should default to Putih';
  assert (select team_c_name from public.sessions where id = v_session_id) = 'Kuning',
    'team_c_name should default to Kuning';

  insert into public.slots (session_id, team, position)
  values (v_session_id, 'A', 'GK') returning id into v_slot_id;

  -- a slot is never half-claimed
  begin
    update public.slots set player_name = 'Hazmi' where id = v_slot_id;
    raise exception 'expected slots_claim_complete to reject a name without a token';
  exception
    when check_violation then null;
  end;

  -- all three claim columns together is valid
  update public.slots
     set player_name = 'Hazmi', claim_token = gen_random_uuid(), claimed_at = now()
   where id = v_slot_id;
  assert (select player_name from public.slots where id = v_slot_id) = 'Hazmi',
    'a complete claim should be accepted';

  -- one player per position per team per session
  begin
    insert into public.slots (session_id, team, position) values (v_session_id, 'A', 'GK');
    raise exception 'expected the (session, team, position) unique constraint to fire';
  exception
    when unique_violation then null;
  end;

  -- CB1 and CB2 are distinct keys, so two centre-backs coexist
  insert into public.slots (session_id, team, position)
  values (v_session_id, 'A', 'CB1'), (v_session_id, 'A', 'CB2');
  assert (select count(*) from public.slots where session_id = v_session_id and team = 'A') = 3,
    'CB1 and CB2 should both be storable';

  -- team and position are constrained to known values
  begin
    insert into public.slots (session_id, team, position) values (v_session_id, 'D', 'GK');
    raise exception 'expected the team check constraint to fire';
  exception
    when check_violation then null;
  end;
  begin
    insert into public.slots (session_id, team, position) values (v_session_id, 'A', 'SWEEPER');
    raise exception 'expected the position check constraint to fire';
  exception
    when check_violation then null;
  end;

  -- deleting a session takes its slots with it
  delete from public.sessions where id = v_session_id;
  assert (select count(*) from public.slots where session_id = v_session_id) = 0,
    'slots should cascade on session delete';

  raise notice 'schema_test: all assertions passed';
end $$;
