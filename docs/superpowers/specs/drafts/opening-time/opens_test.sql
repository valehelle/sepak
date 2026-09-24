\set ON_ERROR_STOP on

do $$
declare
  v_session_id uuid;
  v_gk uuid; v_st uuid; v_lb uuid;
  v_admin_token uuid := gen_random_uuid();
  v_token uuid := gen_random_uuid();
  v_slot sepak.slots;
  v_now timestamptz;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  select id into v_session_id from sepak.create_session(
    930, 'Opens Test', '2026-12-01', '21:00:00', 120, 'Padang', 25, '', '', '');
  select id into v_gk from sepak.slots where session_id = v_session_id and team = 'A' and position = 'GK';
  select id into v_st from sepak.slots where session_id = v_session_id and team = 'A' and position = 'ST';
  select id into v_lb from sepak.slots where session_id = v_session_id and team = 'B' and position = 'LB';
  reset role;
  set local request.jwt.claims = '{}';

  -- A session made without a time opens at once (direct callers, tests).
  assert (select opens_at <= now() from sepak.sessions where id = v_session_id),
    'a session with no opening time given should already be open';

  update sepak.sessions set opens_at = now() + interval '1 day' where id = v_session_id;

  ---------------------------------------------------------------------------
  -- Before the time: every way in is refused for a player.
  ---------------------------------------------------------------------------
  set local role anon;
  begin
    perform sepak.claim_slot(v_gk, 'Early', '60123456789', v_token);
    raise exception 'a claim before opening must be refused';
  exception when others then
    assert sqlerrm = 'not_open_yet', format('expected not_open_yet, got %s', sqlerrm);
  end;

  -- The queue too: joining it while GK is empty would seat them at once.
  begin
    perform sepak.join_waitlist(v_session_id, 'Early', '60123456789', array['GK'], v_token);
    raise exception 'joining the queue before opening must be refused';
  exception when others then
    assert sqlerrm = 'not_open_yet', format('expected not_open_yet, got %s', sqlerrm);
  end;
  reset role;

  ---------------------------------------------------------------------------
  -- An admin books early, and can move, before the time.
  ---------------------------------------------------------------------------
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  v_slot := sepak.claim_slot(v_gk, 'Organiser', '60111111111', v_admin_token);
  assert v_slot.player_name = 'Organiser', 'an admin should be able to claim before opening';
  v_slot := sepak.move_slot(v_gk, v_st, v_admin_token);
  assert v_slot.id = v_st, 'an admin should be able to move before opening';
  reset role;
  set local request.jwt.claims = '{}';

  -- Holding a device token is not enough: a player presenting the admin's
  -- token (a shared phone, say) is still a player.
  set local role anon;
  begin
    perform sepak.move_slot(v_st, v_lb, v_admin_token);
    raise exception 'a player move before opening must be refused';
  exception when others then
    assert sqlerrm = 'not_open_yet', format('expected not_open_yet, got %s', sqlerrm);
  end;

  -- Releasing is not booking: always allowed, so nobody is trapped.
  perform sepak.release_slot(v_st, v_admin_token);
  reset role;

  ---------------------------------------------------------------------------
  -- At the time, it opens by itself: nothing runs, the next call succeeds.
  ---------------------------------------------------------------------------
  update sepak.sessions set opens_at = now() where id = v_session_id;
  set local role anon;
  v_slot := sepak.claim_slot(v_gk, 'OnTime', '60123456789', v_token);
  assert v_slot.player_name = 'OnTime', 'a claim at the opening time should succeed';

  -- The countdown's clock is public.
  v_now := sepak.server_now();
  assert v_now is not null, 'server_now should answer anon';
  reset role;

  raise notice 'opens_test: ok';
  raise exception 'ROLLBACK_MARKER';
exception when others then
  if sqlerrm = 'ROLLBACK_MARKER' then
    raise notice 'opens_test: rolled back';
  else
    raise;
  end if;
end $$;
