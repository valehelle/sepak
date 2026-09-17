---------------------------------------------------------------------------
-- activity: an append-only log of what happened to a session, for the
-- organiser.
--
-- Written by triggers, never by the client. anon cannot write slots or
-- waitlist directly (0002_rls.sql), so every change to either arrives
-- through an RPC or the organiser's own update -- and all of those pass
-- through the triggers below. Nothing here depends on a browser choosing
-- to report itself.
--
-- Read like sepak.contacts is read: no grant to anon OR authenticated, and
-- one SECURITY DEFINER function that checks the allowlist itself. The rows
-- carry phone numbers, and `authenticated` includes signed-in accounts that
-- are not admins, so a plain grant plus an RLS policy would be a weaker
-- promise than the one 0009 already makes about numbers.
---------------------------------------------------------------------------
create table sepak.activity (
  id          bigint generated always as identity primary key,
  session_id  uuid not null references sepak.sessions (id) on delete cascade,
  -- Nulled rather than cascaded: a line about a slot outlives the slot row,
  -- and team/position below are copied so the line still reads on its own.
  slot_id     uuid references sepak.slots (id) on delete set null,
  kind        text not null check (kind in (
                'claim', 'autofill', 'release', 'admin_clear',
                'paid', 'unpaid', 'waitlist_join', 'waitlist_leave')),
  actor       text not null check (actor in ('player', 'admin', 'system')),
  player_name text not null,
  -- The number as it was at the time. This is the whole point of storing it:
  -- vacating a slot drops its sepak.contacts row, so without this a release
  -- line could not tell the organiser which Amir walked away.
  phone       text,
  team        text check (team in ('A', 'B', 'C')),
  position    text check (position in
                ('GK','LB','CB1','CB2','RB','DM','MC','AM','LWF','RWF','ST')),
  -- clock_timestamp(), not now(): a log wants the moment the event happened,
  -- and now() is the transaction's start -- one release that auto-fills a
  -- queued player would stamp both lines identically.
  created_at  timestamptz not null default clock_timestamp()
);

comment on table sepak.activity is
  'Append-only session history. Written by triggers; read only via activity_feed().';

create index activity_recent_idx on sepak.activity (created_at desc);

alter table sepak.activity enable row level security;
-- RLS on with no policy for anon/authenticated: nothing is visible even if a
-- grant were added later by mistake. The revokes are the belt to that brace.
revoke all on sepak.activity from anon;
revoke all on sepak.activity from authenticated;
grant select, insert, update, delete on sepak.activity to service_role;

---------------------------------------------------------------------------
-- Who is doing this?
--
-- 'system' is flagged by the functions that move somebody without anybody
-- asking (auto-fill), through a transaction-local setting -- the trigger
-- cannot otherwise tell a promotion from a claim, since both arrive as the
-- same UPDATE. 'admin' is the allowlist, checked server-side. Everything
-- else is the player on their own device.
---------------------------------------------------------------------------
create or replace function sepak.activity_actor()
returns text
language plpgsql
stable
security definer
set search_path = sepak, pg_temp
as $$
begin
  if coalesce(current_setting('sepak.actor', true), '') = 'system' then
    return 'system';
  end if;
  if sepak.is_admin() then
    return 'admin';
  end if;
  return 'player';
end;
$$;

/* The number for the person this line is about. A claimed slot has its own
   contacts row; a player being promoted out of the queue still has theirs
   hanging off the waitlist entry at the moment the slot changes hands, so
   that is looked up by the token the claim carries. */
create or replace function sepak.activity_phone(p_slot_id uuid, p_session_id uuid, p_token uuid)
returns text
language sql
stable
security definer
set search_path = sepak, pg_temp
as $$
  select coalesce(
    (select phone from sepak.contacts where slot_id = p_slot_id),
    (select c.phone
       from sepak.contacts c
       join sepak.waitlist w on w.id = c.waitlist_id
      where w.session_id = p_session_id
        and p_token is not null
        and w.claim_token = p_token
      limit 1)
  );
