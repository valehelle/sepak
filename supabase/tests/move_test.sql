\set ON_ERROR_STOP on

do $$
declare
  v_session_id uuid;
  v_other_id   uuid;
  v_gk_a  uuid; v_st_a uuid; v_st_b uuid; v_gk_c uuid; v_lb_a uuid;
  v_other_gk uuid;
  v_token  uuid := gen_random_uuid();
  v_token2 uuid := gen_random_uuid();
  v_queued uuid := gen_random_uuid();
  v_slot   sepak.slots;
  v_name   text;
  v_paid   boolean;
  v_paid_at timestamptz;
  v_phone  text;
  v_count  int;
  v_kinds  text[];
  v_mark   bigint;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  select id into v_session_id from sepak.create_session(
    910, 'Move Test', '2026-12-01', '20:00:00', 120, 'Padang Presint 8', 27,
    'Merah', 'Putih', 'Kuning');
  select id into v_other_id from sepak.create_session(
    911, 'Other Session', '2026-12-08', '20:00:00', 120, 'Padang Presint 8', 27,
    'Merah', 'Putih', 'Kuning');
  select id into v_gk_a from sepak.slots where session_id = v_session_id and team = 'A' and position = 'GK';
  select id into v_st_a from sepak.slots where session_id = v_session_id and team = 'A' and position = 'ST';
  select id into v_st_b from sepak.slots where session_id = v_session_id and team = 'B' and position = 'ST';
  select id into v_gk_c from sepak.slots where session_id = v_session_id and team = 'C' and position = 'GK';
  select id into v_lb_a from sepak.slots where session_id = v_session_id and team = 'A' and position = 'LB';
  select id into v_other_gk from sepak.slots where session_id = v_other_id and team = 'A' and position = 'GK';
  reset role;
  set local request.jwt.claims = '{}';

  set local role anon;
  perform sepak.claim_slot(v_gk_a, 'Hazmi', '60123456789', v_token);

  ---------------------------------------------------------------------------
  -- Refusals. None of these are reachable from the app's own UI, which only
  -- offers empty slots in the same session -- but the RPC is public, so each
  -- one is the RPC's own promise rather than the client's.
  ---------------------------------------------------------------------------
  begin
    perform sepak.move_slot(v_gk_a, v_gk_a, v_token);
    raise exception 'a move onto itself must be refused';
  exception when others then
    assert sqlerrm = 'same_slot', format('expected same_slot, got %s', sqlerrm);
  end;

  begin
    perform sepak.move_slot(v_gk_a, v_st_a, gen_random_uuid());
    raise exception 'another device must not move this slot';
  exception when others then
    assert sqlerrm = 'wrong_token', format('expected wrong_token, got %s', sqlerrm);
  end;

  begin
    perform sepak.move_slot(v_st_a, v_st_b, v_token);
    raise exception 'an empty source must be refused';
  exception when others then
    assert sqlerrm = 'slot_empty', format('expected slot_empty, got %s', sqlerrm);
  end;

  begin
    perform sepak.move_slot(v_gk_a, v_other_gk, v_token);
    raise exception 'a move into another session must be refused';
  exception when others then
    assert sqlerrm = 'cross_session', format('expected cross_session, got %s', sqlerrm);
  end;

  begin
    perform sepak.move_slot(v_gk_a, gen_random_uuid(), v_token);
    raise exception 'an unknown destination must be refused';
  exception when others then
    assert sqlerrm = 'slot_not_found', format('expected slot_not_found, got %s', sqlerrm);
  end;

  -- An occupied destination.
  perform sepak.claim_slot(v_st_b, 'Faiz', '60177778888', v_token2);
  begin
    perform sepak.move_slot(v_gk_a, v_st_b, v_token);
    raise exception 'a taken destination must be refused';
  exception when others then
    assert sqlerrm = 'slot_taken', format('expected slot_taken, got %s', sqlerrm);
  end;

  ---------------------------------------------------------------------------
  -- The move itself, with the tick set beforehand: paying and then changing
  -- position must not un-pay you.
  ---------------------------------------------------------------------------
  perform sepak.set_slot_paid(v_gk_a, v_token, true);
  reset role;
  select paid_at into v_paid_at from sepak.slots where id = v_gk_a;
  assert v_paid_at is not null, 'the tick should carry a timestamp';
  -- Everything the move logs comes after this point, which is the only way
  -- to tell the restored tick apart from the one set just above.
  select coalesce(max(id), 0) into v_mark from sepak.activity;

  set local role anon;
  v_slot := sepak.move_slot(v_gk_a, v_gk_c, v_token);
  assert v_slot.id = v_gk_c, 'the move should return the destination row';
  assert v_slot.player_name = 'Hazmi', format('unexpected occupant %s', v_slot.player_name);
  assert v_slot.paid, 'the tick must travel with the player';
  assert v_slot.paid_at = v_paid_at, 'the tick keeps the moment it was made, not the move';

  reset role;
  select player_name, paid, paid_at into v_name, v_paid, v_paid_at
    from sepak.slots where id = v_gk_a;
  assert v_name is null, 'the source must be empty afterwards';
  assert not v_paid and v_paid_at is null, 'an empty source cannot stay paid';

  -- Team C is a different shirt from Team A: a move is allowed to cross.
  select team into v_name from sepak.slots where id = v_gk_c;
  assert v_name = 'C', format('expected the destination team C, got %s', v_name);

  -- The phone followed the player, on the destination and only there.
  select phone into v_phone from sepak.contacts where slot_id = v_gk_c;
  assert v_phone = '60123456789', format('expected the phone to move, got %s', v_phone);
  select count(*) into v_count from sepak.contacts where slot_id = v_gk_a;
  assert v_count = 0, 'the source must not keep a contact row';
  select count(*) into v_count from sepak.contacts where phone = '60123456789';
  assert v_count = 1, format('the number must exist exactly once, found %s', v_count);

  -- Still one booking: the whole point of a move rather than a second claim.
  select count(*) into v_count from sepak.slots
   where session_id = v_session_id and claim_token = v_token;
  assert v_count = 1, format('expected one slot for this device, found %s', v_count);

  ---------------------------------------------------------------------------
  -- What the organiser sees: release, claim, and the restored tick, each
  -- carrying the number -- the release line especially, since that is the
  -- one written while the contacts row is being deleted.
  ---------------------------------------------------------------------------
  select array_agg(kind order by id) into v_kinds
    from sepak.activity
   where session_id = v_session_id and player_name = 'Hazmi' and id > v_mark;
  assert v_kinds = array['release', 'claim', 'paid'],
    format('unexpected move log: %s', v_kinds);

  select count(*) into v_count
    from sepak.activity
   where session_id = v_session_id and player_name = 'Hazmi'
     and kind in ('release', 'claim') and phone is null;
  assert v_count = 0, 'every line about a move must carry the number';

  ---------------------------------------------------------------------------
  -- Leaving a position hands it straight to whoever is queued for it, in
  -- this same transaction. That is what stops a move being a way to hold
  -- two places, and it is why a move cannot be taken back.
  ---------------------------------------------------------------------------
  update sepak.slots
     set player_name = 'Filler', claim_token = gen_random_uuid(), claimed_at = now()
   where session_id = v_session_id and player_name is null and id <> v_lb_a;

  set local role anon;
  perform sepak.join_waitlist(v_session_id, 'Queued', '60155556666', array['GK'], v_queued);
  -- Hazmi now holds C-GK and moves off it to the one free slot, A-LB.
  perform sepak.move_slot(v_gk_c, v_lb_a, v_token);
  reset role;

  select player_name into v_name from sepak.slots where id = v_gk_c;
  assert v_name = 'Queued', format('the queue should have taken C-GK, got %s', v_name);
  select player_name into v_name from sepak.slots where id = v_lb_a;
  assert v_name = 'Hazmi', format('Hazmi should hold A-LB, got %s', v_name);

  -- The promoted player arrives unpaid even though the slot was paid a
  -- moment ago: the tick belongs to the person, not the position.
  select paid into v_paid from sepak.slots where id = v_gk_c;
  assert not v_paid, 'the promoted player must start unpaid';

  ---------------------------------------------------------------------------
  -- A closed session is closed to moves as well.
  ---------------------------------------------------------------------------
  update sepak.sessions set status = 'closed' where id = v_session_id;
  set local role anon;
  begin
    perform sepak.move_slot(v_lb_a, v_st_a, v_token);
    raise exception 'a closed session must refuse a move';
  exception when others then
    assert sqlerrm = 'session_closed', format('expected session_closed, got %s', sqlerrm);
  end;
  reset role;

  raise notice 'move_test: ok';
  raise exception 'ROLLBACK_MARKER';
exception when others then
  if sqlerrm = 'ROLLBACK_MARKER' then
    raise notice 'move_test: rolled back';
  else
    raise;
  end if;
end $$;
