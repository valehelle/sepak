\set ON_ERROR_STOP on

do $$
declare
  v_session uuid;
  v_gk uuid; v_st uuid;
  v_token uuid := gen_random_uuid();
  v_folder text;
  v_path text;
  v_slot sepak.slots;
  v_count int;
begin
  insert into sepak.sessions (session_no, title, play_date, start_time, venue)
  values (990, 'Receipts', '2026-12-01', '21:00', 'Padang') returning id into v_session;
  insert into sepak.slots (session_id, team, position) values (v_session, 'A', 'GK') returning id into v_gk;
  insert into sepak.slots (session_id, team, position) values (v_session, 'A', 'ST') returning id into v_st;

  set local role anon;
  perform sepak.claim_slot(v_gk, 'Amir', '60123456789', v_token);
  perform sepak.claim_slot(v_st, 'Bella', '60122222222', gen_random_uuid());

  ---------------------------------------------------------------------------
  -- Browsers cannot reach the receipt functions or the files at all.
  ---------------------------------------------------------------------------
  begin
    perform sepak.receipt_folder_for(v_gk, v_token);
    raise exception 'anon must not call receipt_folder_for';
  exception when insufficient_privilege then null;
  end;
  begin
    perform sepak.attach_receipt(v_gk, v_token, 'x');
    raise exception 'anon must not call attach_receipt';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('receipts', v_session || '/' || v_gk || '/x.jpg');
    raise exception 'anon must not write receipts';
  exception when insufficient_privilege then null;
  end;
  reset role;

  ---------------------------------------------------------------------------
  -- The Edge Function's path, as service_role.
  ---------------------------------------------------------------------------
  set local role service_role;
  begin
    perform sepak.receipt_folder_for(v_gk, gen_random_uuid());
    raise exception 'another browser must not get the folder';
  exception when others then
    assert sqlerrm = 'wrong_token', format('expected wrong_token, got %s', sqlerrm);
  end;
  v_folder := sepak.receipt_folder_for(v_gk, v_token);
  assert v_folder = v_session || '/' || v_gk, format('unexpected folder %s', v_folder);
  reset role;

  v_path := v_folder || '/resit.jpg';
  -- What the function's upload leaves behind.
  insert into storage.objects (bucket_id, name) values ('receipts', v_path);

  set local role service_role;
  begin
    perform sepak.attach_receipt(v_gk, v_token, v_folder || '/never-stored.jpg');
    raise exception 'a file that is not there must be refused';
  exception when others then
    assert sqlerrm = 'invalid_receipt', format('expected invalid_receipt, got %s', sqlerrm);
  end;
  begin
    perform sepak.attach_receipt(v_gk, v_token, v_session || '/' || v_st || '/resit.jpg');
    raise exception 'a path from another slot must be refused';
  exception when others then
    assert sqlerrm = 'invalid_receipt', format('expected invalid_receipt, got %s', sqlerrm);
  end;
  v_slot := sepak.attach_receipt(v_gk, v_token, v_path);
  assert v_slot.paid and v_slot.receipt_path = v_path, 'attaching should tick paid and record the receipt';
  reset role;

  ---------------------------------------------------------------------------
  -- Only admins see the files. The path itself is public, like the slot.
  ---------------------------------------------------------------------------
  set local role authenticated;
  set local request.jwt.claims = '{"email":"stranger@example.test","role":"authenticated"}';
  select count(*) into v_count from storage.objects where bucket_id = 'receipts';
  assert v_count = 0, 'a signed-in non-admin must not see receipts';
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  select count(*) into v_count from storage.objects where bucket_id = 'receipts';
  assert v_count = 1, 'an admin should see receipts';
  reset role;
  set local request.jwt.claims = '{}';

  set local role anon;
  select count(*) into v_count from sepak.slots where id = v_gk and receipt_path is not null;
  assert v_count = 1, 'the page can tell a receipt was sent';
  ---------------------------------------------------------------------------
  -- Unticking lets go of it.
  ---------------------------------------------------------------------------
  v_slot := sepak.set_slot_paid(v_gk, v_token, false);
  assert v_slot.receipt_path is null, 'unticking should clear the receipt';
  reset role;

  raise notice 'receipts_test: ok';
  raise exception 'ROLLBACK_MARKER';
exception when others then
  if sqlerrm = 'ROLLBACK_MARKER' then
    raise notice 'receipts_test: rolled back';
  else
    raise;
  end if;
end $$;
