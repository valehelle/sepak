---------------------------------------------------------------------------
-- activity: which device and browser each line came from.
--
-- A booking belongs to whoever holds its claim_token, and the token lives
-- in one browser's localStorage. A player who books from the browser inside
-- WhatsApp and comes back in Safari or Chrome holds a different token, so
-- the page no longer treats the slot as theirs: they cannot edit it or tick
-- paid. The user agent alone cannot show this -- WhatsApp's browser on an
-- iPhone reports itself as Safari -- so each line also carries a device
-- code: the first six hex digits of the booking's token, hashed. The page
-- shows a player their own code, and a code that differs from the one on
-- their booking line means they are in a different browser.
--
-- The code is a hash, so it cannot be turned back into the token that
-- authorises edits.
--
-- user_agent and ip are read from the request headers PostgREST puts in
-- `request.headers`, as column defaults, so every trigger-written line gets
-- them. Outside a PostgREST request (psql, a migration) both stay null.
--
-- The lines are read only through session_activity() and activity_feed(),
-- which already refuse anyone but an admin.
---------------------------------------------------------------------------

/* One request header, or null. Never raises: a malformed header must not
   stop a booking from being written. */
create or replace function sepak.request_header(p_name text)
returns text
language plpgsql
stable
set search_path = sepak, pg_temp
as $$
begin
  return nullif(current_setting('request.headers', true), '')::json ->> p_name;
exception when others then
  return null;
end;
$$;

/* Matches deviceCode() in src/lib/deviceCode.ts. */
create or replace function sepak.device_code(p_token uuid)
returns text
language sql
immutable
set search_path = sepak, pg_temp
as $$
  select left(encode(sha256(convert_to(p_token::text, 'UTF8')), 'hex'), 6);
$$;

revoke all on function sepak.request_header(text) from public, anon, authenticated;
revoke all on function sepak.device_code(uuid)    from public, anon, authenticated;

alter table sepak.activity
  -- The device holding the booking the line is about: the player's own for
  -- what they did, the booking's owner for what an admin did to it.
  add column device text,
  add column user_agent text
    default left(sepak.request_header('user-agent'), 300),
  -- The first address in x-forwarded-for is the client; the rest are the
  -- proxies it came through.
  add column ip text
    default nullif(btrim(split_part(sepak.request_header('x-forwarded-for'), ',', 1)), '');

---------------------------------------------------------------------------
-- The writers, as in 0012_activity.sql, now passing the booking's token.
---------------------------------------------------------------------------
drop function sepak.log_activity(text, text, uuid, uuid, text, text, text, text);

create function sepak.log_activity(
  p_kind       text,
  p_actor      text,
  p_session_id uuid,
  p_slot_id    uuid,
  p_team       text,
  p_position   text,
  p_name       text,
  p_phone      text,
  p_token      uuid
)
returns void
language sql
security definer
set search_path = sepak, pg_temp
as $$
  insert into sepak.activity (kind, actor, session_id, slot_id, team, position, player_name, phone, device)
  values (p_kind, p_actor, p_session_id, p_slot_id, p_team, p_position, p_name, p_phone,
          case when p_token is null then null else sepak.device_code(p_token) end);
$$;

revoke all on function sepak.log_activity(text, text, uuid, uuid, text, text, text, text, uuid) from public;

create or replace function sepak.log_slot_activity()
returns trigger
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_actor text := sepak.activity_actor();
  v_phone text;
begin
  -- Occupant changes are checked first and the paid branch is an elsif: one
  -- UPDATE must never produce two lines, and vacating a paid slot clears the
  -- tick as a side effect (slots_reset_paid) rather than as an event.
  if NEW.player_name is distinct from OLD.player_name then
    if NEW.player_name is not null then
      v_phone := sepak.activity_phone(NEW.id, NEW.session_id, NEW.claim_token);
      perform sepak.log_activity(
        case when v_actor = 'system' then 'autofill' else 'claim' end,
        v_actor, NEW.session_id, NEW.id, NEW.team, NEW.position, NEW.player_name, v_phone,
        NEW.claim_token);
    else
      v_phone := sepak.activity_phone(OLD.id, OLD.session_id, OLD.claim_token);
      perform sepak.log_activity(
        case when v_actor = 'admin' then 'admin_clear' else 'release' end,
        v_actor, OLD.session_id, OLD.id, OLD.team, OLD.position, OLD.player_name, v_phone,
        OLD.claim_token);
    end if;
  -- `player_name is not null` guards the case slots_paid_complete rejects a
  -- moment later: a paid flag on an empty slot has nobody to log, and a line
  -- with no name is not a line.
  elsif NEW.paid is distinct from OLD.paid and NEW.player_name is not null then
    v_phone := sepak.activity_phone(NEW.id, NEW.session_id, NEW.claim_token);
    perform sepak.log_activity(
      case when NEW.paid then 'paid' else 'unpaid' end,
      v_actor, NEW.session_id, NEW.id, NEW.team, NEW.position, NEW.player_name, v_phone,
      NEW.claim_token);
  end if;

  return NEW;
end;
$$;

create or replace function sepak.log_waitlist_join()
returns trigger
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_wait sepak.waitlist;
begin
  select * into v_wait from sepak.waitlist where id = NEW.waitlist_id;
  if found then
    perform sepak.log_activity(
      'waitlist_join', sepak.activity_actor(), v_wait.session_id,
      null, null, null, v_wait.player_name, NEW.phone, v_wait.claim_token);
  end if;
  return NEW;
end;
$$;

create or replace function sepak.log_waitlist_leave()
returns trigger
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_actor text := sepak.activity_actor();
  v_phone text;
begin
  if v_actor = 'system' then
    return OLD;
  end if;

  -- Deleting a session cascades its queue away, and by the time this fires
  -- the session row is already gone -- a line written now would fail its own
  -- foreign key, and would be cascaded away a moment later anyway.
  if not exists (select 1 from sepak.sessions where id = OLD.session_id) then
    return OLD;
  end if;

  select phone into v_phone from sepak.contacts where waitlist_id = OLD.id;
  perform sepak.log_activity(
    'waitlist_leave', v_actor, OLD.session_id,
    null, null, null, OLD.player_name, v_phone, OLD.claim_token);
  return OLD;
end;
$$;

---------------------------------------------------------------------------
-- The read path. The return type grows, which create or replace cannot do.
---------------------------------------------------------------------------
drop function sepak.session_activity(uuid, int);

create function sepak.session_activity(p_session_id uuid, p_limit int default 200)
returns table (
  id          bigint,
  session_id  uuid,
  session_no  int,
  kind        text,
  actor       text,
  player_name text,
  phone       text,
  team        text,
  "position"  text,
  device      text,
  user_agent  text,
  ip          text,
  created_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = sepak, pg_temp
as $$
begin
  if not sepak.is_admin() then
    raise exception 'not_admin';
  end if;

  return query
  select a.id, a.session_id, s.session_no, a.kind, a.actor,
         a.player_name, a.phone, a.team, a.position,
         a.device, a.user_agent, a.ip, a.created_at
    from sepak.activity a
    join sepak.sessions s on s.id = a.session_id
   where a.session_id = p_session_id
   order by a.created_at desc, a.id desc
   limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

revoke all on function sepak.session_activity(uuid, int) from public;
grant execute on function sepak.session_activity(uuid, int) to authenticated;
