\set ON_ERROR_STOP on

do $$
declare
  v_session_id uuid;
  v_st_a uuid;
  v_t_occ uuid := gen_random_uuid();  -- holds A-ST, then releases it
  v_t_naik uuid := gen_random_uuid(); -- queues for ST, gets promoted
  v_t_none uuid := gen_random_uuid(); -- has booked nothing at all
  v_activity_id bigint;
  v_claim_id bigint;
  v_count int;
  v_row record;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  select id into v_session_id from sepak.create_session(
    907, 'Push Test', '2026-10-14', '20:00:00', 120, 'Padang Presint 8', 27,
    'Merah', 'Putih', 'Kuning');
  select id into v_st_a from sepak.slots where session_id = v_session_id and team = 'A' and position = 'ST';
  reset role;
  set local request.jwt.claims = '{}';

  ---------------------------------------------------------------------------
  -- The table is closed to everyone but service_role: an endpoint plus its
  -- keys is the permission to push to that phone.
  ---------------------------------------------------------------------------
  set local role anon;
  begin
    perform 1 from sepak.push_subscriptions limit 1;
    raise exception 'anon must not read push_subscriptions';
  exception when insufficient_privilege then
    null;
  end;
  reset role;

  set local role authenticated;
  set local request.jwt.claims = '{"email":"admin@sepak.local","role":"authenticated"}';
  begin
    perform 1 from sepak.push_subscriptions limit 1;
    raise exception 'not even an admin reads push_subscriptions directly';
  exception when insufficient_privilege then
    null;
  end;
  reset role;
  set local request.jwt.claims = '{}';

  ---------------------------------------------------------------------------
  -- Subscribing is only for a device that has actually booked or queued.
  -- This is an anon-callable write; the requirement is what stops it being
  -- an open bucket.
  ---------------------------------------------------------------------------
  set local role anon;
  begin
    perform sepak.save_push_subscription(v_t_none, 'https://push.example/nobody', 'k', 'a');
    raise exception 'a device with no booking must not be able to subscribe';
  exception when others then
    assert sqlerrm = 'not_in_session', format('expected not_in_session, got %s', sqlerrm);
  end;

  begin
    perform sepak.save_push_subscription(v_t_naik, 'http://push.example/insecure', 'k', 'a');
    raise exception 'a non-https endpoint must be refused';
  exception when others then
    assert sqlerrm = 'invalid_subscription', format('expected invalid_subscription, got %s', sqlerrm);
  end;

  -- Occupant takes A-ST; everything else gets filled so ST is the scarce
  -- position and a preference for it has to queue.
  perform sepak.claim_slot(v_st_a, 'Occupant', '60177778888', v_t_occ);
  reset role;

  update sepak.slots
     set player_name = 'Filler', claim_token = gen_random_uuid(), claimed_at = now()
   where session_id = v_session_id and player_name is null;

  set local role anon;
  perform sepak.join_waitlist(v_session_id, 'Naik', '60199990000', array['ST'], v_t_naik);

  -- Now the queue entry exists, so subscribing is allowed.
  perform sepak.save_push_subscription(
    v_t_naik, 'https://push.example/naik-1', 'p256dh-key', 'auth-key', 'Test UA');
  assert sepak.has_push_subscription(v_t_naik), 'the device should read as subscribed';
  assert not sepak.has_push_subscription(v_t_none), 'a device that never subscribed should read as not subscribed';

  -- Re-subscribing the same browser presents the same endpoint: an update,
  -- not a second row.
  perform sepak.save_push_subscription(
    v_t_naik, 'https://push.example/naik-1', 'p256dh-second', 'auth-second');
  reset role;
  select count(*) into v_count from sepak.push_subscriptions where claim_token = v_t_naik;
  assert v_count = 1, format('re-subscribing should not add a row, have %s', v_count);
  select p256dh into v_row from sepak.push_subscriptions where endpoint = 'https://push.example/naik-1';
  assert v_row.p256dh = 'p256dh-second', 'the keys should have been refreshed';

  -- Four devices, three kept: the oldest is dropped rather than accumulating
  -- endpoints we would fail to push to forever.
  set local role anon;
  perform sepak.save_push_subscription(v_t_naik, 'https://push.example/naik-2', 'k', 'a');
  perform sepak.save_push_subscription(v_t_naik, 'https://push.example/naik-3', 'k', 'a');
  perform sepak.save_push_subscription(v_t_naik, 'https://push.example/naik-4', 'k', 'a');
  reset role;
  select count(*) into v_count from sepak.push_subscriptions where claim_token = v_t_naik;
  assert v_count = 3, format('expected the newest three to be kept, have %s', v_count);
  select count(*) into v_count from sepak.push_subscriptions where endpoint = 'https://push.example/naik-1';
  assert v_count = 0, 'the oldest endpoint should have been dropped';

  ---------------------------------------------------------------------------
  -- The promotion itself, and the message it produces.
  ---------------------------------------------------------------------------
  set local role anon;
  perform sepak.release_slot(v_st_a, v_t_occ);
  reset role;

  select id into v_activity_id from sepak.activity
   where session_id = v_session_id and kind = 'autofill' and player_name = 'Naik';
  assert v_activity_id is not null, 'releasing should have promoted Naik';

  select * into v_row from sepak.push_targets(v_activity_id) limit 1;
  assert v_row.title = 'Anda berjaya masuk!', format('unexpected title %s', v_row.title);
  assert v_row.body like 'Team A Merah — ST · Sesi 907, 14 Okt %',
    format('unexpected body: %s', v_row.body);
  assert v_row.body like '%8:00 PM', format('the time should read as 8:00 PM, got %s', v_row.body);
  assert v_row.url = 'https://valehelle.github.io/sepak/s/' || v_session_id::text,
    format('unexpected url %s', v_row.url);
  assert v_row.p256dh is not null and v_row.auth is not null, 'the keys must come along';

  -- One row per subscribed device, and only for the promoted player.
  select count(*) into v_count from sepak.push_targets(v_activity_id);
  assert v_count = 3, format('expected this device''s three endpoints, got %s', v_count);

  -- Nothing to send for any other kind of activity, whatever its id.
  select id into v_claim_id from sepak.activity
   where session_id = v_session_id and kind = 'claim' and player_name = 'Occupant';
  select count(*) into v_count from sepak.push_targets(v_claim_id);
  assert v_count = 0, 'only a promotion should produce a push';

  -- CB reads as CB, as everywhere else.
  assert sepak.position_label('CB2') = 'CB', 'CB2 should read as CB';
  assert sepak.position_label('GK') = 'GK', 'GK should read as itself';
  assert sepak.play_date_text('2026-03-07') = '7 Mac', 'the date should read in Malay';

  ---------------------------------------------------------------------------
  -- Reading the targets is service_role's job alone: the rows are push
  -- credentials.
  ---------------------------------------------------------------------------
  set local role anon;
  begin
    perform sepak.push_targets(v_activity_id);
    raise exception 'anon must not read push targets';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform sepak.drop_push_subscription('https://push.example/naik-2');
    raise exception 'anon must not drop subscriptions';
  exception when insufficient_privilege then
    null;
  end;

  ---------------------------------------------------------------------------
  -- Unsubscribing needs this device's own token.
  ---------------------------------------------------------------------------
  perform sepak.delete_push_subscription(v_t_occ, 'https://push.example/naik-2');
  reset role;
  select count(*) into v_count from sepak.push_subscriptions where endpoint = 'https://push.example/naik-2';
  assert v_count = 1, 'another device must not be able to unsubscribe this one';

  set local role anon;
  perform sepak.delete_push_subscription(v_t_naik, 'https://push.example/naik-2');
  reset role;
  select count(*) into v_count from sepak.push_subscriptions where endpoint = 'https://push.example/naik-2';
  assert v_count = 0, 'the owning device should be able to unsubscribe';

  raise notice 'push_test: ok';
  raise exception 'ROLLBACK_MARKER';
exception when others then
  if sqlerrm = 'ROLLBACK_MARKER' then
    raise notice 'push_test: rolled back';
  else
    raise;
  end if;
end $$;
