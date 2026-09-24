\set ON_ERROR_STOP on

do $$
declare
  v_session_id uuid;
  v_st_a uuid; v_st_b uuid; v_st_c uuid; v_gk_b uuid;
  v_token  uuid := gen_random_uuid();
  v_token2 uuid := gen_random_uuid();
  v_paid   boolean;
  v_paid_at timestamptz;
  v_name   text;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  select id into v_session_id from sepak.create_session(
    905, 'Paid Test', '2026-09-30', '20:00:00', 120, 'Padang Presint 8', 27,
    'Merah', 'Putih', 'Kuning');
  select id into v_st_a from sepak.slots where session_id = v_session_id and team = 'A' and position = 'ST';
  select id into v_st_b from sepak.slots where session_id = v_session_id and team = 'B' and position = 'ST';
  select id into v_st_c from sepak.slots where session_id = v_session_id and team = 'C' and position = 'ST';
  select id into v_gk_b from sepak.slots where session_id = v_session_id and team = 'B' and position = 'GK';
  reset role;

  set local request.jwt.claims = '{}';
  set local role anon;
  perform sepak.claim_slot(v_st_a, 'Hazmi', '60123456789', v_token);

  -- A new slot starts unpaid.
  reset role;
  select paid into v_paid from sepak.slots where id = v_st_a;
  assert not v_paid, 'a fresh claim must start unpaid';

  -- Only the claiming device may tick it.
  set local role anon;
  begin
    perform sepak.set_slot_paid(v_st_a, gen_random_uuid(), true);
    raise exception 'another device must not tick this slot';
  exception when others then
    assert sqlerrm = 'wrong_token', format('expected wrong_token, got %s', sqlerrm);
  end;

  perform sepak.set_slot_paid(v_st_a, v_token, true);
  reset role;
  select paid, paid_at into v_paid, v_paid_at from sepak.slots where id = v_st_a;
  assert v_paid, 'the owning device''s tick should stick';
  assert v_paid_at is not null, 'ticking must stamp paid_at';

  -- And untick it: a mis-tap is recoverable.
  set local role anon;
  perform sepak.set_slot_paid(v_st_a, v_token, false);
  reset role;
  select paid, paid_at into v_paid, v_paid_at from sepak.slots where id = v_st_a;
  assert not v_paid, 'unticking should clear paid';
  assert v_paid_at is null, 'unticking should clear paid_at';

  -- An empty slot has nobody to pay.
  set local role anon;
  begin
    perform sepak.set_slot_paid(v_gk_b, v_token, true);
    raise exception 'an empty slot must not be markable as paid';
  exception when others then
    assert sqlerrm = 'slot_empty', format('expected slot_empty, got %s', sqlerrm);
  end;

  ---------------------------------------------------------------------------
  -- The tick belongs to the person, not the position: vacating clears it.
  ---------------------------------------------------------------------------
  perform sepak.set_slot_paid(v_st_a, v_token, true);
  perform sepak.release_slot(v_st_a, v_token);
  reset role;
  select paid, paid_at, player_name into v_paid, v_paid_at, v_name
    from sepak.slots where id = v_st_a;
  assert v_name is null, 'the slot should be empty after release';
  assert not v_paid and v_paid_at is null, 'releasing must clear the tick';

  ---------------------------------------------------------------------------
  -- Admin override: the organiser can tick or untick anyone's slot to fix a
  -- mistake, without holding that device's token.
  ---------------------------------------------------------------------------
  set local role anon;
  perform sepak.claim_slot(v_st_a, 'Faiz', '60198765432', v_token2);
  reset role;

  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  perform sepak.set_slot_paid(v_st_a, gen_random_uuid(), true);
  reset role;
  set local request.jwt.claims = '{}';
  select paid into v_paid from sepak.slots where id = v_st_a;
  assert v_paid, 'an admin should be able to tick someone else''s slot';

  -- A signed-in non-admin gets no such override.
  set local role authenticated;
  set local request.jwt.claims = '{"email":"nobody@example.test","role":"authenticated"}';
  begin
    perform sepak.set_slot_paid(v_st_a, gen_random_uuid(), false);
    raise exception 'a signed-in non-admin must not untick another slot';
  exception when others then
    assert sqlerrm = 'wrong_token', format('expected wrong_token, got %s', sqlerrm);
  end;
  reset role;
  set local request.jwt.claims = '{}';

  ---------------------------------------------------------------------------
  -- slots_paid_complete holds even against a direct writer, so no code path
  -- can leave a paid tick on an empty slot.
  ---------------------------------------------------------------------------
  begin
    update sepak.slots set paid = true, paid_at = now() where id = v_gk_b;
    raise exception 'an empty slot must not be storable as paid';
  exception when others then
    assert sqlerrm like '%slots_paid_complete%', format('expected the paid constraint, got %s', sqlerrm);
  end;

  ---------------------------------------------------------------------------
  -- Auto-fill from the waitlist installs a NEW person, who has not paid --
  -- the previous occupant's tick must not be inherited.
  ---------------------------------------------------------------------------
  update sepak.slots
     set player_name = 'Filler', claim_token = gen_random_uuid(), claimed_at = now()
   where session_id = v_session_id and position = 'ST' and team <> 'A';

  set local role anon;
  perform sepak.join_waitlist(v_session_id, 'Queued', '60155556666', array['ST'], gen_random_uuid());
  -- Faiz's slot is ticked (above); releasing it hands ST to the queue.
  perform sepak.release_slot(v_st_a, v_token2);
  reset role;

  select paid, paid_at, player_name into v_paid, v_paid_at, v_name
    from sepak.slots where id = v_st_a;
  assert v_name = 'Queued', format('auto-fill should have installed Queued, got %s', v_name);
  assert not v_paid and v_paid_at is null, 'the next occupant must start unpaid';

  raise notice 'paid_test: ok';
  raise exception 'ROLLBACK_MARKER';
exception when others then
  if sqlerrm = 'ROLLBACK_MARKER' then
    raise notice 'paid_test: rolled back';
  else
    raise;
  end if;
end $$;
