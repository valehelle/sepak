\set ON_ERROR_STOP on

do $$
declare
  v_session_id uuid;
  v_gk uuid;
  v_st uuid;
  v_other_session uuid;
  v_other_gk uuid;
  v_token uuid := gen_random_uuid();
  v_intruder uuid := gen_random_uuid();
  v_count int;
begin
  -- create_session builds a whole session in one shot
  set local role authenticated;
  select id into v_session_id from public.create_session(
    1, 'Geng Turun Peluh', '2026-09-16', '20:00:00', 120, 'Padang Presint 8', 27,
    'Merah', 'Putih', 'Kuning');

  select count(*) into v_count from public.slots where session_id = v_session_id;
  assert v_count = 33, format('expected 33 slots, got %s', v_count);
  assert (select count(distinct team) from public.slots where session_id = v_session_id) = 3,
    'expected three teams';
  assert (select count(*) from public.slots where session_id = v_session_id and team = 'A') = 11,
    'expected eleven positions per team';

  select id into v_gk from public.slots where session_id = v_session_id and team = 'A' and position = 'GK';
  select id into v_st from public.slots where session_id = v_session_id and team = 'A' and position = 'ST';
  reset role;

  ---------------------------------------------------------------------------
  -- anon has no direct write access to either table
  ---------------------------------------------------------------------------
  set local role anon;

  assert (select count(*) from public.sessions) >= 1, 'anon should be able to read sessions';
  assert (select count(*) from public.slots) >= 33, 'anon should be able to read slots';

  begin
    insert into public.sessions (session_no, title, play_date, start_time, venue)
    values (99, 'Rogue', '2026-09-20', '20:00:00', 'Nowhere');
    raise exception 'anon must not insert sessions';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.slots set player_name = 'Rogue', claim_token = gen_random_uuid(), claimed_at = now()
    where id = v_gk;
    raise exception 'anon must not update slots directly';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.slots where id = v_gk;
    raise exception 'anon must not delete slots';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.create_session(2, 'Rogue', '2026-09-20', '20:00:00', 120, 'Nowhere', 10,
      'Merah', 'Putih', 'Kuning');
    raise exception 'anon must not create sessions';
  exception when insufficient_privilege then null;
  end;

  ---------------------------------------------------------------------------
  -- claim_slot
  ---------------------------------------------------------------------------
  perform public.claim_slot(v_gk, 'Hazmi', v_token);
  assert (select player_name from public.slots where id = v_gk) = 'Hazmi', 'claim should set the name';
  assert (select claim_token from public.slots where id = v_gk) = v_token, 'claim should store the token';

  begin
    perform public.claim_slot(v_gk, 'Intruder', v_intruder);
    raise exception 'claiming an occupied slot must fail';
  exception when others then
    assert sqlerrm = 'slot_taken', format('expected slot_taken, got %s', sqlerrm);
  end;

  begin
    perform public.claim_slot(v_st, '   ', v_token);
    raise exception 'a blank name must be rejected';
  exception when others then
    assert sqlerrm = 'invalid_name', format('expected invalid_name, got %s', sqlerrm);
  end;

  begin
    perform public.claim_slot(v_st, repeat('x', 41), v_token);
    raise exception 'an over-long name must be rejected';
  exception when others then
    assert sqlerrm = 'invalid_name', format('expected invalid_name, got %s', sqlerrm);
  end;

  begin
    perform public.claim_slot(gen_random_uuid(), 'Ghost', v_token);
    raise exception 'claiming a nonexistent slot must fail';
  exception when others then
    assert sqlerrm = 'slot_not_found', format('expected slot_not_found, got %s', sqlerrm);
  end;

  -- names are trimmed on the way in
  perform public.claim_slot(v_st, '  Zulazhar  ', v_token);
  assert (select player_name from public.slots where id = v_st) = 'Zulazhar', 'claim should trim the name';

  ---------------------------------------------------------------------------
  -- release_slot: the token is the authorisation
  ---------------------------------------------------------------------------
  begin
    perform public.release_slot(v_gk, v_intruder);
    raise exception 'releasing another device''s slot must fail';
  exception when others then
    assert sqlerrm = 'wrong_token', format('expected wrong_token, got %s', sqlerrm);
  end;
  assert (select player_name from public.slots where id = v_gk) = 'Hazmi',
    'a rejected release must leave the slot untouched';

  perform public.release_slot(v_gk, v_token);
  assert (select player_name from public.slots where id = v_gk) is null, 'release should empty the slot';
  assert (select claim_token from public.slots where id = v_gk) is null, 'release should clear the token';

  begin
    perform public.release_slot(v_gk, v_token);
    raise exception 'releasing an empty slot must fail';
  exception when others then
    assert sqlerrm = 'slot_empty', format('expected slot_empty, got %s', sqlerrm);
  end;

  ---------------------------------------------------------------------------
  -- move_slot
  ---------------------------------------------------------------------------
  perform public.move_slot(v_st, v_gk, v_token);
  assert (select player_name from public.slots where id = v_gk) = 'Zulazhar', 'move should fill the target';
  assert (select player_name from public.slots where id = v_st) is null, 'move should empty the source';

  begin
    perform public.move_slot(v_gk, v_gk, v_token);
    raise exception 'moving onto the same slot must fail';
  exception when others then
    assert sqlerrm = 'same_slot', format('expected same_slot, got %s', sqlerrm);
  end;

  begin
    perform public.move_slot(v_gk, v_st, v_intruder);
    raise exception 'moving with the wrong token must fail';
  exception when others then
    assert sqlerrm = 'wrong_token', format('expected wrong_token, got %s', sqlerrm);
  end;

  -- moving across sessions is refused
  reset role;
  set local role authenticated;
  select id into v_other_session from public.create_session(
    2, 'Lain', '2026-09-23', '20:00:00', 120, 'Padang Lain', 27, 'Merah', 'Putih', 'Kuning');
  select id into v_other_gk from public.slots
   where session_id = v_other_session and team = 'A' and position = 'GK';
  reset role;
  set local role anon;

  begin
    perform public.move_slot(v_gk, v_other_gk, v_token);
    raise exception 'moving across sessions must fail';
  exception when others then
    assert sqlerrm = 'cross_session', format('expected cross_session, got %s', sqlerrm);
  end;

  ---------------------------------------------------------------------------
  -- a closed session rejects every mutation
  ---------------------------------------------------------------------------
  reset role;
  update public.sessions set status = 'closed' where id = v_session_id;
  set local role anon;

  begin
    perform public.claim_slot(v_st, 'Latecomer', v_intruder);
    raise exception 'claiming in a closed session must fail';
  exception when others then
    assert sqlerrm = 'session_closed', format('expected session_closed, got %s', sqlerrm);
  end;

  begin
    perform public.release_slot(v_gk, v_token);
    raise exception 'releasing in a closed session must fail';
  exception when others then
    assert sqlerrm = 'session_closed', format('expected session_closed, got %s', sqlerrm);
  end;

  reset role;
  raise notice 'rls_test: all assertions passed';
end $$;