$$;

create or replace function sepak.log_activity(
  p_kind       text,
  p_actor      text,
  p_session_id uuid,
  p_slot_id    uuid,
  p_team       text,
  p_position   text,
  p_name       text,
  p_phone      text
)
returns void
language sql
security definer
set search_path = sepak, pg_temp
as $$
  insert into sepak.activity (kind, actor, session_id, slot_id, team, position, player_name, phone)
  values (p_kind, p_actor, p_session_id, p_slot_id, p_team, p_position, p_name, p_phone);
$$;

---------------------------------------------------------------------------
-- Slots: claims, promotions, releases, admin clears, and the paid tick.
--
-- BEFORE UPDATE, and named to sort ahead of slots_drop_contact and
-- slots_reset_paid, because both of those destroy what this needs: the
-- contacts row holding the phone, and the pre-reset value of `paid`.
---------------------------------------------------------------------------
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
        v_actor, NEW.session_id, NEW.id, NEW.team, NEW.position, NEW.player_name, v_phone);
    else
      v_phone := sepak.activity_phone(OLD.id, OLD.session_id, OLD.claim_token);
      perform sepak.log_activity(
        case when v_actor = 'admin' then 'admin_clear' else 'release' end,
        v_actor, OLD.session_id, OLD.id, OLD.team, OLD.position, OLD.player_name, v_phone);
    end if;
  -- `player_name is not null` guards the case slots_paid_complete rejects a
  -- moment later: a paid flag on an empty slot has nobody to log, and a line
  -- with no name is not a line.
  elsif NEW.paid is distinct from OLD.paid and NEW.player_name is not null then
    v_phone := sepak.activity_phone(NEW.id, NEW.session_id, NEW.claim_token);
    perform sepak.log_activity(
      case when NEW.paid then 'paid' else 'unpaid' end,
      v_actor, NEW.session_id, NEW.id, NEW.team, NEW.position, NEW.player_name, v_phone);
  end if;

  return NEW;
end;
$$;

create trigger slots_activity
  before update on sepak.slots
  for each row
  execute function sepak.log_slot_activity();

---------------------------------------------------------------------------
-- Joining the queue is logged from the contacts insert rather than from the
-- waitlist insert: the number arrives one statement later than the entry
-- (the FK needs the entry to exist first), and a queue line without a
-- number would be the one line the organiser cannot act on.
---------------------------------------------------------------------------
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
      null, null, null, v_wait.player_name, NEW.phone);
  end if;
  return NEW;
end;
$$;

create trigger contacts_activity
  after insert on sepak.contacts
  for each row
  when (NEW.waitlist_id is not null)
  execute function sepak.log_waitlist_join();

---------------------------------------------------------------------------
-- Leaving the queue. BEFORE DELETE, so the cascade has not yet taken the
-- contacts row with the number.
--
-- A queue entry also disappears for two reasons that are not somebody
-- leaving: auto-fill consumes it, and claiming a slot directly consumes it.
-- Both flag themselves as 'system' and are skipped here -- the promotion or
-- the claim is already the line that says what happened.
---------------------------------------------------------------------------
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
    null, null, null, OLD.player_name, v_phone);
  return OLD;
end;
$$;

create trigger waitlist_activity
  before delete on sepak.waitlist
  for each row
  execute function sepak.log_waitlist_leave();

