---------------------------------------------------------------------------
-- Web push, for one message only: you are off the waitlist and into a
-- position.
--
-- The queue can promote somebody hours after they joined it, while their
-- browser is shut. Realtime cannot reach a closed tab, and the organiser
-- should not have to notice and tell them by hand, so the database sends it.
--
-- Shape: the browser subscribes and hands us an endpoint; the promotion
-- itself is already recorded as an `autofill` row in sepak.activity, so that
-- insert is the trigger. A trigger calls out through pg_net to an Edge
-- Function, which is the only part of this that cannot live in SQL -- Web
-- Push needs an ECDSA signature and AES-GCM payload encryption, and
-- Postgres has neither.
--
-- Everything the function needs comes from one RPC below, so the function
-- stays a dumb courier and the decisions it would otherwise make -- who to
-- notify, in what words -- stay here, where they are testable.
---------------------------------------------------------------------------

create extension if not exists pg_net with schema extensions;

---------------------------------------------------------------------------
-- A push endpoint is a bearer capability: whoever holds it, plus the two
-- keys beside it, can push to that device. So this table is closed exactly
-- like sepak.contacts -- no grant to anon or authenticated, RLS on with no
-- policy, and service_role only. It is deliberately NOT in the realtime
-- publication.
--
-- Keyed by claim_token, the device identity the app already uses, so
-- subscribing adds no new personal data: no name, no phone, no account.
---------------------------------------------------------------------------
create table sepak.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  claim_token  uuid not null,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  -- clock_timestamp(), not now(): the cap below keeps the newest few, and
  -- now() is the transaction's start -- several subscriptions written in one
  -- transaction would be indistinguishable and the cap would drop an
  -- arbitrary one.
  created_at   timestamptz not null default clock_timestamp(),
  last_sent_at timestamptz,
  constraint push_endpoint_is_https check (endpoint like 'https://%')
);

comment on table sepak.push_subscriptions is
  'Web push endpoints per device (claim_token). Bearer capabilities: service_role only.';

create index push_subscriptions_token_idx on sepak.push_subscriptions (claim_token);

alter table sepak.push_subscriptions enable row level security;
revoke all on sepak.push_subscriptions from anon;
revoke all on sepak.push_subscriptions from authenticated;
grant select, insert, update, delete on sepak.push_subscriptions to service_role;

