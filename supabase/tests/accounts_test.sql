\set ON_ERROR_STOP on

-- Run raw (scripts/sqltest.sh --raw): without the prelude, so the internal
-- key-taking functions are as locked as they are in production.

do $$
declare
  v_admin   uuid := '00000000-0000-4000-8000-0000000000ad';
  v_amir    uuid := '00000000-0000-4000-8000-00000000a001';
  v_bella   uuid := '00000000-0000-4000-8000-00000000b001';
  v_device  uuid := gen_random_uuid();
  v_session uuid;
  v_gk uuid; v_st uuid; v_lb uuid; v_rb uuid; v_cb uuid;
  v_slot    sepak.slots;
  v_ids     uuid[];
  v_count   int;
  v_moved   int;
  v_token   uuid;
  v_name    text;
begin
  insert into auth.users (id, email) values
    (v_admin, 'admin@sepak.local'),
    (v_amir,  'amir@example.test'),
    (v_bella, 'bella@example.test');
  update sepak.admins set user_id = v_admin where email = 'admin@sepak.local';

  insert into sepak.sessions (session_no, title, play_date, start_time, venue)
  values (970, 'Accounts', '2026-12-01', '21:00', 'Padang') returning id into v_session;
  insert into sepak.slots (session_id, team, position)
  select v_session, 'A', p from unnest(array['GK','ST','LB','RB','CB1']) p;
  select id into v_gk from sepak.slots where session_id = v_session and position = 'GK';
  select id into v_st from sepak.slots where session_id = v_session and position = 'ST';
  select id into v_lb from sepak.slots where session_id = v_session and position = 'LB';
  select id into v_rb from sepak.slots where session_id = v_session and position = 'RB';
  select id into v_cb from sepak.slots where session_id = v_session and position = 'CB1';

  ---------------------------------------------------------------------------
  -- Signed out: told to sign in, and the old key-taking functions are gone.
  ---------------------------------------------------------------------------
  set local role anon;
  set local request.jwt.claims = '{}';
  begin
    perform sepak.claim_slot(v_gk, 'Nobody', '60123456789');
    raise exception 'a signed-out claim must be refused';
  exception when others then
    assert sqlerrm = 'not_signed_in', format('expected not_signed_in, got %s', sqlerrm);
  end;
  begin
    perform sepak.claim_slot(v_gk, 'Nobody', '60123456789', gen_random_uuid());
    raise exception 'the key-taking claim must not be callable';
  exception when insufficient_privilege then null;
  end;
  -- Read helpers answer "nothing" rather than failing a visitor's page.
  select array_agg(x) into v_ids from sepak.my_slot_ids(v_session) x;
  assert v_ids is null, 'a signed-out visitor owns nothing';
  assert not sepak.has_push_subscription(), 'a signed-out visitor has no alerts';
  reset role;

  ---------------------------------------------------------------------------
  -- Signed in: the slot belongs to the account, whatever the browser holds.
  ---------------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_amir, 'role', 'authenticated')::text, true);
  v_slot := sepak.claim_slot(v_gk, 'Amir', '60123456789');
  assert v_slot.player_name = 'Amir', 'a signed-in claim should succeed';
  reset role;
  select claim_token into v_token from sepak.slots where id = v_gk;
  assert v_token = v_amir, 'the slot should be owned by the account id';

  set local role authenticated;
  select array_agg(x) into v_ids from sepak.my_slot_ids(v_session) x;
  assert v_ids = array[v_gk], format('Amir should see his slot, got %s', v_ids);
  v_slot := sepak.set_slot_paid(v_gk, true);
  assert v_slot.paid, 'Amir should be able to tick his own slot';

  -- Still one place per account per session.
  begin
    perform sepak.claim_slot(v_st, 'Amir Again', '60111111111');
    raise exception 'a second slot for the same account must be refused';
  exception when others then
    assert sqlerrm = 'already_in_slot', format('expected already_in_slot, got %s', sqlerrm);
  end;

  -- Another account cannot touch Amir's slot.
  perform set_config('request.jwt.claims', json_build_object('sub', v_bella, 'role', 'authenticated')::text, true);
  begin
    perform sepak.release_slot(v_gk);
    raise exception 'another account must not release Amir''s slot';
  exception when others then
    assert sqlerrm = 'wrong_token', format('expected wrong_token, got %s', sqlerrm);
  end;
  begin
    perform sepak.release_slot(v_gk, v_amir);
    raise exception 'presenting Amir''s id through the old function must not work';
  exception when insufficient_privilege then null;
  end;
  reset role;

  ---------------------------------------------------------------------------
  -- The same person on a different phone: same account, same slot.
  ---------------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_amir, 'role', 'authenticated')::text, true);
  v_slot := sepak.move_slot(v_gk, v_st);
  assert v_slot.id = v_st and v_slot.paid, 'Amir moves from any phone, keeping his tick';
  reset role;

  ---------------------------------------------------------------------------
  -- adopt_device: a booking made by a browser key moves to the account that
  -- signs in from that browser. Bella booked LB before sign-in existed.
  ---------------------------------------------------------------------------
  perform sepak.claim_slot(v_lb, 'Bella', '60122222222', v_device);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_bella, 'role', 'authenticated')::text, true);
  v_moved := sepak.adopt_device(v_device);
  assert v_moved = 1, format('one booking should move, moved %s', v_moved);
  select array_agg(x) into v_ids from sepak.my_slot_ids(v_session) x;
  assert v_ids = array[v_lb], format('Bella should now own LB, got %s', v_ids);
  v_slot := sepak.set_slot_paid(v_lb, true);
  assert v_slot.paid, 'Bella can tick the adopted slot';
  -- Doing it again changes nothing.
  assert sepak.adopt_device(v_device) = 0, 'a second adoption should move nothing';
  reset role;

  -- An account that already has a place keeps it; the browser's booking in
  -- the same session stays where it was rather than becoming a second one.
  v_device := gen_random_uuid();
  perform sepak.claim_slot(v_rb, 'Amir Old Phone', '60133333333', v_device);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_amir, 'role', 'authenticated')::text, true);
  assert sepak.adopt_device(v_device) = 0, 'adopting must not give one account two places';
  reset role;
  select claim_token into v_token from sepak.slots where id = v_rb;
  assert v_token = v_device, 'the browser''s booking should be left as it was';

  ---------------------------------------------------------------------------
  -- An admin books someone who cannot sign in. Nobody else can.
  ---------------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_bella, 'role', 'authenticated')::text, true);
  begin
    perform sepak.admin_claim_slot(v_cb, 'Pakcik', '60144444444');
    raise exception 'a player must not book for someone else';
  exception when others then
    assert sqlerrm = 'not_admin', format('expected not_admin, got %s', sqlerrm);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_slot := sepak.admin_claim_slot(v_cb, 'Pakcik', '60144444444');
  assert v_slot.player_name = 'Pakcik', 'an admin should book for someone else';
  -- The admin's own booking allowance is untouched by it.
  select array_agg(x) into v_ids from sepak.my_slot_ids(v_session) x;
  assert v_ids is null, 'a slot booked for someone else is not the admin''s own';
  reset role;
  select claim_token into v_token from sepak.slots where id = v_cb;
  assert v_token not in (v_admin, v_amir, v_bella), 'the slot should belong to no account';

  ---------------------------------------------------------------------------
  -- Profiles: each account reads and writes only its own.
  ---------------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_amir, 'role', 'authenticated')::text, true);
  insert into sepak.profiles (user_id, name, phone) values (v_amir, 'Amir', '60123456789');
  begin
    insert into sepak.profiles (user_id, name, phone) values (v_bella, 'Not Bella', '60100000000');
    raise exception 'an account must not write another''s profile';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_bella, 'role', 'authenticated')::text, true);
  select count(*) into v_count from sepak.profiles;
  assert v_count = 0, 'Bella must not see Amir''s profile';
  -- The same number on another account is allowed: a lost account's owner
  -- starts again with their own number.
  insert into sepak.profiles (user_id, name, phone) values (v_bella, 'Bella', '60123456789');
  reset role;

  set local role anon;
  set local request.jwt.claims = '{}';
  begin
    perform count(*) from sepak.profiles;
    raise exception 'anon must not read profiles';
  exception when insufficient_privilege then null;
  end;
  reset role;

  ---------------------------------------------------------------------------
  -- Admin rights follow the account, not the address. An email-only claim
  -- -- what registering somebody else's address would get you -- is nothing.
  ---------------------------------------------------------------------------
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  assert not sepak.is_admin(), 'an address with no matching account id is not an admin';
  perform set_config('request.jwt.claims', json_build_object('sub', v_amir, 'email', 'admin@sepak.local', 'role', 'authenticated')::text, true);
  assert not sepak.is_admin(), 'another account carrying an admin''s address is not an admin';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  assert sepak.is_admin(), 'the bound account is an admin';
  reset role;

  -- Adding an admin needs the account to exist first.
  begin
    insert into sepak.admins (email, role) values ('nobody-yet@example.test', 'admin');
    raise exception 'an admin row without an account must be refused';
  exception when others then
    assert sqlerrm = 'admin_needs_account', format('expected admin_needs_account, got %s', sqlerrm);
  end;
  insert into sepak.admins (email, role) values ('bella@example.test', 'admin');
  select user_id into v_token from sepak.admins where email = 'bella@example.test';
  assert v_token = v_bella, 'a new admin row binds to the existing account';

  ---------------------------------------------------------------------------
  -- The queue: joining and auto-fill land on the account.
  ---------------------------------------------------------------------------
  delete from sepak.admins where email = 'bella@example.test';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_amir, 'role', 'authenticated')::text, true);
  perform sepak.release_slot(v_st);
  reset role;
  update sepak.slots set player_name = 'Filler', claim_token = gen_random_uuid(), claimed_at = now()
   where session_id = v_session and player_name is null;
  set local role authenticated;
  perform sepak.join_waitlist(v_session, 'Amir', '60123456789', array['GK']);
  select count(*) into v_count from sepak.my_waitlist_entry(v_session);
  assert v_count = 1, 'Amir should see his queue place';
  reset role;
  -- GK opens up: the queue trigger hands it to Amir's account.
  update sepak.slots set player_name = null, claim_token = null, claimed_at = null where id = v_gk;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_amir, 'role', 'authenticated')::text, true);
  select array_agg(x) into v_ids from sepak.my_slot_ids(v_session) x;
  assert v_ids = array[v_gk], format('auto-fill should hand GK to Amir''s account, got %s', v_ids);
  reset role;

  raise notice 'accounts_test: ok';
end $$;
