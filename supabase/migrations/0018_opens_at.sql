-- An opening time. Before it, anyone can look at a session but only an
-- admin can book: claiming, moving and joining the queue are all refused.
-- The queue is included because joining it while a chosen position is
-- empty seats you straight away, which would make it a way in early.
--
-- Nothing runs at the opening time. The three booking functions compare
-- against now() on every call, so a session simply starts accepting
-- bookings, and there is no job that can fail or run late.
--
-- Existing sessions are opened from the moment they were created, so
-- nothing already running changes. The admin form requires the time for
-- new sessions; the column default exists only for direct inserts
-- (tests, seeding), which then open straight away.
--
-- Once the time passes it is locked (guard_opens_at below), and every
-- change before then is logged. Design: docs/superpowers/specs/
-- 2026-09-25-sepak-opening-time-design.md.

alter table sepak.sessions add column opens_at timestamptz;
update sepak.sessions set opens_at = created_at where opens_at is null;
alter table sepak.sessions alter column opens_at set not null;
alter table sepak.sessions alter column opens_at set default now();

comment on column sepak.sessions.opens_at is
  'Before this moment only admins can claim, move or queue. Enforced in claim_slot, move_slot and join_waitlist.';

-- Open pages learn about a changed opening time without a reload. anon
-- can already read every column of sessions, so this exposes nothing new.
alter publication supabase_realtime add table sepak.sessions;

