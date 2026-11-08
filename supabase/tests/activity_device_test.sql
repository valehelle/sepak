\set ON_ERROR_STOP on

do $$
declare
  v_session uuid;
  v_gk uuid; v_lb uuid; v_cb uuid;
  v_line record;
begin
  insert into sepak.sessions (session_no, title, play_date, start_time, venue)
  values (982, 'Browser', '2026-12-15', '21:00', 'Padang') returning id into v_session;
  insert into sepak.slots (session_id, team, position) values (v_session, 'A', 'GK') returning id into v_gk;
  insert into sepak.slots (session_id, team, position) values (v_session, 'A', 'LB') returning id into v_lb;
  insert into sepak.slots (session_id, team, position) values (v_session, 'A', 'CB1') returning id into v_cb;

  set local role anon;

  -- A claim through PostgREST: the line keeps the browser and the client's
  -- address, not the proxy's.
  perform set_config('request.headers',
    '{"user-agent":"Mozilla/5.0 (iPhone) WhatsApp","x-forwarded-for":"203.0.113.7, 10.0.0.1"}', true);
  perform sepak.claim_slot(v_gk, 'Amir', '60123456789', '66666666-6666-4666-8666-666666666666');
  perform sepak.set_slot_paid(v_gk, '66666666-6666-4666-8666-666666666666', true);

  -- Headers that are not JSON must not stop a booking.
  perform set_config('request.headers', 'not json', true);
  perform sepak.claim_slot(v_lb, 'Bella', '60122222222', gen_random_uuid());

  -- No request at all (psql, a migration): nothing to record.
  perform set_config('request.headers', '', true);
  perform sepak.claim_slot(v_cb, 'Chong', '60133333333', gen_random_uuid());

  -- anon cannot call the helper to read headers back.
  begin
    perform sepak.request_header('user-agent');
    raise exception 'anon must not call request_header';
  exception when insufficient_privilege then null;
  end;

  reset role;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000ad","email":"admin@sepak.local","role":"authenticated"}';

  select * into v_line from sepak.session_activity(v_session) where player_name = 'Amir' and kind = 'claim';
  assert v_line.user_agent = 'Mozilla/5.0 (iPhone) WhatsApp', format('user_agent: got %s', v_line.user_agent);
  assert v_line.ip = '203.0.113.7', format('ip: got %s', v_line.ip);

  -- The device code is the booking token's hash, the same six digits
  -- src/lib/deviceCode.test.ts expects for this token, on every line about
  -- the booking.
  select * into v_line from sepak.session_activity(v_session) where player_name = 'Amir' and kind = 'claim';
  assert v_line.device = 'a9703d', format('claim device: got %s', v_line.device);
  select * into v_line from sepak.session_activity(v_session) where player_name = 'Amir' and kind = 'paid';
  assert v_line.device = 'a9703d', format('paid device: got %s', v_line.device);

  -- An admin clearing the slot: the line names the booking's device, not
  -- the admin's (who has none).
  update sepak.slots set player_name = null, claim_token = null, claimed_at = null where id = v_gk;
  select * into v_line from sepak.session_activity(v_session) where kind = 'admin_clear';
  assert v_line.device = 'a9703d', format('admin_clear device: got %s', v_line.device);

  select * into v_line from sepak.session_activity(v_session) where player_name = 'Bella';
  assert v_line.user_agent is null and v_line.ip is null, 'malformed headers must record nothing';

  select * into v_line from sepak.session_activity(v_session) where player_name = 'Chong';
  assert v_line.user_agent is null and v_line.ip is null, 'no headers must record nothing';

  reset role;

  raise notice 'activity_device_test: ok';
  raise exception 'ROLLBACK_MARKER';
exception when others then
  if sqlerrm = 'ROLLBACK_MARKER' then
    raise notice 'activity_device_test: rolled back';
  else
    raise;
  end if;
end $$;
