---------------------------------------------------------------------------
-- Telegram as the notification channel that works on every phone.
--
-- Web push (0013) is free and instant, but on iOS it only reaches a web app
-- added to the Home Screen -- and an installed iOS web app gets its own
-- storage container, so the device that installs is not the device that
-- joined the queue and cannot be matched to it. That makes push an
-- Android-only answer in practice.
--
-- Telegram has none of that: no install of this app, no permission dialog,
-- no partitioned storage, the same on iPhone and Android, and free with no
-- per-message charge or template approval (which is where WhatsApp's
-- business platform would have cost money per notification).
--
-- The opt-in is a one-time code carried through a t.me link. Deliberately
-- NOT the claim token: a t.me link gets pasted around, and the claim token
-- is what authorises releasing a booking.
---------------------------------------------------------------------------

---------------------------------------------------------------------------
-- One shared message builder, so a promotion reads identically however it
-- is delivered. push_targets is redefined below to use it rather than
-- keeping a second copy of the wording.
---------------------------------------------------------------------------
create or replace function sepak.promotion_text(p_activity_id bigint)
returns table (title text, body text, url text)
language sql
stable
security definer
set search_path = sepak, pg_temp
as $$
  select
    'Anda dah naik!'::text,
    format('%s %s — %s · Sesi %s, %s %s',
      'Team ' || sl.team,
      case sl.team when 'A' then se.team_a_name when 'B' then se.team_b_name else se.team_c_name end,
      sepak.position_label(sl.position),
      lpad(se.session_no::text, 3, '0'),
      sepak.play_date_text(se.play_date),
      to_char(se.start_time, 'FMHH12:MI AM')),
    'https://valehelle.github.io/sepak/s/' || se.id::text
    from sepak.activity a
    join sepak.slots sl    on sl.id = a.slot_id
    join sepak.sessions se on se.id = a.session_id
   where a.id = p_activity_id
     and a.kind = 'autofill';
$$;

revoke all on function sepak.promotion_text(bigint) from public;
grant execute on function sepak.promotion_text(bigint) to service_role;

create or replace function sepak.push_targets(p_activity_id bigint)
returns table (
  endpoint text,
  p256dh   text,
  auth     text,
  title    text,
  body     text,
  url      text
)
language sql
stable
security definer
set search_path = sepak, pg_temp
as $$
  select ps.endpoint, ps.p256dh, ps.auth, t.title, t.body, t.url
    from sepak.activity a
    join sepak.slots sl on sl.id = a.slot_id
    join sepak.push_subscriptions ps on ps.claim_token = sl.claim_token
   cross join sepak.promotion_text(a.id) t
   where a.id = p_activity_id
     and a.kind = 'autofill';
$$;

---------------------------------------------------------------------------
-- The opt-in handshake.
--
-- A code is minted in the browser, travels inside a t.me link, and comes
-- back from Telegram's servers attached to a chat id. Short-lived and
-- single-use: it is visible in a URL, and a URL gets shared.
---------------------------------------------------------------------------
create table sepak.telegram_links (
  code        uuid primary key default gen_random_uuid(),
  claim_token uuid not null,
  created_at  timestamptz not null default clock_timestamp()
);

comment on table sepak.telegram_links is
  'One-time codes binding a t.me /start to a device. Consumed on use, expire in an hour.';

create index telegram_links_token_idx on sepak.telegram_links (claim_token);

create table sepak.telegram_chats (
  chat_id      bigint primary key,
  claim_token  uuid not null,
  created_at   timestamptz not null default clock_timestamp(),
  last_sent_at timestamptz
);

comment on table sepak.telegram_chats is
  'Which Telegram chat belongs to which device. service_role only.';

create index telegram_chats_token_idx on sepak.telegram_chats (claim_token);

-- Closed like sepak.contacts and sepak.push_subscriptions: a chat id is a
-- capability to message somebody, and the codes are bearer secrets.
alter table sepak.telegram_links enable row level security;
alter table sepak.telegram_chats enable row level security;
revoke all on sepak.telegram_links from anon;
revoke all on sepak.telegram_links from authenticated;
revoke all on sepak.telegram_chats from anon;
revoke all on sepak.telegram_chats from authenticated;
grant select, insert, update, delete on sepak.telegram_links to service_role;
grant select, insert, update, delete on sepak.telegram_chats to service_role;

/* Mints the code the t.me link carries. Same rule as
   save_push_subscription: the device must already hold a place in a
   session, so this anon-callable write cannot be used as an open bucket.
   Any earlier unused code for the device is discarded -- one live code per
   device, so a leaked link stops working as soon as a new one is made. */
