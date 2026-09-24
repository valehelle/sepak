\set ON_ERROR_STOP on

do $$
declare
  v_session sepak.sessions;
  v_old     sepak.sessions;
  v_count   int;
  v_body    text;
  v_gk_d    uuid;
  v_token   uuid := gen_random_uuid();
  v_act     bigint;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';

  -- The app's own call: all twelve parameters.
  v_session := sepak.create_session(
    920, 'Four Teams', '2026-12-01', '21:00:00', 120, 'Padang', 25,
    '', '', '', '', 15);
  assert v_session.team_a_name = 'Merah A' and v_session.team_b_name = 'Merah B'
     and v_session.team_c_name = 'Kuning A' and v_session.team_d_name = 'Kuning B',
    format('unexpected default names %s/%s/%s/%s', v_session.team_a_name, v_session.team_b_name,
      v_session.team_c_name, v_session.team_d_name);
  assert v_session.fee_gk_myr = 15, 'the goalkeeper fee should be stored';

  select count(*) into v_count from sepak.slots where session_id = v_session.id;
  assert v_count = 44, format('expected 44 slots, got %s', v_count);
  select count(*) into v_count from sepak.slots where session_id = v_session.id and team = 'D';
  assert v_count = 11, format('expected 11 Team D slots, got %s', v_count);

  -- A caller that only knows the old ten parameters still works, and gets
  -- the same price for goalkeepers.
  v_old := sepak.create_session(
    921, 'Old Caller', '2026-12-08', '21:00:00', 120, 'Padang', 25,
    'Merah', 'Putih', 'Kuning');
  assert v_old.fee_gk_myr is null, 'an old caller must not set a goalkeeper fee';
  reset role;
  set local request.jwt.claims = '{}';

  -- A promotion into Team D names Team D's own name.
  update sepak.sessions set team_d_name = 'Kuning Dua' where id = v_session.id;
  select id into v_gk_d from sepak.slots where session_id = v_session.id and team = 'D' and position = 'GK';
  perform set_config('sepak.actor', 'system', true);
  update sepak.slots set player_name = 'Baru', claim_token = v_token, claimed_at = now() where id = v_gk_d;
  perform set_config('sepak.actor', '', true);
  select max(id) into v_act from sepak.activity where slot_id = v_gk_d and kind = 'autofill';
  select body into v_body from sepak.promotion_text(v_act);
  assert v_body like 'Team Kuning Dua — GK%', format('unexpected promotion body %s', v_body);

  -- A fifth team is still refused.
  begin
    insert into sepak.slots (session_id, team, position) values (v_session.id, 'E', 'GK');
    raise exception 'team E must be refused';
  exception when check_violation then null;
  end;

  raise notice 'four_teams_test: ok';
  raise exception 'ROLLBACK_MARKER';
exception when others then
  if sqlerrm = 'ROLLBACK_MARKER' then
    raise notice 'four_teams_test: rolled back';
  else
    raise;
  end if;
end $$;
