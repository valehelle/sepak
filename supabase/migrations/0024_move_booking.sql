---------------------------------------------------------------------------
-- Moving a booking to another browser, approved through Telegram.
--
-- A booking belongs to the browser holding its claim_token. A player who
-- booked inside WhatsApp's browser and comes back in Safari holds a
-- different token and cannot edit their slot or tick paid (0023 records
-- this). If the booking's browser connected Telegram (0014), the player can
-- ask from the new browser, and the bot asks the Telegram account linked to
-- the booking to approve. Approval hands the slot's token over to the
-- asking browser.
--
-- The proof is the Telegram account, not anything the asking browser knows:
-- anyone can press the button on any name, but only the chat linked to the
-- booking can say yes. Bookings without Telegram cannot be moved this way.
--
-- Flow:
--   browser B  -> request_move(slot, B)         inserts a pending request
--   trigger    -> notify-promotion Edge Function sends the Telegram message
--   Telegram   -> webhook -> decide_move(id, chat, yes/no)
--   browser B  -> move_request_status(id, B)    polls until decided
---------------------------------------------------------------------------

create table sepak.move_requests (
  id          uuid primary key default gen_random_uuid(),
  slot_id     uuid not null references sepak.slots (id) on delete cascade,
  -- The booking's token when asked. Approval checks the slot still holds
  -- it, so a request outlived by a release or another move does nothing.
  from_token  uuid not null,
  to_token    uuid not null,
  chat_id     bigint not null,
  user_agent  text default left(sepak.request_header('user-agent'), 300),
  ip          text default nullif(btrim(split_part(sepak.request_header('x-forwarded-for'), ',', 1)), ''),
  status      text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default clock_timestamp(),
  decided_at  timestamptz
);

comment on table sepak.move_requests is
  'Requests to move a booking to another browser. Tokens and chat ids: service_role only.';

create index move_requests_slot_idx on sepak.move_requests (slot_id, created_at desc);

alter table sepak.move_requests enable row level security;
revoke all on sepak.move_requests from anon, authenticated;
grant select, insert, update, delete on sepak.move_requests to service_role;

/* A request stops counting after ten minutes, without anything sweeping it:
   every reader compares created_at with this. */
create or replace function sepak.move_request_live(p_created_at timestamptz)
returns boolean
language sql
stable
set search_path = sepak, pg_temp
as $$
  select p_created_at > clock_timestamp() - interval '10 minutes';
$$;

/* The chat that can approve moving this booking: the newest one linked to
   the booking's token. */
create or replace function sepak.booking_chat(p_token uuid)
returns bigint
language sql
stable
security definer
set search_path = sepak, pg_temp
as $$
  select chat_id from sepak.telegram_chats
   where claim_token = p_token
   order by created_at desc
   limit 1;
$$;

---------------------------------------------------------------------------
-- What the asking browser can call.
---------------------------------------------------------------------------

/* Whether to offer the button at all: the slot is booked and its browser
   connected Telegram. Says nothing more about the booking than that. */
create or replace function sepak.move_available(p_slot_id uuid)
returns boolean
language sql
stable
security definer
set search_path = sepak, pg_temp
as $$
  select exists (
    select 1 from sepak.slots s
     where s.id = p_slot_id
       and s.player_name is not null
       and sepak.booking_chat(s.claim_token) is not null
  );
$$;

