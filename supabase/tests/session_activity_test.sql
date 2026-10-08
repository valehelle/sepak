\set ON_ERROR_STOP on

do $$
declare
  v_one uuid; v_two uuid;
  v_gk_one uuid; v_gk_two uuid;
  v_count int;
  v_other int;
begin
  insert into sepak.sessions (session_no, title, play_date, start_time, venue)
  values (980, 'One', '2026-12-01', '21:00', 'Padang') returning id into v_one;
  insert into sepak.sessions (session_no, title, play_date, start_time, venue)
  values (981, 'Two', '2026-12-08', '21:00', 'Padang') returning id into v_two;
  insert into sepak.slots (session_id, team, position) values (v_one, 'A', 'GK') returning id into v_gk_one;
  insert into sepak.slots (session_id, team, position) values (v_two, 'A', 'GK') returning id into v_gk_two;

  set local role anon;
  perform sepak.claim_slot(v_gk_one, 'Amir', '60123456789', gen_random_uuid());
  perform sepak.claim_slot(v_gk_two, 'Bella', '60122222222', gen_random_uuid());
  reset role;

  -- An admin sees only the session asked for.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000ad","email":"admin@sepak.local","role":"authenticated"}';
  select count(*), count(*) filter (where player_name <> 'Amir')
    into v_count, v_other
    from sepak.session_activity(v_one);
  assert v_count = 1, format('expected one line for session one, got %s', v_count);
  assert v_other = 0, 'another session''s lines must not appear';

  -- Anyone else is refused: the lines carry phone numbers.
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000ffff","email":"stranger@example.test","role":"authenticated"}';
  begin
    perform * from sepak.session_activity(v_one);
    raise exception 'a non-admin must not read a session''s activity';
  exception when others then
    assert sqlerrm = 'not_admin', format('expected not_admin, got %s', sqlerrm);
  end;
  reset role;

  set local role anon;
  begin
    perform * from sepak.session_activity(v_one);
    raise exception 'anon must not read a session''s activity';
  exception when insufficient_privilege then null;
  end;
  reset role;

  raise notice 'session_activity_test: ok';
  raise exception 'ROLLBACK_MARKER';
exception when others then
  if sqlerrm = 'ROLLBACK_MARKER' then
    raise notice 'session_activity_test: rolled back';
  else
    raise;
  end if;
end $$;
