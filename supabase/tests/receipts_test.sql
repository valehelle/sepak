\set ON_ERROR_STOP on

-- Run raw (scripts/sqltest.sh --raw): receipts belong to signed-in accounts,
-- tested here through the public functions, as production has them.

do $$
declare
  v_admin   uuid := '00000000-0000-4000-8000-0000000000ad';
  v_amir    uuid := '00000000-0000-4000-8000-00000000a001';
  v_bella   uuid := '00000000-0000-4000-8000-00000000b001';
  v_session uuid;
  v_other   uuid;
  v_gk uuid; v_st uuid;
  v_path    text;
  v_slot    sepak.slots;
  v_count   int;
begin
  insert into auth.users (id, email) values
    (v_admin, 'admin@sepak.local'), (v_amir, 'amir@example.test'), (v_bella, 'bella@example.test');
  update sepak.admins set user_id = v_admin where email = 'admin@sepak.local';

  insert into sepak.sessions (session_no, title, play_date, start_time, venue)
  values (990, 'Receipts', '2026-12-01', '21:00', 'Padang') returning id into v_session;
  insert into sepak.sessions (session_no, title, play_date, start_time, venue)
  values (991, 'Elsewhere', '2026-12-08', '21:00', 'Padang') returning id into v_other;
  insert into sepak.slots (session_id, team, position) values (v_session, 'A', 'GK') returning id into v_gk;
  insert into sepak.slots (session_id, team, position) values (v_session, 'A', 'ST') returning id into v_st;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_amir, 'role', 'authenticated')::text, true);
  perform sepak.claim_slot(v_gk, 'Amir', '60123456789');
  perform set_config('request.jwt.claims', json_build_object('sub', v_bella, 'role', 'authenticated')::text, true);
  perform sepak.claim_slot(v_st, 'Bella', '60122222222');

  v_path := v_session || '/' || v_gk || '/resit.jpg';

  ---------------------------------------------------------------------------
  -- Uploading: only into your own slot's folder.
  ---------------------------------------------------------------------------
  begin
    insert into storage.objects (bucket_id, name, owner) values ('receipts', v_path, v_bella);
    raise exception 'Bella must not file a receipt under Amir''s slot';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_amir, 'role', 'authenticated')::text, true);
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('receipts', v_other || '/' || v_gk || '/resit.jpg', v_amir);
    raise exception 'a receipt filed under another session must be refused';
  exception when insufficient_privilege then null;
  end;
  insert into storage.objects (bucket_id, name, owner) values ('receipts', v_path, v_amir);

  ---------------------------------------------------------------------------
  -- Attaching: checks the folder and that the file is there, then ticks.
  ---------------------------------------------------------------------------
  begin
    perform sepak.attach_receipt(v_gk, v_session || '/' || v_gk || '/never-uploaded.jpg');
    raise exception 'attaching a file that is not there must be refused';
  exception when others then
    assert sqlerrm = 'invalid_receipt', format('expected invalid_receipt, got %s', sqlerrm);
  end;
  begin
    perform sepak.attach_receipt(v_gk, v_session || '/' || v_st || '/resit.jpg');
    raise exception 'attaching a path from another slot must be refused';
  exception when others then
    assert sqlerrm = 'invalid_receipt', format('expected invalid_receipt, got %s', sqlerrm);
  end;

  v_slot := sepak.attach_receipt(v_gk, v_path);
  assert v_slot.paid, 'attaching a receipt ticks paid';
  assert v_slot.receipt_path = v_path, 'the slot should point at its receipt';

  perform set_config('request.jwt.claims', json_build_object('sub', v_bella, 'role', 'authenticated')::text, true);
  begin
    perform sepak.attach_receipt(v_gk, v_path);
    raise exception 'another account must not attach to Amir''s slot';
  exception when others then
    assert sqlerrm = 'wrong_token', format('expected wrong_token, got %s', sqlerrm);
  end;

  ---------------------------------------------------------------------------
  -- Reading: the owner and admins. Not another player, not a visitor.
  ---------------------------------------------------------------------------
  select count(*) into v_count from storage.objects where bucket_id = 'receipts';
  assert v_count = 0, 'Bella must not see Amir''s receipt';

  perform set_config('request.jwt.claims', json_build_object('sub', v_amir, 'role', 'authenticated')::text, true);
  select count(*) into v_count from storage.objects where bucket_id = 'receipts';
  assert v_count = 1, 'Amir should see his own receipt';

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select count(*) into v_count from storage.objects where bucket_id = 'receipts';
  assert v_count = 1, 'an admin should see every receipt';
  reset role;

  set local role anon;
  set local request.jwt.claims = '{}';
  select count(*) into v_count from storage.objects where bucket_id = 'receipts';
  assert v_count = 0, 'a visitor must not see receipts';
  reset role;

  ---------------------------------------------------------------------------
  -- Unticking lets go of the receipt; so does leaving the slot.
  ---------------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_amir, 'role', 'authenticated')::text, true);
  v_slot := sepak.set_slot_paid(v_gk, false);
  assert v_slot.receipt_path is null, 'unticking should clear the receipt';

  v_slot := sepak.attach_receipt(v_gk, v_path);
  perform sepak.release_slot(v_gk);
  reset role;
  select * into v_slot from sepak.slots where id = v_gk;
  assert v_slot.receipt_path is null and not v_slot.paid, 'releasing should clear the receipt';

  raise notice 'receipts_test: ok';
end $$;