create or replace function sepak.request_move(p_slot_id uuid, p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_slot     sepak.slots;
  v_chat     bigint;
  v_existing sepak.move_requests;
  v_recent   int;
  v_id       uuid;
begin
  if p_token is null then
    raise exception 'invalid_token';
  end if;

  select * into v_slot from sepak.slots where id = p_slot_id for update;
  if not found then
    raise exception 'slot_not_found';
  end if;
  if v_slot.player_name is null then
    raise exception 'slot_empty';
  end if;
  if v_slot.claim_token = p_token then
    raise exception 'already_yours';
  end if;

  -- One booking per browser per session (0010): a browser already holding a
  -- place here cannot be handed a second one.
  if exists (select 1 from sepak.slots
              where session_id = v_slot.session_id and claim_token = p_token)
     or exists (select 1 from sepak.waitlist
                 where session_id = v_slot.session_id and claim_token = p_token) then
    raise exception 'already_in_slot';
  end if;

  v_chat := sepak.booking_chat(v_slot.claim_token);
  if v_chat is null then
    raise exception 'no_telegram';
  end if;

  -- One open request per booking. Asking again from the same browser while
  -- it is open returns it rather than sending a second message.
  select * into v_existing from sepak.move_requests
   where slot_id = p_slot_id and status = 'pending' and sepak.move_request_live(created_at)
   order by created_at desc
   limit 1;
  if found then
    if v_existing.to_token = p_token then
      return v_existing.id;
    end if;
    raise exception 'move_pending';
  end if;

  -- Anyone can press the button on any name, so the booking's owner gets at
  -- most three of these messages an hour.
  select count(*) into v_recent from sepak.move_requests
   where slot_id = p_slot_id and created_at > clock_timestamp() - interval '1 hour';
  if v_recent >= 3 then
    raise exception 'too_many_requests';
  end if;

  insert into sepak.move_requests (slot_id, from_token, to_token, chat_id)
  values (p_slot_id, v_slot.claim_token, p_token, v_chat)
  returning id into v_id;

  return v_id;
end;
$$;

/* 'pending', 'approved', 'rejected' or 'expired', for the browser that
   asked. Another browser's request reads as not_found. */
create or replace function sepak.move_request_status(p_id uuid, p_token uuid)
returns text
language plpgsql
stable
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_request sepak.move_requests;
begin
  select * into v_request from sepak.move_requests where id = p_id and to_token = p_token;
  if not found then
    raise exception 'not_found';
  end if;
  if v_request.status = 'pending' and not sepak.move_request_live(v_request.created_at) then
    return 'expired';
  end if;
  return v_request.status;
end;
$$;

---------------------------------------------------------------------------
-- What the Edge Function calls, as service_role.
---------------------------------------------------------------------------

/* The message for the booking's Telegram account. Null when the request is
   no longer worth sending. */
create or replace function sepak.move_request_message(p_id uuid)
returns table (chat_id bigint, body text)
language sql
stable
security definer
set search_path = sepak, pg_temp
as $$
  select r.chat_id,
         format(E'Ada browser lain minta slot anda dipindahkan kepadanya:\n%s\n\n'
                'Kalau itu anda (contohnya anda tempah dari WhatsApp, sekarang buka di Safari atau Chrome), tekan "Ya, pindahkan". '
                'Kalau bukan, tekan "Bukan saya" dan slot kekal di browser asal.',
           format('%s — Team %s %s · Sesi %s, %s %s',
             sl.player_name,
             case sl.team
               when 'A' then se.team_a_name
               when 'B' then se.team_b_name
               when 'C' then se.team_c_name
               else se.team_d_name
             end,
             sepak.position_label(sl.position),
             lpad(se.session_no::text, 3, '0'),
             sepak.play_date_text(se.play_date),
             to_char(se.start_time, 'FMHH12:MI AM')))
    from sepak.move_requests r
    join sepak.slots sl    on sl.id = r.slot_id
    join sepak.sessions se on se.id = sl.session_id
   where r.id = p_id
     and r.status = 'pending'
     and sepak.move_request_live(r.created_at);
$$;

/* The answer from Telegram. Only the chat the request was sent to can
   answer it. Returns what happened, for the bot to say back:
   approved, rejected, expired, stale (the booking changed hands since),
   already_in_slot, or not_found. */
create or replace function sepak.decide_move(p_id uuid, p_chat_id bigint, p_approve boolean)
returns text
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_request sepak.move_requests;
  v_slot    sepak.slots;
begin
  select * into v_request from sepak.move_requests
   where id = p_id and chat_id = p_chat_id
   for update;
  if not found then
    return 'not_found';
  end if;
  if v_request.status <> 'pending' then
    return v_request.status;
  end if;
  if not sepak.move_request_live(v_request.created_at) then
    return 'expired';
  end if;

  if not coalesce(p_approve, false) then
    update sepak.move_requests set status = 'rejected', decided_at = now() where id = p_id;
    return 'rejected';
  end if;

  select * into v_slot from sepak.slots where id = v_request.slot_id for update;
  if not found or v_slot.claim_token is distinct from v_request.from_token then
    return 'stale';
  end if;

  if exists (select 1 from sepak.slots
              where session_id = v_slot.session_id and claim_token = v_request.to_token)
     or exists (select 1 from sepak.waitlist
                 where session_id = v_slot.session_id and claim_token = v_request.to_token) then
    return 'already_in_slot';
  end if;

  update sepak.slots set claim_token = v_request.to_token where id = v_slot.id;
  -- Waitlist alerts follow the player to the browser they now use.
  update sepak.telegram_chats set claim_token = v_request.to_token where chat_id = p_chat_id;
  update sepak.move_requests set status = 'approved', decided_at = now() where id = p_id;

  -- Written here rather than by the slots trigger, which logs changes of
  -- occupant and paid only. The browser and address are the asking
  -- browser's, from the request, not the Edge Function's.
  insert into sepak.activity
    (kind, actor, session_id, slot_id, team, position, player_name, phone, device, user_agent, ip)
  values
    ('moved', 'player', v_slot.session_id, v_slot.id, v_slot.team, v_slot.position, v_slot.player_name,
     (select phone from sepak.contacts where slot_id = v_slot.id),
     sepak.device_code(v_request.to_token), v_request.user_agent, v_request.ip);

  return 'approved';
end;
$$;

alter table sepak.activity drop constraint activity_kind_check;
alter table sepak.activity add constraint activity_kind_check check (kind in (
  'claim', 'autofill', 'release', 'admin_clear',
  'paid', 'unpaid', 'waitlist_join', 'waitlist_leave', 'moved'));

---------------------------------------------------------------------------
-- Sending the message: the same Edge Function and Vault secrets as the
-- waitlist alert (0013_push.sql), called with {"move_request_id": ...}.
---------------------------------------------------------------------------
create or replace function sepak.notify_move_request()
returns trigger
language plpgsql
security definer
set search_path = sepak, pg_temp
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
      body    := jsonb_build_object('move_request_id', NEW.id),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || v_secret),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'notify_move_request: could not queue message for request %: %', NEW.id, sqlerrm;
  end;

  return NEW;
end;
$$;

create trigger move_requests_notify
  after insert on sepak.move_requests
  for each row
  execute function sepak.notify_move_request();

revoke all on function sepak.move_request_live(timestamptz)          from public, anon, authenticated;
revoke all on function sepak.booking_chat(uuid)                      from public, anon, authenticated;
revoke all on function sepak.move_available(uuid)                    from public;
revoke all on function sepak.request_move(uuid, uuid)                from public;
revoke all on function sepak.move_request_status(uuid, uuid)         from public;
revoke all on function sepak.move_request_message(uuid)              from public, anon, authenticated;
revoke all on function sepak.decide_move(uuid, bigint, boolean)      from public, anon, authenticated;
revoke all on function sepak.notify_move_request()                   from public, anon, authenticated;

grant execute on function sepak.move_available(uuid)                to anon, authenticated;
grant execute on function sepak.request_move(uuid, uuid)            to anon, authenticated;
grant execute on function sepak.move_request_status(uuid, uuid)     to anon, authenticated;
grant execute on function sepak.move_request_message(uuid)          to service_role;
grant execute on function sepak.decide_move(uuid, bigint, boolean)  to service_role;