create or replace function sepak.create_telegram_link(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_code uuid;
begin
  if p_token is null then
    raise exception 'invalid_token';
  end if;

  if not exists (select 1 from sepak.slots where claim_token = p_token)
     and not exists (select 1 from sepak.waitlist where claim_token = p_token) then
    raise exception 'not_in_session';
  end if;

  delete from sepak.telegram_links where claim_token = p_token;

  insert into sepak.telegram_links (claim_token)
  values (p_token)
  returning code into v_code;

  return v_code;
end;
$$;

/* Whether this device already has Telegram linked, so the app can show the
   state without being able to read the chat id. */
create or replace function sepak.has_telegram_chat(p_token uuid)
returns boolean
language sql
security definer
set search_path = sepak, pg_temp
as $$
  select exists (select 1 from sepak.telegram_chats where claim_token = p_token);
$$;

revoke all on function sepak.create_telegram_link(uuid) from public;
revoke all on function sepak.has_telegram_chat(uuid)    from public;
grant execute on function sepak.create_telegram_link(uuid) to anon, authenticated;
grant execute on function sepak.has_telegram_chat(uuid)    to anon, authenticated;

/* Called by the webhook when somebody presses Start. Returns false for a
   code that is unknown, already used, or older than an hour -- the function
   answers the chat accordingly rather than failing silently.

   One chat belongs to one device: pressing Start again from the same chat
   after re-linking moves it, rather than leaving a stale pairing that would
   notify the wrong person. */
create or replace function sepak.claim_telegram_link(p_code uuid, p_chat_id bigint)
returns boolean
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_token uuid;
begin
  delete from sepak.telegram_links
   where code = p_code
     and created_at > clock_timestamp() - interval '1 hour'
  returning claim_token into v_token;

  if v_token is null then
    return false;
  end if;

  insert into sepak.telegram_chats (chat_id, claim_token)
  values (p_chat_id, v_token)
  on conflict (chat_id) do update set claim_token = excluded.claim_token;

  return true;
end;
$$;

/* /stop in the chat, or Telegram telling us the chat is gone (403). */
create or replace function sepak.drop_telegram_chat(p_chat_id bigint)
returns void
language sql
security definer
set search_path = sepak, pg_temp
as $$
  delete from sepak.telegram_chats where chat_id = p_chat_id;
$$;

create or replace function sepak.mark_telegram_sent(p_chat_id bigint)
returns void
language sql
security definer
set search_path = sepak, pg_temp
as $$
  update sepak.telegram_chats set last_sent_at = now() where chat_id = p_chat_id;
$$;

/* Who to message about one promotion, and what to say. */
create or replace function sepak.telegram_targets(p_activity_id bigint)
returns table (chat_id bigint, title text, body text, url text)
language sql
stable
security definer
set search_path = sepak, pg_temp
as $$
  select tc.chat_id, t.title, t.body, t.url
    from sepak.activity a
    join sepak.slots sl on sl.id = a.slot_id
    join sepak.telegram_chats tc on tc.claim_token = sl.claim_token
   cross join sepak.promotion_text(a.id) t
   where a.id = p_activity_id
     and a.kind = 'autofill';
$$;

revoke all on function sepak.claim_telegram_link(uuid, bigint) from public;
revoke all on function sepak.drop_telegram_chat(bigint)        from public;
revoke all on function sepak.mark_telegram_sent(bigint)        from public;
revoke all on function sepak.telegram_targets(bigint)          from public;
grant execute on function sepak.claim_telegram_link(uuid, bigint) to service_role;
grant execute on function sepak.drop_telegram_chat(bigint)        to service_role;
grant execute on function sepak.mark_telegram_sent(bigint)        to service_role;
grant execute on function sepak.telegram_targets(bigint)          to service_role;

---------------------------------------------------------------------------
-- The Edge Function's configuration gains the bot token and the webhook
-- secret. Redefined rather than altered so the whole shape stays in one
-- readable place.
---------------------------------------------------------------------------
-- Dropped rather than replaced: adding OUT columns changes the row type,
-- which CREATE OR REPLACE refuses. The grant is re-made below.
drop function if exists sepak.push_config();

create or replace function sepak.push_config()
returns table (
  shared_secret    text,
  vapid_public     text,
  vapid_private    text,
  vapid_subject    text,
  telegram_token   text,
  telegram_secret  text
)
language sql
stable
security definer
set search_path = sepak, pg_temp
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'sepak_push_secret'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'sepak_vapid_public'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'sepak_vapid_private'),
    coalesce(
      (select decrypted_secret from vault.decrypted_secrets where name = 'sepak_vapid_subject'),
      'mailto:admin@example.com'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'sepak_telegram_token'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'sepak_telegram_secret');
$$;

revoke all on function sepak.push_config() from public;
grant execute on function sepak.push_config() to service_role;
