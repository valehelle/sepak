\set ON_ERROR_STOP on

do $$
declare
  v_session_id uuid;
  v_other_id   uuid;
  v_a uuid; v_b uuid; v_c uuid; v_far uuid; v_b2 uuid; v_far2 uuid;
  v_token uuid := gen_random_uuid();
  v_count int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  select id into v_session_id from sepak.create_session(
    903, 'One Slot Test', '2026-09-16', '20:00:00', 120, 'Padang Presint 8', 27,
    'Merah', 'Putih', 'Kuning');
  select id into v_other_id from sepak.create_session(
    904, 'Other Session', '2026-09-23', '20:00:00', 120, 'Padang Presint 8', 27,
    'Merah', 'Putih', 'Kuning');
  select id into v_a from sepak.slots where session_id = v_session_id and team = 'A' and position = 'ST';
  select id into v_b from sepak.slots where session_id = v_session_id and team = 'B' and position = 'GK';
  select id into v_c from sepak.slots where session_id = v_session_id and team = 'C' and position = 'MC';
  select id into v_far from sepak.slots where session_id = v_other_id and team = 'A' and position = 'ST';
  select id into v_b2 from sepak.slots where session_id = v_session_id and team = 'B' and position = 'AM';
  select id into v_far2 from sepak.slots where session_id = v_other_id and team = 'B' and position = 'GK';
  reset role;

  set local request.jwt.claims = '{}';
  set local role anon;

  -- First claim succeeds.
  perform sepak.claim_slot(v_a, 'Hazmi', '60123456789', v_token);

  -- A second claim from the same device is refused, on any team.
  begin
    perform sepak.claim_slot(v_b, 'Hazmi', '60123456789', v_token);
    raise exception 'a device must not hold two slots in one session';
  exception when others then
    assert sqlerrm = 'already_in_slot', format('expected already_in_slot, got %s', sqlerrm);
  end;

  -- Not even under a different name or phone -- the device is the identity.
  begin
    perform sepak.claim_slot(v_c, 'Someone Else', '60111112222', v_token);
    raise exception 'renaming must not buy a second slot';
  exception when others then
    assert sqlerrm = 'already_in_slot', format('expected already_in_slot, got %s', sqlerrm);
  end;

  -- A different device may still take the remaining slots.
  perform sepak.claim_slot(v_b, 'Faiz', '60198765432', gen_random_uuid());

  -- The rule is per session: the same device books a different session fine.
  perform sepak.claim_slot(v_far, 'Hazmi', '60123456789', v_token);

  -- Releasing frees the device to claim again.
  perform sepak.release_slot(v_a, v_token);
  perform sepak.claim_slot(v_c, 'Hazmi', '60123456789', v_token);
  reset role;

  select count(*) into v_count
    from sepak.slots where session_id = v_session_id and claim_token = v_token;
  assert v_count = 1, format('device should hold exactly one slot, holds %s', v_count);

  ---------------------------------------------------------------------------
  -- Same phone number, different device: refused on the pitch and in the
  -- queue. This is the check that actually holds, since a second browser
  -- mints a fresh token for free.
  ---------------------------------------------------------------------------
  set local role anon;
  begin
    perform sepak.claim_slot(v_b2, 'Hazmi Again', '60123456789', gen_random_uuid());
    raise exception 'a second device must not reuse a booked phone number';
  exception when others then
    assert sqlerrm = 'phone_in_use', format('expected phone_in_use, got %s', sqlerrm);
  end;
  begin
    perform sepak.join_waitlist(v_session_id, 'Hazmi Again', '60123456789', array['GK'], gen_random_uuid());
    raise exception 'a booked phone number must not queue as well';
  exception when others then
    assert sqlerrm = 'phone_in_use', format('expected phone_in_use, got %s', sqlerrm);
  end;
  -- A number sitting in the QUEUE also blocks a second device claiming.
  -- Filling RB directly needs a writing role: anon holds no write grant on
  -- slots (0002_rls.sql), so this steps out of anon and back.
  reset role;
  update sepak.slots set player_name = 'Filler', claim_token = gen_random_uuid(), claimed_at = now()
   where session_id = v_session_id and position = 'RB' and player_name is null;
  set local request.jwt.claims = '{}';
  set local role anon;
  perform sepak.join_waitlist(v_session_id, 'Queued', '60155556666', array['RB'], gen_random_uuid());
  begin
    perform sepak.claim_slot(v_b2, 'Queued Elsewhere', '60155556666', gen_random_uuid());
    raise exception 'a queued phone number must not claim from another device';
  exception when others then
    assert sqlerrm = 'phone_in_use', format('expected phone_in_use, got %s', sqlerrm);
  end;
  reset role;

  -- The rule is per session, phone included: the number queued above for
  -- session 903 may still book session 904, from any device.
  set local role anon;
  perform sepak.claim_slot(v_far2, 'Queued Elsewhere', '60155556666', gen_random_uuid());
  reset role;

  -- Duplicate names across different devices remain allowed.
  set local role anon;
  select id into v_a from sepak.slots where session_id = v_session_id and team = 'A' and position = 'LWF';
  perform sepak.claim_slot(v_a, 'Hazmi', '60177778888', gen_random_uuid());
  reset role;
  select count(*) into v_count
    from sepak.slots where session_id = v_session_id and player_name = 'Hazmi';
  assert v_count = 2, format('two different devices may share a name, got %s', v_count);

  raise notice 'one_booking_test: ok';
  raise exception 'ROLLBACK_MARKER';
exception when others then
  if sqlerrm = 'ROLLBACK_MARKER' then
    raise notice 'one_booking_test: rolled back';
  else
    raise;
  end if;
end $$;
