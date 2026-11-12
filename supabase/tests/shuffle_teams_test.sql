\set ON_ERROR_STOP on

do $$
declare
  v_session uuid;
  v_closed  uuid;
  v_team    text;
  v_pos     text;
  v_before  jsonb;
  v_after   jsonb;
  i int;
  v_mark bigint;
begin
  insert into sepak.sessions (session_no, title, play_date, start_time, venue)
  values (985, 'Shuffle', '2026-12-24', '21:00', 'Padang') returning id into v_session;
  insert into sepak.sessions (session_no, title, play_date, start_time, venue, status)
  values (986, 'Closed', '2026-12-25', '21:00', 'Padang', 'closed') returning id into v_closed;

  -- Four teams, two positions each, everyone booked; one player has paid.
  foreach v_team in array array['A', 'B', 'C', 'D'] loop
    foreach v_pos in array array['GK', 'ST'] loop
      insert into sepak.slots (session_id, team, position, player_name, claim_token, claimed_at)
      values (v_session, v_team, v_pos, v_team || '-' || v_pos, gen_random_uuid(), now());
    end loop;
  end loop;
  update sepak.slots set paid = true, paid_at = now() where session_id = v_session and player_name = 'B-GK';
  select coalesce(max(id), 0) into v_mark from sepak.activity;

  set local role authenticated;
  set local request.jwt.claims = '{"email":"stranger@example.test","role":"authenticated"}';
  begin
    perform sepak.admin_shuffle_teams(v_session);
    raise exception 'a non-admin must not shuffle';
  exception when others then
    assert sqlerrm = 'not_admin', format('expected not_admin, got %s', sqlerrm);
  end;

  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  begin
    perform sepak.admin_shuffle_teams(v_closed);
    raise exception 'a closed session must not be shuffled';
  exception when others then
    assert sqlerrm = 'session_closed', format('expected session_closed, got %s', sqlerrm);
  end;
  reset role;
  set local request.jwt.claims = '{}';

  set local role anon;
  begin
    perform sepak.admin_shuffle_teams(v_session);
    raise exception 'anon must not shuffle';
  exception when insufficient_privilege then null;
  end;
  reset role;

  for i in 1..25 loop
    -- Which team each original team (named by its players) is in now.
    select jsonb_object_agg(player_name, team) into v_before
      from sepak.slots where session_id = v_session;

    set local role authenticated;
    set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
    perform sepak.admin_shuffle_teams(v_session);
    reset role;
    set local request.jwt.claims = '{}';

    select jsonb_object_agg(player_name, team) into v_after
      from sepak.slots where session_id = v_session;

    assert (select count(*) from sepak.slots where session_id = v_session) = 8, 'no slot is lost or added';

    -- Teammates stay together: both players of a team land in the same team.
    assert (select count(distinct (v_before ->> k) || '>' || (v_after ->> k))
              from jsonb_object_keys(v_before) k) = 4, format('a team was split up: %s -> %s', v_before, v_after);
    -- Every team goes somewhere new.
    assert not exists (select 1 from jsonb_object_keys(v_before) k where v_before ->> k = v_after ->> k),
      format('a team stayed put: %s -> %s', v_before, v_after);
    -- Positions never change: each name still ends in its position.
    assert not exists (select 1 from sepak.slots
                        where session_id = v_session and split_part(player_name, '-', 2) <> position),
      'a player changed position';
  end loop;

  assert (select paid from sepak.slots where session_id = v_session and player_name = 'B-GK'),
    'the paid tick moves with the player';
  assert not exists (select 1 from sepak.activity where session_id = v_session and id > v_mark),
    'a shuffle is not logged as anyone joining or leaving';

  raise notice 'shuffle_teams_test: ok';
  raise exception 'ROLLBACK_MARKER';
exception when others then
  if sqlerrm = 'ROLLBACK_MARKER' then
    raise notice 'shuffle_teams_test: rolled back';
  else
    raise;
  end if;
end $$;
