\set ON_ERROR_STOP on

-- No account, admin or not, can read a booking token off a table. Holding
-- the token is the whole of a player's authority over their slot.
do $$
declare
  v_session_id uuid;
  v_gk uuid;
  v_token uuid := gen_random_uuid();
  v_name text;
begin
  insert into sepak.sessions (session_no, title, play_date, start_time, venue)
  values (960, 'Secrecy', '2026-12-01', '21:00', 'Padang') returning id into v_session_id;
  insert into sepak.slots (session_id, team, position) values (v_session_id, 'A', 'GK') returning id into v_gk;
  insert into sepak.slots (session_id, team, position) values (v_session_id, 'A', 'ST');

  set local role anon;
  perform sepak.claim_slot(v_gk, 'Victim', '60123456789', v_token);
  perform sepak.join_waitlist(v_session_id, 'Queued', '60198765432', array['LB'], gen_random_uuid());
  reset role;

  -- A signed-in account that is not on the allowlist: what open sign-up gives
  -- anyone.
  set local role authenticated;
  set local request.jwt.claims = '{"email":"stranger@example.test","role":"authenticated"}';
  begin
    perform claim_token from sepak.slots where id = v_gk;
    raise exception 'a signed-in non-admin must not read slot tokens';
  exception when insufficient_privilege then null;
  end;
  begin
    perform claim_token from sepak.waitlist where session_id = v_session_id;
    raise exception 'a signed-in non-admin must not read queue tokens';
  exception when insufficient_privilege then null;
  end;
  -- Everything the page shows is still readable.
  select player_name into v_name from sepak.slots where id = v_gk;
  assert v_name = 'Victim', 'the public columns must stay readable';
  perform id, player_name, positions from sepak.waitlist where session_id = v_session_id;
  reset role;

  -- An admin has no need for them either.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000ad","email":"admin@sepak.local","role":"authenticated"}';
  begin
    perform claim_token from sepak.slots where id = v_gk;
    raise exception 'an admin must not read slot tokens either';
  exception when insufficient_privilege then null;
  end;
  -- ...and still clears a slot directly, as the admin screen does.
  update sepak.slots set player_name = null, claim_token = null, claimed_at = null where id = v_gk;
  reset role;
  set local request.jwt.claims = '{}';

  select player_name into v_name from sepak.slots where id = v_gk;
  assert v_name is null, 'the admin clear should still work';

  raise notice 'token_secrecy_test: ok';
  raise exception 'ROLLBACK_MARKER';
exception when others then
  if sqlerrm = 'ROLLBACK_MARKER' then
    raise notice 'token_secrecy_test: rolled back';
  else
    raise;
  end if;
end $$;
