\set ON_ERROR_STOP on

do $$
declare
  v_session uuid; v_other uuid;
  v_gk uuid; v_st uuid; v_lb uuid;
  v_amir uuid := gen_random_uuid();
  v_bella uuid := gen_random_uuid();
  v_early uuid := gen_random_uuid();
  v_late  uuid := gen_random_uuid();
  v_late_id uuid; v_other_entry uuid; v_early_id uuid;
  v_slot sepak.slots;
  v_first text;
  v_positions text[];
  v_token uuid;
  v_phone text;
  v_kinds text[];
  v_mark bigint;
  v_count int;
begin
  insert into sepak.sessions (session_no, title, play_date, start_time, venue)
  values (995, 'Replace', '2026-12-01', '21:00', 'Padang') returning id into v_session;
  insert into sepak.sessions (session_no, title, play_date, start_time, venue)
  values (996, 'Other', '2026-12-08', '21:00', 'Padang') returning id into v_other;
  insert into sepak.slots (session_id, team, position) values (v_session, 'A', 'GK') returning id into v_gk;
  insert into sepak.slots (session_id, team, position) values (v_session, 'A', 'ST') returning id into v_st;
  insert into sepak.slots (session_id, team, position) values (v_session, 'A', 'LB') returning id into v_lb;
  insert into sepak.slots (session_id, team, position) values (v_other, 'A', 'GK');

  set local role anon;
  perform sepak.claim_slot(v_gk, 'Amir', '60111111111', v_amir);
  perform sepak.set_slot_paid(v_gk, v_amir, true);
  perform sepak.claim_slot(v_st, 'Bella', '60122222222', v_bella);
  perform sepak.claim_slot(v_lb, 'Chong', '60133333333', gen_random_uuid());
  -- Early wants GK; Late only wants ST -- and is the one the admin picks.
  perform sepak.join_waitlist(v_session, 'Early', '60144444444', array['GK'], v_early);
  perform sepak.join_waitlist(v_session, 'Late', '60155555555', array['ST'], v_late);
  perform sepak.join_waitlist(v_other, 'Elsewhere', '60166666666', array['GK'], gen_random_uuid());
  reset role;
  -- Joins in one transaction share a timestamp; space them as real ones are.
  update sepak.waitlist set created_at = now() - interval '2 minutes' where claim_token = v_early;
  select id into v_late_id from sepak.waitlist where claim_token = v_late;
  select id into v_other_entry from sepak.waitlist where session_id = v_other;
  select coalesce(max(id), 0) into v_mark from sepak.activity;

  ---------------------------------------------------------------------------
  -- Refusals.
  ---------------------------------------------------------------------------
  set local role authenticated;
  set local request.jwt.claims = '{"email":"stranger@example.test","role":"authenticated"}';
  begin
    perform sepak.admin_replace_with_waitlist(v_gk, v_late_id);
    raise exception 'a non-admin must not replace a player';
  exception when others then
    assert sqlerrm = 'not_admin', format('expected not_admin, got %s', sqlerrm);
  end;

  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  begin
    perform sepak.admin_replace_with_waitlist(v_gk, v_other_entry);
    raise exception 'a queue entry from another session must be refused';
  exception when others then
    assert sqlerrm = 'not_waitlisted', format('expected not_waitlisted, got %s', sqlerrm);
  end;

  ---------------------------------------------------------------------------
  -- The swap: Late (who only asked for ST) takes Amir's GK slot.
  ---------------------------------------------------------------------------
  v_slot := sepak.admin_replace_with_waitlist(v_gk, v_late_id);
  reset role;
  set local request.jwt.claims = '{}';

  assert v_slot.player_name = 'Late', format('Late should hold GK, got %s', v_slot.player_name);
  assert v_slot.claim_token = v_late, 'the slot should belong to Late''s browser';
  assert not v_slot.paid and v_slot.receipt_path is null, 'the newcomer starts unpaid';
  select phone into v_phone from sepak.contacts where slot_id = v_gk;
  assert v_phone = '60155555555', format('Late''s number should be on the slot, got %s', v_phone);
  select count(*) into v_count from sepak.waitlist where id = v_late_id;
  assert v_count = 0, 'Late should have left the queue';

  -- The queue did not jump in with Early on the way.
  select count(*) into v_count from sepak.waitlist where claim_token = v_early;
  assert v_count = 1, 'Early must still be queued';

  -- Amir is first in the queue, for GK, with his number and his browser.
  select player_name, positions, claim_token into v_first, v_positions, v_token
    from sepak.waitlist where session_id = v_session order by created_at limit 1;
  assert v_first = 'Amir', format('Amir should be first in the queue, got %s', v_first);
  assert v_positions = array['GK'], format('Amir should queue for GK, got %s', v_positions);
  assert v_token = v_amir, 'Amir''s browser should still own his queue place';
  select c.phone into v_phone from sepak.contacts c join sepak.waitlist w on w.id = c.waitlist_id
   where w.claim_token = v_amir;
  assert v_phone = '60111111111', 'Amir keeps his number in the queue';

  -- The log: the admin emptied Amir's slot, he joined the queue, Late was
  -- promoted -- the 'autofill' line is what sends Late the message.
  select array_agg(kind || ':' || player_name order by id) into v_kinds
    from sepak.activity where id > v_mark and session_id = v_session;
  assert v_kinds = array['admin_clear:Amir', 'waitlist_join:Amir', 'autofill:Late'],
    format('unexpected log %s', v_kinds);

  ---------------------------------------------------------------------------
  -- The queue works normally afterwards: GK opens, Amir is first for it.
  ---------------------------------------------------------------------------
  set local role anon;
  perform sepak.release_slot(v_gk, v_late);
  reset role;
  select player_name into v_first from sepak.slots where id = v_gk;
  assert v_first = 'Amir', format('Amir should get GK back first, got %s', v_first);

  -- An empty slot cannot be "replaced".
  select id into v_early_id from sepak.waitlist where claim_token = v_early;
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  update sepak.slots set player_name = null, claim_token = null, claimed_at = null where id = v_lb;
  begin
    perform sepak.admin_replace_with_waitlist(v_lb, v_early_id);
    raise exception 'an empty slot must be refused';
  exception when others then
    assert sqlerrm = 'slot_empty', format('expected slot_empty, got %s', sqlerrm);
  end;
  reset role;

  raise notice 'admin_replace_test: ok';
  raise exception 'ROLLBACK_MARKER';
exception when others then
  if sqlerrm = 'ROLLBACK_MARKER' then
    raise notice 'admin_replace_test: rolled back';
  else
    raise;
  end if;
end $$;
