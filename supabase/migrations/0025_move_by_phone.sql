---------------------------------------------------------------------------
-- Moving a booking to another browser, proved by the booking's phone number.
--
-- Replaces the approval message of 0024, which needed the booking's browser
-- to have connected Telegram first. Every booking carries a phone number
-- (0009), and it cannot be changed after booking. Telegram can tell the bot
-- the number of the account talking to it: the player presses Telegram's
-- "share my number" button, and the number arrives attached to their own
-- account id, which the Edge Function checks. If it matches the booking's
-- number, the booking moves to the browser that asked.
--
-- Flow:
--   browser B  -> request_move(slot, B)        a pending request; its id goes
--                                              into a t.me link
--   Telegram   -> /start move_<id>  -> start_move(id, chat)
--                                              ties the chat to the request;
--                                              the bot asks for the number
--   Telegram   -> shared contact    -> finish_move(chat, phone)
--   browser B  -> move_request_status(id, B)   polls until decided
---------------------------------------------------------------------------

drop trigger move_requests_notify on sepak.move_requests;
drop function sepak.notify_move_request();
drop function sepak.move_request_message(uuid);
drop function sepak.decide_move(uuid, bigint, boolean);
drop function sepak.booking_chat(uuid);

comment on table sepak.move_requests is
  'Requests to move a booking to another browser. Tokens and chat ids: service_role only.';

-- The chat is the one that opened the request's link, set by start_move.
alter table sepak.move_requests alter column chat_id drop not null;

-- rejected: the Telegram number is not the booking's.
-- failed: the number matched but the booking could not move (see finish_move).
alter table sepak.move_requests drop constraint move_requests_status_check;
alter table sepak.move_requests add constraint move_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'failed'));

create index move_requests_chat_idx on sepak.move_requests (chat_id, created_at desc);

/* Whether to offer the button: the slot is booked and the booking has a
   number to check against. */
create or replace function sepak.move_available(p_slot_id uuid)
returns boolean
language sql
stable
security definer
set search_path = sepak, pg_temp
as $$
  select exists (
    select 1 from sepak.slots s
      join sepak.contacts c on c.slot_id = s.id
     where s.id = p_slot_id
       and s.player_name is not null
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
  v_existing uuid;
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

  -- One booking per browser per session (0010).
  if exists (select 1 from sepak.slots
              where session_id = v_slot.session_id and claim_token = p_token)
     or exists (select 1 from sepak.waitlist
                 where session_id = v_slot.session_id and claim_token = p_token) then
    raise exception 'already_in_slot';
  end if;

  -- Pressing again from the same browser reuses the open request, so the
  -- page and the t.me link keep pointing at the same one.
  select id into v_existing from sepak.move_requests
   where slot_id = p_slot_id and to_token = p_token
     and status = 'pending' and sepak.move_request_live(created_at)
   order by created_at desc
   limit 1;
  if found then
    return v_existing;
  end if;

  select count(*) into v_recent from sepak.move_requests
   where slot_id = p_slot_id and created_at > clock_timestamp() - interval '1 hour';
  if v_recent >= 10 then
    raise exception 'too_many_requests';
  end if;

  insert into sepak.move_requests (slot_id, from_token, to_token)
  values (p_slot_id, v_slot.claim_token, p_token)
  returning id into v_id;

  return v_id;
end;
$$;

---------------------------------------------------------------------------
-- What the Edge Function calls, as service_role.
---------------------------------------------------------------------------

/* The chat opened the request's link. Ties the chat to the request and
   returns the line describing the booking, for the bot to show above the
   share-number button. Null when the request is no longer open. */
create or replace function sepak.start_move(p_id uuid, p_chat_id bigint)
returns text
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_line text;
begin
  update sepak.move_requests set chat_id = p_chat_id
   where id = p_id and status = 'pending' and sepak.move_request_live(created_at);
  if not found then
    return null;
  end if;

  select format('%s — Team %s %s · Sesi %s, %s %s',
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
           to_char(se.start_time, 'FMHH12:MI AM'))
    into v_line
    from sepak.move_requests r
    join sepak.slots sl    on sl.id = r.slot_id
    join sepak.sessions se on se.id = sl.session_id
   where r.id = p_id;

  return v_line;
end;
$$;

/* The chat shared its own number. Decides the newest open request the chat
   started. Returns what happened, for the bot to say back:
   approved, rejected (number differs), stale (the booking changed hands
   since), already_in_slot, or not_found. The number is compared and not
   kept. */
create or replace function sepak.finish_move(p_chat_id bigint, p_phone text)
returns text
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_request sepak.move_requests;
  v_slot    sepak.slots;
  v_phone   text;
  v_given   text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  select * into v_request from sepak.move_requests
   where chat_id = p_chat_id and status = 'pending' and sepak.move_request_live(created_at)
   order by created_at desc
   limit 1
   for update;
  if not found then
    return 'not_found';
  end if;

  select * into v_slot from sepak.slots where id = v_request.slot_id for update;
  if not found or v_slot.claim_token is distinct from v_request.from_token then
    update sepak.move_requests set status = 'failed', decided_at = now() where id = v_request.id;
    return 'stale';
  end if;

  select phone into v_phone from sepak.contacts where slot_id = v_slot.id;
  if v_phone is null or v_given <> v_phone then
    update sepak.move_requests set status = 'rejected', decided_at = now() where id = v_request.id;
    return 'rejected';
  end if;

  if exists (select 1 from sepak.slots
              where session_id = v_slot.session_id and claim_token = v_request.to_token)
     or exists (select 1 from sepak.waitlist
                 where session_id = v_slot.session_id and claim_token = v_request.to_token) then
    update sepak.move_requests set status = 'failed', decided_at = now() where id = v_request.id;
    return 'already_in_slot';
  end if;

  update sepak.slots set claim_token = v_request.to_token where id = v_slot.id;
  -- This chat now gets the waitlist alerts for the browser it moved to.
  insert into sepak.telegram_chats (chat_id, claim_token)
  values (p_chat_id, v_request.to_token)
  on conflict (chat_id) do update set claim_token = excluded.claim_token;
  update sepak.move_requests set status = 'approved', decided_at = now() where id = v_request.id;

  -- Written here rather than by the slots trigger, which logs changes of
  -- occupant and paid only. The browser and address are the asking
  -- browser's, from the request, not the Edge Function's.
  insert into sepak.activity
    (kind, actor, session_id, slot_id, team, position, player_name, phone, device, user_agent, ip)
  values
    ('moved', 'player', v_slot.session_id, v_slot.id, v_slot.team, v_slot.position, v_slot.player_name,
     v_phone, sepak.device_code(v_request.to_token), v_request.user_agent, v_request.ip);

  return 'approved';
end;
$$;

revoke all on function sepak.start_move(uuid, bigint)  from public, anon, authenticated;
revoke all on function sepak.finish_move(bigint, text) from public, anon, authenticated;
grant execute on function sepak.start_move(uuid, bigint)  to service_role;
grant execute on function sepak.finish_move(bigint, text) to service_role;
