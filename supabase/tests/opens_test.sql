\set ON_ERROR_STOP on

do $$
declare
  v_session_id uuid;
  v_gk uuid; v_st uuid; v_lb uuid;
  v_admin_token uuid := gen_random_uuid();
  v_token uuid := gen_random_uuid();
  v_slot sepak.slots;
  v_now timestamptz;
  v_open_id uuid;
  v_count int;
  v_kind text;
  v_from timestamptz;
  v_to timestamptz;
  v_who text;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  select id into v_session_id from sepak.create_session(
    930, 'Opens Test', '2026-12-01', '21:00:00', 120, 'Padang', 25, '', '', '', '', null,
    now() + interval '1 day');
  select id into v_open_id from sepak.create_session(
    931, 'Opens Now', '2026-12-08', '21:00:00', 120, 'Padang', 25, '', '', '');
  select id into v_gk from sepak.slots where session_id = v_session_id and team = 'A' and position = 'GK';
  select id into v_st from sepak.slots where session_id = v_session_id and team = 'A' and position = 'ST';
  select id into v_lb from sepak.slots where session_id = v_session_id and team = 'B' and position = 'LB';
  reset role;
  set local request.jwt.claims = '{}';

  -- A session made without a time opens at once (direct callers, tests).
  assert (select opens_at <= now() from sepak.sessions where id = v_open_id),
    'a session with no opening time given should already be open';
  assert (select opens_at > now() from sepak.sessions where id = v_session_id),
    'the opening time passed to create_session should be stored';

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
  -- Before it passes, an admin can move the time, and the move is logged
  -- with who made it.
  ---------------------------------------------------------------------------
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  update sepak.sessions set opens_at = now() + interval '2 days' where id = v_session_id;
  get diagnostics v_count = row_count;
  assert v_count = 1, 'an admin should be able to postpone before opening';
  -- Saving the form without touching the time is not a change.
  update sepak.sessions set title = 'Opens Test 2', opens_at = opens_at where id = v_session_id;
  reset role;
  set local request.jwt.claims = '{}';

  select count(*) into v_count from sepak.activity
   where session_id = v_session_id and kind = 'opens_changed';
  assert v_count = 1, format('expected one opens_changed line, found %s', v_count);
  select actor, opens_from, opens_to, player_name into v_kind, v_from, v_to, v_who
    from sepak.activity where session_id = v_session_id and kind = 'opens_changed';
  assert v_kind = 'admin', format('the change should be logged as admin, got %s', v_kind);
  assert v_to - v_from = interval '1 day', 'the log should carry both times';
  assert v_who = 'admin@sepak.local', format('the log should name who moved it, got %s', v_who);

  ---------------------------------------------------------------------------
  -- At the time, it opens by itself: nothing runs, the next call succeeds.
  ---------------------------------------------------------------------------
  update sepak.sessions set opens_at = now() where id = v_session_id;
  set local role anon;
  v_slot := sepak.claim_slot(v_gk, 'OnTime', '60123456789', v_token);
  assert v_slot.player_name = 'OnTime', 'a claim at the opening time should succeed';

  reset role;

  ---------------------------------------------------------------------------
  -- Once open, the time is locked for everyone: an admin, and the SQL
  -- editor's own superuser. Closing it again is exactly what must not work.
  ---------------------------------------------------------------------------
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  begin
    update sepak.sessions set opens_at = now() + interval '1 day' where id = v_session_id;
    raise exception 'an admin must not move an opening time that has passed';
  exception when others then
    assert sqlerrm = 'opens_locked', format('expected opens_locked, got %s', sqlerrm);
  end;
  reset role;
  set local request.jwt.claims = '{}';
  begin
    update sepak.sessions set opens_at = now() + interval '1 day' where id = v_session_id;
    raise exception 'a direct edit must not move an opening time that has passed';
  exception when others then
    assert sqlerrm = 'opens_locked', format('expected opens_locked, got %s', sqlerrm);
  end;
  -- Other fields stay editable after opening.
  update sepak.sessions set venue = 'Padang Baru' where id = v_session_id;

  set local role anon;
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