create or replace function sepak.open_to_caller(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = sepak, pg_temp
as $$
  select coalesce(
    (select s.opens_at <= now() from sepak.sessions s where s.id = p_session_id),
    true
  ) or sepak.is_admin();
$$;

revoke all on function sepak.open_to_caller(uuid) from public;

-- The countdown runs off this rather than the phone's clock: a phone a
-- minute slow would otherwise show the slots opening a minute late, and
-- one a minute fast would show them open while the server still refuses.
create or replace function sepak.server_now()
returns timestamptz
language sql
stable
set search_path = sepak, pg_temp
as $$
  select now();
$$;

revoke all on function sepak.server_now() from public;
grant execute on function sepak.server_now() to anon, authenticated;

---------------------------------------------------------------------------
-- create_session takes the opening time. Dropped and recreated rather than
-- overloaded, for the same reason as in 0016_four_teams.sql.
---------------------------------------------------------------------------
drop function sepak.create_session(int, text, date, time, int, text, numeric, text, text, text, text, numeric);

create function sepak.create_session(
  p_session_no    int,
  p_title         text,
  p_play_date     date,
  p_start_time    time,
  p_duration_mins int,
  p_venue         text,
  p_fee_myr       numeric,
  p_team_a_name   text,
  p_team_b_name   text,
  p_team_c_name   text,
  p_team_d_name   text    default null,
  p_fee_gk_myr    numeric default null,
  p_opens_at      timestamptz default null
)
returns sepak.sessions
language plpgsql
set search_path = sepak, pg_temp
as $$
declare
  v_session sepak.sessions;
begin
  insert into sepak.sessions (
    session_no, title, play_date, start_time, duration_mins,
    venue, fee_myr, fee_gk_myr, team_a_name, team_b_name, team_c_name, team_d_name,
    opens_at
  ) values (
    p_session_no, btrim(p_title), p_play_date, p_start_time, coalesce(p_duration_mins, 120),
    btrim(p_venue), p_fee_myr, p_fee_gk_myr,
    coalesce(nullif(btrim(p_team_a_name), ''), 'Merah A'),
    coalesce(nullif(btrim(p_team_b_name), ''), 'Merah B'),
    coalesce(nullif(btrim(p_team_c_name), ''), 'Kuning A'),
    coalesce(nullif(btrim(p_team_d_name), ''), 'Kuning B'),
    -- The admin form always sends one; a caller that does not opens now.
    coalesce(p_opens_at, now())
  )
  returning * into v_session;

  -- All 44 slots in the same transaction: a session is never half-built.
  insert into sepak.slots (session_id, team, position)
  select v_session.id, t.team, p.position
    from (values ('A'), ('B'), ('C'), ('D')) as t(team)
   cross join (values ('GK'),('LB'),('CB1'),('CB2'),('RB'),('DM'),
                     ('MC'),('AM'),('LWF'),('RWF'),('ST')) as p(position);

  return v_session;
end;
$$;

revoke all on function sepak.create_session(int, text, date, time, int, text, numeric, text, text, text, text, numeric, timestamptz) from public;
grant execute on function sepak.create_session(int, text, date, time, int, text, numeric, text, text, text, text, numeric, timestamptz) to authenticated, service_role;

---------------------------------------------------------------------------
-- The opening time is a one-way door. It can move freely until it passes;
-- after that nobody can change it, admins and direct edits included. Without
-- this an admin could open a session, let friends book, and close it again.
--
-- A trigger on the table rather than a check in an RPC: the admin form
-- updates sessions directly (0002_rls.sql), and so does the SQL editor.
--
-- Every change that is allowed is written to the activity log with who made
-- it, so any other admin can see that the time moved.
---------------------------------------------------------------------------
alter table sepak.activity add column opens_from timestamptz;
alter table sepak.activity add column opens_to   timestamptz;

alter table sepak.activity drop constraint activity_kind_check;
alter table sepak.activity add constraint activity_kind_check check (kind in (
  'claim', 'autofill', 'release', 'admin_clear',
  'paid', 'unpaid', 'waitlist_join', 'waitlist_leave', 'opens_changed'));

comment on column sepak.activity.player_name is
  'The player the line is about. For opens_changed, who changed the time: the admin''s email, or "SQL editor".';

create or replace function sepak.guard_opens_at()
returns trigger
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
begin
  if NEW.opens_at is not distinct from OLD.opens_at then
    return NEW;
  end if;

  if OLD.opens_at <= now() then
    raise exception 'opens_locked';
  end if;

  insert into sepak.activity (kind, actor, session_id, player_name, opens_from, opens_to)
  values (
    'opens_changed',
    case when sepak.is_admin() then 'admin' else 'system' end,
    NEW.id,
    coalesce(nullif(auth.jwt() ->> 'email', ''), 'SQL editor'),
    OLD.opens_at,
    NEW.opens_at
  );

  return NEW;
end;
$$;

revoke all on function sepak.guard_opens_at() from public;

create trigger sessions_guard_opens_at
  before update on sepak.sessions
  for each row
  execute function sepak.guard_opens_at();

-- The feed carries the two times. The return type changes, so it is
-- dropped and recreated; otherwise as in 0012_activity.sql.
drop function sepak.activity_feed(int);

create function sepak.activity_feed(p_limit int default 100)
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
  opens_from  timestamptz,
  opens_to    timestamptz,
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
         a.player_name, a.phone, a.team, a.position, a.opens_from, a.opens_to, a.created_at
    from sepak.activity a
    join sepak.sessions s on s.id = a.session_id
   order by a.created_at desc, a.id desc
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

revoke all on function sepak.activity_feed(int) from public;
grant execute on function sepak.activity_feed(int) to authenticated;

---------------------------------------------------------------------------
-- The three booking functions, each otherwise exactly as last defined
-- (claim_slot and join_waitlist in 0012_activity.sql, move_slot in
-- 0015_move_slot.sql), with the opening check after the closed check.
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

  -- Before the opening time only an admin may book (0018_opens_at.sql).
  if not sepak.open_to_caller(v_slot.session_id) then
    raise exception 'not_open_yet';
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

  -- Before the opening time only an admin may book (0018_opens_at.sql).
  if not sepak.open_to_caller(p_session_id) then
    raise exception 'not_open_yet';
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

create or replace function sepak.move_slot(p_from uuid, p_to uuid, p_token uuid)
returns sepak.slots
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_from    sepak.slots;
  v_to      sepak.slots;
  v_status  text;
  v_name    text;
  v_phone   text;
  v_paid    boolean;
  v_paid_at timestamptz;
begin
  if p_from = p_to then
    raise exception 'same_slot';
  end if;

  -- Both rows, in a deterministic order, so two opposing moves cannot
  -- deadlock and neither slot can change under us mid-move.
  perform 1 from sepak.slots where id in (p_from, p_to) order by id for update;

  select * into v_from from sepak.slots where id = p_from;
  if not found then raise exception 'slot_not_found'; end if;
  select * into v_to from sepak.slots where id = p_to;
  if not found then raise exception 'slot_not_found'; end if;

  if v_from.session_id <> v_to.session_id then
    raise exception 'cross_session';
  end if;

  select status into v_status from sepak.sessions where id = v_from.session_id;
  if v_status is distinct from 'open' then
    raise exception 'session_closed';
  end if;

  -- Before the opening time only an admin may book (0018_opens_at.sql).
  if not sepak.open_to_caller(v_from.session_id) then
    raise exception 'not_open_yet';
  end if;

  if v_from.player_name is null then raise exception 'slot_empty'; end if;
  -- Safe against a null p_token only because slots_claim_complete guarantees
  -- v_from.claim_token is non-null whenever v_from.player_name is.
  if v_from.claim_token is distinct from p_token then raise exception 'wrong_token'; end if;
  if v_to.player_name is not null then raise exception 'slot_taken'; end if;

  v_name    := v_from.player_name;
  v_paid    := v_from.paid;
  v_paid_at := v_from.paid_at;
  -- Claims made before sepak.contacts existed carry no row; a move must not
  -- invent a number for them.
  select phone into v_phone from sepak.contacts where slot_id = p_from;

  update sepak.slots
     set player_name = null, claim_token = null, claimed_at = null
   where id = p_from;

  if v_phone is not null then
    insert into sepak.contacts (slot_id, phone) values (p_to, v_phone);
  end if;

  update sepak.slots
     set player_name = v_name, claim_token = p_token, claimed_at = now()
   where id = p_to
  returning * into v_to;

  if v_paid then
    update sepak.slots
       set paid = true, paid_at = v_paid_at
     where id = p_to
    returning * into v_to;
  end if;

  return v_to;
end;
$$;
