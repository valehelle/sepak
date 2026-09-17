\set ON_ERROR_STOP on

do $$
declare
  v_session_id uuid;
  v_gk uuid; v_st uuid; v_mc uuid;
  v_token uuid := gen_random_uuid();
  v_faiz  uuid := gen_random_uuid();
  v_result jsonb;
  v_wait_id uuid;
  v_phone text;
  v_count int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  select id into v_session_id from sepak.create_session(
    902, 'Contacts Test', '2026-09-16', '20:00:00', 120, 'Padang Presint 8', 27,
    'Merah', 'Putih', 'Kuning');
  select id into v_gk from sepak.slots where session_id = v_session_id and team = 'A' and position = 'GK';
  select id into v_st from sepak.slots where session_id = v_session_id and team = 'A' and position = 'ST';
  select id into v_mc from sepak.slots where session_id = v_session_id and team = 'A' and position = 'MC';
  reset role;

  ---------------------------------------------------------------------------
  -- anon: cannot touch contacts, cannot call contact_phone, and the old
  -- three-argument claim_slot is gone (no ambiguous overload for PostgREST).
  ---------------------------------------------------------------------------
  set local request.jwt.claims = '{}';
  set local role anon;

  begin
    perform count(*) from sepak.contacts;
    raise exception 'anon must not select contacts';
  exception when insufficient_privilege then null;
  end;

  begin
    perform sepak.contact_phone(v_gk, null);
    raise exception 'anon must not execute contact_phone';
  exception when insufficient_privilege then null;
  end;

  begin
    perform sepak.claim_slot(v_gk, 'Old Caller', v_token);
    raise exception 'three-argument claim_slot should no longer exist';
  exception when undefined_function then null;
  end;

  -- Phone is required and must be a Malaysian mobile in 601… form.
  begin
    perform sepak.claim_slot(v_gk, 'Hazmi', null, v_token);
    raise exception 'null phone should be rejected';
  exception when others then
    assert sqlerrm = 'invalid_phone', format('expected invalid_phone, got %s', sqlerrm);
  end;
  begin
    perform sepak.claim_slot(v_gk, 'Hazmi', '0123456789', v_token);
    raise exception 'national-format phone should be rejected (client normalises)';
  exception when others then
    assert sqlerrm = 'invalid_phone', format('expected invalid_phone, got %s', sqlerrm);
  end;
  begin
    perform sepak.claim_slot(v_gk, 'Hazmi', '60312345678', v_token);
    raise exception 'landline should be rejected';
  exception when others then
    assert sqlerrm = 'invalid_phone', format('expected invalid_phone, got %s', sqlerrm);
  end;

  -- A good claim stores the contact; anon still cannot see it.
  perform sepak.claim_slot(v_gk, 'Hazmi', '60123456789', v_token);
  reset role;
  select count(*) into v_count from sepak.contacts where slot_id = v_gk and phone = '60123456789';
  assert v_count = 1, 'claim_slot should store exactly one contact for the slot';

  ---------------------------------------------------------------------------
  -- contact_phone: a signed-in non-admin gets not_admin; an admin gets the
  -- number; an unknown slot yields null rather than an error.
  ---------------------------------------------------------------------------
  set local role authenticated;
  set local request.jwt.claims = '{"email":"stranger@example.com","role":"authenticated"}';
  begin
    perform sepak.contact_phone(v_gk, null);
    raise exception 'non-admin must not read a phone';
  exception when others then
    assert sqlerrm = 'not_admin', format('expected not_admin, got %s', sqlerrm);
  end;
  -- and no direct table access either, allowlist or not
  begin
    perform count(*) from sepak.contacts;
    raise exception 'authenticated must not select contacts directly';
  exception when insufficient_privilege then null;
  end;

  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  select sepak.contact_phone(v_gk, null) into v_phone;
  assert v_phone = '60123456789', format('admin should read the phone, got %s', v_phone);
  select sepak.contact_phone(v_st, null) into v_phone;
  assert v_phone is null, 'an unclaimed slot has no phone';
  begin
    perform sepak.contact_phone(null, null);
    raise exception 'both refs null should be rejected';
  exception when others then
    assert sqlerrm = 'invalid_contact_ref', format('expected invalid_contact_ref, got %s', sqlerrm);
  end;
  begin
    perform count(*) from sepak.contacts;
    raise exception 'even an admin must not select contacts directly';
  exception when insufficient_privilege then null;
  end;
  reset role;

  ---------------------------------------------------------------------------
  -- Release drops the contact.
  ---------------------------------------------------------------------------
  set local request.jwt.claims = '{}';
  set local role anon;
  perform sepak.release_slot(v_gk, v_token);
  reset role;
  select count(*) into v_count from sepak.contacts where slot_id = v_gk;
  assert v_count = 0, 'release_slot should drop the contact';

  ---------------------------------------------------------------------------
  -- The organiser's direct clear (a plain UPDATE, not an RPC) drops it too.
  ---------------------------------------------------------------------------
  set local role anon;
  perform sepak.claim_slot(v_gk, 'Hazmi', '60123456789', v_token);
  reset role;
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  update sepak.slots set player_name = null, claim_token = null, claimed_at = null where id = v_gk;
  reset role;
  select count(*) into v_count from sepak.contacts where slot_id = v_gk;
  assert v_count = 0, 'admin clear should drop the contact';

  ---------------------------------------------------------------------------
  -- Waitlist: join stores a contact on the queue entry; auto-fill MOVES it
  -- onto the slot (one row throughout); leaving cascades it away.
  ---------------------------------------------------------------------------
  set local request.jwt.claims = '{}';
  set local role anon;
  begin
    perform sepak.join_waitlist(v_session_id, 'Faiz', array['GK'], v_faiz);
    raise exception 'four-argument join_waitlist should no longer exist';
  exception when undefined_function then null;
  end;
  begin
    perform sepak.join_waitlist(v_session_id, 'Faiz', 'nope', array['GK'], v_faiz);
    raise exception 'bad phone should be rejected on the waitlist too';
  exception when others then
    assert sqlerrm = 'invalid_phone', format('expected invalid_phone, got %s', sqlerrm);
  end;

  -- Fill every GK so Faiz genuinely queues.
  reset role;
  update sepak.slots set player_name = 'Filler', claim_token = gen_random_uuid(), claimed_at = now()
   where session_id = v_session_id and position = 'GK';
  set local role anon;
  v_result := sepak.join_waitlist(v_session_id, 'Faiz', '60198765432', array['GK'], v_faiz);
  assert (v_result ->> 'placed')::boolean = false, 'Faiz should queue';
  v_wait_id := (v_result ->> 'waitlist_id')::uuid;
  reset role;
  select count(*) into v_count from sepak.contacts where waitlist_id = v_wait_id and phone = '60198765432';
  assert v_count = 1, 'join_waitlist should store the queue contact';

  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  select sepak.contact_phone(null, v_wait_id) into v_phone;
  assert v_phone = '60198765432', 'admin reads a queue entry phone';
  -- Organiser clears team A GK: auto-fill moves Faiz in, contact follows.
  update sepak.slots set player_name = null, claim_token = null, claimed_at = null where id = v_gk;
  reset role;

  assert (select player_name from sepak.slots where id = v_gk) = 'Faiz', 'auto-fill should seat Faiz';
  select count(*) into v_count from sepak.contacts where phone = '60198765432';
  assert v_count = 1, format('exactly one contact row should survive the move, got %s', v_count);
  select count(*) into v_count from sepak.contacts where slot_id = v_gk and phone = '60198765432';
  assert v_count = 1, 'the contact should now hang off the slot';
  assert not exists (select 1 from sepak.waitlist where id = v_wait_id), 'queue entry consumed';

  -- Placed immediately via join_waitlist stores a slot contact directly.
  set local request.jwt.claims = '{}';
  set local role anon;
  v_result := sepak.join_waitlist(v_session_id, 'Nabil', '60111112222', array['ST'], gen_random_uuid());
  assert (v_result ->> 'placed')::boolean = true, 'Nabil should be placed straight into ST';
  reset role;
  select count(*) into v_count from sepak.contacts where slot_id = v_st and phone = '60111112222';
  assert v_count = 1, 'immediate placement stores a slot contact';

  -- Leaving the queue cascades the contact. Fill all MC first so Dev queues.
  update sepak.slots set player_name = 'Filler', claim_token = gen_random_uuid(), claimed_at = now()
   where session_id = v_session_id and position = 'MC' and player_name is null;
  set local role anon;
  v_result := sepak.join_waitlist(v_session_id, 'Dev', '60177778888', array['MC'], v_token);
  v_wait_id := (v_result ->> 'waitlist_id')::uuid;
  perform sepak.leave_waitlist(v_session_id, v_token);
  reset role;
  select count(*) into v_count from sepak.contacts where waitlist_id = v_wait_id;
  assert v_count = 0, 'leave_waitlist should cascade the contact away';

  -- contacts is not in the realtime publication.
  assert not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'sepak' and tablename = 'contacts'
  ), 'contacts must not be published over realtime';

  raise notice 'contacts_test: ok';
  raise exception 'ROLLBACK_MARKER';
exception when others then
  if sqlerrm = 'ROLLBACK_MARKER' then
    raise notice 'contacts_test: rolled back';
  else
    raise;
  end if;
end $$;