---------------------------------------------------------------------------
-- activity_feed: the organiser's read path, newest first.
---------------------------------------------------------------------------
create or replace function sepak.activity_feed(p_limit int default 100)
returns table (
  id          bigint,
  session_id  uuid,
  session_no  int,
  kind        text,
  actor       text,
  player_name text,
  phone       text,
  team        text,
  -- Quoted: POSITION is a keyword, and a RETURNS TABLE column list (unlike
  -- CREATE TABLE) will not take it bare. The name over the wire is still
  -- `position`, matching sepak.slots.
  "position"  text,
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
         a.player_name, a.phone, a.team, a.position, a.created_at
    from sepak.activity a
    join sepak.sessions s on s.id = a.session_id
   order by a.created_at desc, a.id desc
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

revoke all on function sepak.activity_actor()                      from public;
revoke all on function sepak.activity_phone(uuid, uuid, uuid)      from public;
revoke all on function sepak.log_activity(text, text, uuid, uuid, text, text, text, text) from public;
revoke all on function sepak.activity_feed(int)                    from public;

-- Only the feed is callable from outside; everything else above exists for
-- the triggers, which run as their owner and need no grant.
grant execute on function sepak.activity_feed(int) to authenticated;

---------------------------------------------------------------------------
-- Three existing functions, redefined only for the log's benefit. The
-- booking rules they enforce are unchanged; what changes is the order of
-- two inserts (so the phone is readable when the trigger fires) and the
-- 'system' flag around the moves nobody asked for.
---------------------------------------------------------------------------

create or replace function sepak.claim_slot(p_slot_id uuid, p_name text, p_phone text, p_token uuid)
returns sepak.slots
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_slot   sepak.slots;
  v_status text;
  v_name   text := btrim(coalesce(p_name, ''));
begin
  if v_name = '' or char_length(v_name) > 40 then
    raise exception 'invalid_name';
  end if;
  if p_phone is null or p_phone !~ '^601[0-9]{8,9}$' then
    raise exception 'invalid_phone';
  end if;
  if p_token is null then
    raise exception 'invalid_token';
  end if;

  select * into v_slot from sepak.slots where id = p_slot_id for update;
  if not found then
    raise exception 'slot_not_found';
  end if;

  select status into v_status from sepak.sessions where id = v_slot.session_id;
  if v_status is distinct from 'open' then
    raise exception 'session_closed';
  end if;

  if v_slot.player_name is not null then
    raise exception 'slot_taken';
  end if;

  -- The new rule. Checked after the row lock above, so two concurrent
  -- claims from the same device cannot both pass it: the second waits for
  -- the first to commit and then sees the slot it took.
  if exists (
    select 1 from sepak.slots
     where session_id = v_slot.session_id
       and claim_token = p_token
  ) then
    raise exception 'already_in_slot';
  end if;

  -- Same person, different device: the number is already on a slot here.
  if exists (
    select 1
      from sepak.contacts c
      join sepak.slots s on s.id = c.slot_id
     where s.session_id = v_slot.session_id
       and c.phone = p_phone
  ) then
    raise exception 'phone_in_use';
  end if;

  -- ...or already waiting in the queue on another device. Their own
  -- device's queue entry is excluded: the delete below consumes it.
  if exists (
    select 1
      from sepak.contacts c
      join sepak.waitlist w on w.id = c.waitlist_id
     where w.session_id = v_slot.session_id
       and c.phone = p_phone
       and w.claim_token is distinct from p_token
  ) then
    raise exception 'phone_in_use';
  end if;

  -- Ahead of the update, not after it: the activity trigger on slots reads
  -- the number off this row (0012_activity.sql), and PostgreSQL fires that
  -- trigger during the update below. The FK is satisfied either way -- the
  -- slot row itself has existed since the session was created.
  insert into sepak.contacts (slot_id, phone) values (p_slot_id, p_phone);

  update sepak.slots
     set player_name = v_name, claim_token = p_token, claimed_at = now()
   where id = p_slot_id
  returning * into v_slot;

  -- Consuming this device's queue entry is part of claiming, so it is
  -- flagged as 'system' and the waitlist_leave line is suppressed: the
  -- claim above already says what happened.
  perform set_config('sepak.actor', 'system', true);
  delete from sepak.waitlist
   where session_id = v_slot.session_id
     and claim_token = p_token;
  perform set_config('sepak.actor', '', true);

  return v_slot;
end;
$$;

create or replace function sepak.join_waitlist(
  p_session_id uuid,
  p_name       text,
  p_phone      text,
  p_positions  text[],
  p_token      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_name        text := btrim(coalesce(p_name, ''));
  v_status      text;
  v_slot        sepak.slots;
  v_waitlist_id uuid;
begin
  if current_setting('transaction_read_only')::boolean then
    raise exception 'read_only_not_allowed' using errcode = '25006';
  end if;

  if v_name = '' or char_length(v_name) > 40 then
    raise exception 'invalid_name';
  end if;
  if p_phone is null or p_phone !~ '^601[0-9]{8,9}$' then
    raise exception 'invalid_phone';
  end if;
  if p_token is null then
    raise exception 'invalid_token';
  end if;
  if p_positions is null or array_length(p_positions, 1) is null
     or not (p_positions <@ array['GK','LB','CB1','CB2','RB','DM','MC','AM','LWF','RWF','ST']) then
    raise exception 'invalid_positions';
  end if;

  select status into v_status from sepak.sessions where id = p_session_id;
  if v_status is distinct from 'open' then
    raise exception 'session_closed';
  end if;

  if exists (
    select 1 from sepak.slots
     where session_id = p_session_id and claim_token = p_token
  ) then
    raise exception 'already_in_slot';
  end if;

  if exists (
    select 1 from sepak.waitlist
     where session_id = p_session_id and claim_token = p_token
  ) then
    raise exception 'already_waitlisted';
  end if;

  if exists (
    select 1
      from sepak.contacts c
      join sepak.slots s on s.id = c.slot_id
     where s.session_id = p_session_id
       and c.phone = p_phone
  ) then
    raise exception 'phone_in_use';
  end if;

  if exists (
    select 1
      from sepak.contacts c
      join sepak.waitlist w on w.id = c.waitlist_id
     where w.session_id = p_session_id
       and c.phone = p_phone
  ) then
    raise exception 'phone_in_use';
  end if;

  select * into v_slot
    from sepak.slots
   where session_id = p_session_id
     and player_name is null
     and position = any(p_positions)
   order by team, array_position(
     array['GK','LB','CB1','CB2','RB','DM','MC','AM','LWF','RWF','ST']::text[], position
   )
   limit 1
     for update skip locked;

  if found then
    -- Before the update, so the activity trigger sees the number: see the
    -- same reordering in claim_slot above.
    insert into sepak.contacts (slot_id, phone) values (v_slot.id, p_phone);

    update sepak.slots
       set player_name = v_name, claim_token = p_token, claimed_at = now()
     where id = v_slot.id;

    return jsonb_build_object('placed', true, 'slot_id', v_slot.id);
  end if;

  insert into sepak.waitlist (session_id, player_name, claim_token, positions)
  values (p_session_id, v_name, p_token, p_positions)
  returning id into v_waitlist_id;

  insert into sepak.contacts (waitlist_id, phone) values (v_waitlist_id, p_phone);

  return jsonb_build_object('placed', false, 'waitlist_id', v_waitlist_id);
end;
$$;

create or replace function sepak.fill_from_waitlist()
returns trigger
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_status text;
  v_wait   sepak.waitlist;
begin
  select status into v_status from sepak.sessions where id = NEW.session_id;
  if v_status is distinct from 'open' then
    return NEW;
  end if;

  select * into v_wait
    from sepak.waitlist
   where session_id = NEW.session_id
     and NEW.position = any(positions)
   order by created_at
   limit 1
     for update skip locked;

  if found then
    -- Everything between here and the reset is the queue moving somebody by
    -- itself: it logs as 'autofill' rather than a claim, and the entry's
    -- disappearance logs as nothing at all (0012_activity.sql).
    perform set_config('sepak.actor', 'system', true);

    update sepak.slots
       set player_name = v_wait.player_name,
           claim_token = v_wait.claim_token,
           claimed_at = now()
     where id = NEW.id;

    update sepak.contacts
       set slot_id = NEW.id, waitlist_id = null
     where waitlist_id = v_wait.id;

    delete from sepak.waitlist where id = v_wait.id;

    perform set_config('sepak.actor', '', true);
  end if;

  return NEW;
end;
$$;
