\set ON_ERROR_STOP on

do $$
declare
  v_session_id uuid;
  v_st_a uuid;
  v_t_occ  uuid := gen_random_uuid();
  v_t_naik uuid := gen_random_uuid();
  v_t_none uuid := gen_random_uuid();
  v_code uuid;
  v_code2 uuid;
  v_activity_id bigint;
  v_claim_id bigint;
  v_count int;
  v_row record;
  v_ok boolean;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  select id into v_session_id from sepak.create_session(
    909, 'Telegram Test', '2026-11-11', '20:30:00', 120, 'Padang Presint 8', 27,
    'Merah', 'Putih', 'Kuning');
  select id into v_st_a from sepak.slots where session_id = v_session_id and team = 'A' and position = 'ST';
  reset role;
  set local request.jwt.claims = '{}';

  ---------------------------------------------------------------------------
  -- A chat id is a capability to message somebody, and a link code is a
  -- bearer secret: both tables are closed to everyone but service_role.
  ---------------------------------------------------------------------------
  set local role anon;
  begin
    perform 1 from sepak.telegram_chats limit 1;
    raise exception 'anon must not read telegram_chats';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from sepak.telegram_links limit 1;
    raise exception 'anon must not read telegram_links';
  exception when insufficient_privilege then null;
  end;

  -- A device with no place in a session cannot mint a code.
  begin
    perform sepak.create_telegram_link(v_t_none);
    raise exception 'a device with no booking must not get a link';
  exception when others then
    assert sqlerrm = 'not_in_session', format('expected not_in_session, got %s', sqlerrm);
  end;

  -- Set the session up: Occupant holds A-ST, everything else is full, so a
  -- preference for ST has to queue.
  perform sepak.claim_slot(v_st_a, 'Occupant', '60177778888', v_t_occ);
  reset role;
  update sepak.slots
     set player_name = 'Filler', claim_token = gen_random_uuid(), claimed_at = now()
   where session_id = v_session_id and player_name is null;

  set local role anon;
  perform sepak.join_waitlist(v_session_id, 'Naik', '60199990000', array['ST'], v_t_naik);

  -- Now a code can be minted, and it is not the claim token.
  v_code := sepak.create_telegram_link(v_t_naik);
  assert v_code is not null, 'a queued device should get a link code';
  assert v_code <> v_t_naik, 'the code must never be the claim token itself';
  assert not sepak.has_telegram_chat(v_t_naik), 'nothing is linked until Start is pressed';

  -- Minting again replaces the first: one live code per device, so a leaked
  -- link stops working as soon as a new one is made.
  v_code2 := sepak.create_telegram_link(v_t_naik);
  reset role;
  select count(*) into v_count from sepak.telegram_links where claim_token = v_t_naik;
  assert v_count = 1, format('expected one live code, have %s', v_count);
  assert not sepak.claim_telegram_link(v_code, 999001),
    'the replaced code must no longer work';

  ---------------------------------------------------------------------------
  -- Pressing Start.
  ---------------------------------------------------------------------------
  assert sepak.claim_telegram_link(v_code2, 999001), 'the live code should link the chat';
  assert sepak.has_telegram_chat(v_t_naik), 'the device should now read as linked';

  -- Single use: the code is consumed.
  assert not sepak.claim_telegram_link(v_code2, 999002),
    'a code must not be usable twice';

  -- An unknown code is refused rather than raising.
  assert not sepak.claim_telegram_link(gen_random_uuid(), 999003),
    'an unknown code must be refused';

  -- An expired code is refused too.
  set local role anon;
  v_code := sepak.create_telegram_link(v_t_naik);
  reset role;
  update sepak.telegram_links set created_at = clock_timestamp() - interval '2 hours'
   where code = v_code;
  assert not sepak.claim_telegram_link(v_code, 999004),
    'a code older than an hour must be refused';
  select count(*) into v_count from sepak.telegram_links where code = v_code;
  assert v_count = 1, 'an expired code is left alone rather than silently consumed';

  ---------------------------------------------------------------------------
  -- The promotion, and what gets said.
  ---------------------------------------------------------------------------
  set local role anon;
  perform sepak.release_slot(v_st_a, v_t_occ);
  reset role;

  select id into v_activity_id from sepak.activity
   where session_id = v_session_id and kind = 'autofill' and player_name = 'Naik';
  assert v_activity_id is not null, 'releasing should have promoted Naik';

  select * into v_row from sepak.telegram_targets(v_activity_id);
  assert v_row.chat_id = 999001, format('expected the linked chat, got %s', v_row.chat_id);
  assert v_row.title = 'Anda berjaya masuk!', format('unexpected title %s', v_row.title);
  assert v_row.body like 'Team Merah — ST · Sesi 909, 11 Nov %',
    format('unexpected body: %s', v_row.body);
  assert v_row.body like '%8:30 PM', format('unexpected time in %s', v_row.body);
  assert v_row.url = 'https://valehelle.github.io/sepak/s/' || v_session_id::text,
    format('unexpected url %s', v_row.url);

  -- Both channels read from one builder, so they cannot drift apart.
  select count(*) into v_count from sepak.promotion_text(v_activity_id);
  assert v_count = 1, 'promotion_text should describe exactly one promotion';

  -- Nothing to say about any other kind of activity.
  select id into v_claim_id from sepak.activity
   where session_id = v_session_id and kind = 'claim' and player_name = 'Occupant';
  select count(*) into v_count from sepak.telegram_targets(v_claim_id);
  assert v_count = 0, 'only a promotion should produce a message';

  ---------------------------------------------------------------------------
  -- The webhook's own RPCs belong to service_role alone.
  ---------------------------------------------------------------------------
  set local role anon;
  begin
    perform sepak.telegram_targets(v_activity_id);
    raise exception 'anon must not read telegram targets';
  exception when insufficient_privilege then null;
  end;
  begin
    perform sepak.claim_telegram_link(gen_random_uuid(), 999005);
    raise exception 'anon must not be able to link a chat';
  exception when insufficient_privilege then null;
  end;
  begin
    perform sepak.drop_telegram_chat(999001);
    raise exception 'anon must not be able to drop a chat';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- /stop, or a 403 from Telegram.
  perform sepak.drop_telegram_chat(999001);
  assert not sepak.has_telegram_chat(v_t_naik), 'stopping should unlink the device';

  raise notice 'telegram_test: ok';
  raise exception 'ROLLBACK_MARKER';
exception when others then
  if sqlerrm = 'ROLLBACK_MARKER' then
    raise notice 'telegram_test: rolled back';
  else
    raise;
  end if;
end $$;
