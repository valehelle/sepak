\set ON_ERROR_STOP on

do $$
declare
  v_session uuid;
  v_gk uuid; v_lb uuid; v_cb uuid;
  v_owner    uuid := '11111111-1111-4111-8111-111111111111';
  v_new      uuid := '22222222-2222-4222-8222-222222222222';
  v_stranger uuid := '33333333-3333-4333-8333-333333333333';
  v_lb_owner uuid := '44444444-4444-4444-8444-444444444444';
  v_chat bigint := 900001;
  v_req uuid; v_req2 uuid;
  v_text text;
  v_ok boolean;
  v_row record;
begin
  insert into sepak.sessions (session_no, title, play_date, start_time, venue)
  values (983, 'Move', '2026-12-22', '21:00', 'Padang') returning id into v_session;
  insert into sepak.slots (session_id, team, position) values (v_session, 'A', 'GK') returning id into v_gk;
  insert into sepak.slots (session_id, team, position) values (v_session, 'A', 'LB') returning id into v_lb;
  insert into sepak.slots (session_id, team, position) values (v_session, 'A', 'CB1') returning id into v_cb;

  set local role anon;
  perform sepak.claim_slot(v_gk, 'Amir', '60123456789', v_owner);
  perform sepak.set_slot_paid(v_gk, v_owner, true);
  perform sepak.claim_slot(v_lb, 'Bella', '60122222222', v_lb_owner);
  reset role;

  -- Amir's booking browser connected Telegram; Bella's did not.
  insert into sepak.telegram_chats (chat_id, claim_token) values (v_chat, v_owner);

  set local role anon;
  assert sepak.move_available(v_gk), 'a booking with Telegram offers the move';
  assert not sepak.move_available(v_lb), 'a booking without Telegram does not';
  assert not sepak.move_available(v_cb), 'an empty slot does not';

  begin
    perform sepak.request_move(v_lb, v_new);
    raise exception 'expected no_telegram';
  exception when others then
    assert sqlerrm = 'no_telegram', format('expected no_telegram, got %s', sqlerrm);
  end;

  begin
    perform sepak.request_move(v_gk, v_owner);
    raise exception 'expected already_yours';
  exception when others then
    assert sqlerrm = 'already_yours', format('expected already_yours, got %s', sqlerrm);
  end;

  -- A browser that already holds a place in this session cannot take another.
  begin
    perform sepak.request_move(v_gk, v_lb_owner);
    raise exception 'expected already_in_slot';
  exception when others then
    assert sqlerrm = 'already_in_slot', format('expected already_in_slot, got %s', sqlerrm);
  end;

  v_req := sepak.request_move(v_gk, v_new);
  -- Asking again from the same browser returns the open request.
  assert sepak.request_move(v_gk, v_new) = v_req, 'a repeat ask reuses the open request';
  -- Another browser cannot open a second one meanwhile.
  begin
    perform sepak.request_move(v_gk, v_stranger);
    raise exception 'expected move_pending';
  exception when others then
    assert sqlerrm = 'move_pending', format('expected move_pending, got %s', sqlerrm);
  end;

  assert sepak.move_request_status(v_req, v_new) = 'pending', 'the asker sees pending';
  begin
    perform sepak.move_request_status(v_req, v_stranger);
    raise exception 'expected not_found';
  exception when others then
    assert sqlerrm = 'not_found', format('another browser must not read the request, got %s', sqlerrm);
  end;

  -- anon cannot answer for Telegram, read the message, or see the table.
  begin
    perform sepak.decide_move(v_req, v_chat, true);
    raise exception 'anon must not call decide_move';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from sepak.move_request_message(v_req);
    raise exception 'anon must not call move_request_message';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from sepak.move_requests;
    raise exception 'anon must not read move_requests';
  exception when insufficient_privilege then null;
  end;
  reset role;

  set local role service_role;
  select body into v_text from sepak.move_request_message(v_req);
  assert v_text like '%Amir — Team%Sesi 983%', format('message: got %s', v_text);

  -- Only the chat the request went to can answer.
  assert sepak.decide_move(v_req, 999999, true) = 'not_found', 'another chat cannot approve';

  assert sepak.decide_move(v_req, v_chat, true) = 'approved', 'the booking''s chat approves';
  assert sepak.decide_move(v_req, v_chat, true) = 'approved', 'a second press reports the same outcome';
  reset role;

  select claim_token, paid into v_row from sepak.slots where id = v_gk;
  assert v_row.claim_token = v_new, 'the slot now belongs to the asking browser';
  assert v_row.paid, 'moving keeps the paid tick';
  assert (select claim_token from sepak.telegram_chats where chat_id = v_chat) = v_new,
    'the Telegram link follows the booking';

  set local role anon;
  assert sepak.move_request_status(v_req, v_new) = 'approved', 'the asker sees approved';
  -- The new browser can now act on the booking.
  perform sepak.set_slot_paid(v_gk, v_new, false);
  reset role;

  select kind, actor, device, phone into v_row from sepak.activity
   where slot_id = v_gk and kind = 'moved';
  assert found, 'the move is logged';
  assert v_row.actor = 'player' and v_row.phone = '60123456789', 'the move line names the player';
  assert v_row.device = sepak.device_code(v_new), 'the move line carries the new device';

  -- Rejecting leaves the booking where it is.
  set local role anon;
  v_req2 := sepak.request_move(v_gk, v_owner);
  reset role;
  set local role service_role;
  assert sepak.decide_move(v_req2, v_chat, false) = 'rejected', 'the booking''s chat rejects';
  reset role;
  assert (select claim_token from sepak.slots where id = v_gk) = v_new, 'a rejection moves nothing';

  -- A request outlived by a change of hands does nothing.
  set local role anon;
  v_req := sepak.request_move(v_gk, v_owner);
  perform sepak.release_slot(v_gk, v_new);
  perform sepak.claim_slot(v_gk, 'Chong', '60133333333', v_stranger);
  reset role;
  set local role service_role;
  assert sepak.decide_move(v_req, v_chat, true) = 'stale', 'a changed booking is stale';
  reset role;
  assert (select claim_token from sepak.slots where id = v_gk) = v_stranger, 'a stale approval moves nothing';

  -- Three messages an hour per booking, however many browsers ask.
  delete from sepak.move_requests;
  insert into sepak.telegram_chats (chat_id, claim_token) values (900002, v_stranger);
  set local role anon;
  v_req := sepak.request_move(v_gk, v_owner);
  reset role;
  update sepak.move_requests set status = 'rejected';
  set local role anon;
  v_req := sepak.request_move(v_gk, v_owner);
  reset role;
  update sepak.move_requests set status = 'rejected';
  set local role anon;
  v_req := sepak.request_move(v_gk, v_owner);
  reset role;
  update sepak.move_requests set status = 'rejected';
  set local role anon;
  begin
    perform sepak.request_move(v_gk, v_owner);
    raise exception 'expected too_many_requests';
  exception when others then
    assert sqlerrm = 'too_many_requests', format('expected too_many_requests, got %s', sqlerrm);
  end;
  reset role;

  -- After ten minutes an open request counts as expired and cannot be approved.
  delete from sepak.move_requests;
  set local role anon;
  v_req := sepak.request_move(v_gk, v_owner);
  reset role;
  update sepak.move_requests set created_at = clock_timestamp() - interval '11 minutes' where id = v_req;
  set local role anon;
  assert sepak.move_request_status(v_req, v_owner) = 'expired', 'an old request reads expired';
  reset role;
  set local role service_role;
  assert sepak.decide_move(v_req, 900002, true) = 'expired', 'an expired request cannot be approved';
  assert not exists (select 1 from sepak.move_request_message(v_req)), 'an expired request sends nothing';
  reset role;

  raise notice 'move_booking_test: ok';
  raise exception 'ROLLBACK_MARKER';
exception when others then
  if sqlerrm = 'ROLLBACK_MARKER' then
    raise notice 'move_booking_test: rolled back';
  else
    raise;
  end if;
end $$;