---------------------------------------------------------------------------
-- save_push_subscription
--
-- Upsert on endpoint: a browser re-subscribing presents the same endpoint,
-- a second device presents a new one.
--
-- The token must already hold a place in some session. This is an
-- anon-callable write, and that requirement is what keeps it from being an
-- open bucket anyone can fill -- a caller has to have actually booked or
-- queued for something first. The prompt is shown right after joining the
-- queue, so a real player always passes.
---------------------------------------------------------------------------
create or replace function sepak.save_push_subscription(
  p_token      uuid,
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
begin
  if p_token is null then
    raise exception 'invalid_token';
  end if;
  if p_endpoint is null or p_endpoint not like 'https://%'
     or p_p256dh is null or p_auth is null then
    raise exception 'invalid_subscription';
  end if;

  if not exists (select 1 from sepak.slots where claim_token = p_token)
     and not exists (select 1 from sepak.waitlist where claim_token = p_token) then
    raise exception 'not_in_session';
  end if;

  insert into sepak.push_subscriptions (claim_token, endpoint, p256dh, auth, user_agent)
  values (p_token, p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update
     set claim_token = excluded.claim_token,
         p256dh      = excluded.p256dh,
         auth        = excluded.auth,
         user_agent  = excluded.user_agent;

  -- One person does not need six live endpoints. Keeping the newest few
  -- stops a browser that re-subscribes on every visit from accumulating
  -- dead rows we would try, and fail, to push to forever.
  delete from sepak.push_subscriptions
   where claim_token = p_token
     and id not in (
       select id from sepak.push_subscriptions
        where claim_token = p_token
        order by created_at desc
        limit 3
     );
end;
$$;

/* Unsubscribing, or clearing a subscription the browser has replaced. The
   token is required so one device cannot silence another. */
create or replace function sepak.delete_push_subscription(p_token uuid, p_endpoint text)
returns void
language sql
security definer
set search_path = sepak, pg_temp
as $$
  delete from sepak.push_subscriptions
   where endpoint = p_endpoint
     and claim_token = p_token;
$$;

/* Whether this device is already subscribed, so the app can offer the bell
   only to someone who has not accepted -- without being able to read the
   endpoint back. Answering with a boolean leaks nothing: the caller had to
   present the token, which is their own. */
create or replace function sepak.has_push_subscription(p_token uuid)
returns boolean
language sql
security definer
set search_path = sepak, pg_temp
as $$
  select exists (select 1 from sepak.push_subscriptions where claim_token = p_token);
$$;

revoke all on function sepak.save_push_subscription(uuid, text, text, text, text) from public;
revoke all on function sepak.delete_push_subscription(uuid, text)                 from public;
revoke all on function sepak.has_push_subscription(uuid)                          from public;
grant execute on function sepak.save_push_subscription(uuid, text, text, text, text) to anon, authenticated;
grant execute on function sepak.delete_push_subscription(uuid, text)                 to anon, authenticated;
grant execute on function sepak.has_push_subscription(uuid)                          to anon, authenticated;

---------------------------------------------------------------------------
-- The words, and who hears them.
--
-- Malay month abbreviations, matching src/lib/format.ts and
-- scripts/sessionPages.mjs. Three copies of one list is not ideal, but the
-- alternative is the notification text being assembled somewhere it cannot
-- be tested.
---------------------------------------------------------------------------
create or replace function sepak.play_date_text(p_date date)
returns text
language sql
immutable
set search_path = sepak, pg_temp
as $$
  select format('%s %s',
    extract(day from p_date)::int,
    (array['Jan','Feb','Mac','Apr','Mei','Jun','Jul','Ogo','Sep','Okt','Nov','Dis'])[
      extract(month from p_date)::int]);
$$;

/* CB1 and CB2 both read as CB, as everywhere else in the app. */
create or replace function sepak.position_label(p_position text)
returns text
language sql
immutable
set search_path = sepak, pg_temp
as $$
  select case when p_position in ('CB1', 'CB2') then 'CB' else p_position end;
$$;

/* Everything the Edge Function needs for one promotion: the endpoints to
   push to, and the exact text to send. Service_role only -- this returns
   push credentials.

   Returns no rows when nobody subscribed, which is the common case and not
   an error. */
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
  select
    ps.endpoint,
    ps.p256dh,
    ps.auth,
    'Anda dah naik!'::text,
    format('%s %s — %s · Sesi %s, %s %s',
      'Team ' || sl.team,
      case sl.team when 'A' then se.team_a_name when 'B' then se.team_b_name else se.team_c_name end,
      sepak.position_label(sl.position),
      lpad(se.session_no::text, 3, '0'),
      sepak.play_date_text(se.play_date),
      to_char(se.start_time, 'FMHH12:MI AM')),
    -- The path form, which is the page that carries this session's own share
    -- tags (scripts/sessionPages.mjs), and the address the group's links use.
    'https://valehelle.github.io/sepak/s/' || se.id::text
    from sepak.activity a
    join sepak.slots sl    on sl.id = a.slot_id
    join sepak.sessions se on se.id = a.session_id
    join sepak.push_subscriptions ps on ps.claim_token = sl.claim_token
   where a.id = p_activity_id
     and a.kind = 'autofill';
$$;

/* The Edge Function's own configuration, read back through service_role
   rather than typed into a dashboard form. The function holds service_role
   already, so this is no escalation -- what it buys is that installing this
   feature is one SQL paste instead of a paste plus four secrets entered by
   hand, and that rotating a key is an UPDATE rather than a visit to two
   places that must agree. */
create or replace function sepak.push_config()
returns table (shared_secret text, vapid_public text, vapid_private text, vapid_subject text)
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
      'mailto:admin@example.com');
$$;

/* Called by the Edge Function when a push service reports an endpoint gone
   (404 or 410): the browser was uninstalled or cleared. */
create or replace function sepak.drop_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = sepak, pg_temp
as $$
  delete from sepak.push_subscriptions where endpoint = p_endpoint;
$$;

/* Bookkeeping, so a look at the table says whether delivery is working. */
create or replace function sepak.mark_push_sent(p_endpoint text)
returns void
language sql
security definer
set search_path = sepak, pg_temp
as $$
  update sepak.push_subscriptions set last_sent_at = now() where endpoint = p_endpoint;
$$;

revoke all on function sepak.push_config()                 from public;
revoke all on function sepak.push_targets(bigint)          from public;
revoke all on function sepak.drop_push_subscription(text)  from public;
revoke all on function sepak.mark_push_sent(text)          from public;
revoke all on function sepak.play_date_text(date)          from public;
revoke all on function sepak.position_label(text)          from public;
-- service_role only: these hand out push credentials, or act on them.
grant execute on function sepak.push_config()               to service_role;
grant execute on function sepak.push_targets(bigint)        to service_role;
grant execute on function sepak.drop_push_subscription(text) to service_role;
grant execute on function sepak.mark_push_sent(text)         to service_role;

---------------------------------------------------------------------------
-- The outbound call.
--
-- Fired only for `autofill` rows, and only ever passes the activity id --
-- the function looks everything else up as service_role. In particular the
-- claim token never crosses the wire, and never lands in pg_net's request
-- log.
--
-- Wrapped so that nothing here can fail a booking: if the secrets are
-- missing (a fresh local stack), or pg_net is having a bad day, the
-- promotion still stands and the activity line is still written. A
-- notification is a courtesy, not part of the transaction.
---------------------------------------------------------------------------
create or replace function sepak.notify_promotion()
returns trigger
language plpgsql
security definer
set search_path = sepak, extensions, pg_temp
as $$
declare
  v_url    text;
  v_secret text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    return NEW;
  end if;

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'sepak_push_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'sepak_push_secret';

  if v_url is null or v_secret is null then
    return NEW;
  end if;

  begin
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object('activity_id', NEW.id),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || v_secret),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'notify_promotion: could not queue push for activity %: %', NEW.id, sqlerrm;
  end;

  return NEW;
end;
$$;

create trigger activity_notify_promotion
  after insert on sepak.activity
  for each row
  when (NEW.kind = 'autofill')
  execute function sepak.notify_promotion();
