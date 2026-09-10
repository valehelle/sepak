---------------------------------------------------------------------------
-- waitlist: a queue of players waiting for a matching slot to free up.
-- Same security shape as slots (see 0002_rls.sql): claim_token is a secret
-- the device PRESENTS to prove ownership, never a value the server hands
-- back, so anon's column-level select grant below excludes it.
---------------------------------------------------------------------------
create table public.waitlist (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.sessions (id) on delete cascade,
  player_name  text not null,
  claim_token  uuid not null,
  positions    text[] not null,
  created_at   timestamptz not null default now(),
  -- One entry per device per session -- the same discipline slots uses via
  -- its (session_id, team, position) uniqueness, just keyed on the device.
  constraint waitlist_unique_device unique (session_id, claim_token),
  constraint waitlist_name_length check (char_length(btrim(player_name)) between 1 and 40),
  -- `array_length('{}', 1)` is NULL, not 0 -- a bare `between 1 and 11`
  -- would compare NULL and be neither true nor false, which Postgres
  -- treats as satisfied (a CHECK only fails on an explicit false), silently
  -- letting an empty array through. coalesce(..., 0) closes that.
  constraint waitlist_positions_length check (coalesce(array_length(positions, 1), 0) between 1 and 11),
  constraint waitlist_positions_subset check (positions <@ array[
    'GK','LB','CB1','CB2','RB','DM','MC','AM','LWF','RWF','ST'
  ])
);

comment on column public.waitlist.claim_token is
  'The claiming device''s localStorage UUID, mirroring slots.claim_token. Presenting it is what authorises leave_waitlist and my_waitlist_entry.';
comment on column public.waitlist.positions is
  'The expanded set of acceptable positions, not a preset name -- "Semua posisi" and "Semua kecuali GK" are UI buttons that fill this in, so the database only ever needs to reason about sets.';

-- The order auto-fill reads: earliest created_at first, scoped to one session.
create index waitlist_session_created_idx on public.waitlist (session_id, created_at);

-- Realtime pushes queue changes to every open session page, mirroring slots.
alter publication supabase_realtime add table public.waitlist;

-- Unlike slots (rows are only ever inserted once, then updated -- never
-- deleted), waitlist rows are deleted both by leave_waitlist and by
-- auto-fill, and the page needs to see the queue shrink live. Under the
-- default replica identity (primary key only), a DELETE's old-row image
-- carries just `id` -- not `session_id` -- so Realtime cannot evaluate this
-- table's `session_id=eq.<id>` channel filter against it and silently drops
-- the event. REPLICA IDENTITY FULL includes every column in that old-row
-- image, which is what lets the filter (and therefore the delivery) work.
alter table public.waitlist replica identity full;

---------------------------------------------------------------------------
-- RLS + grants
---------------------------------------------------------------------------
alter table public.waitlist enable row level security;

-- The queue is public, like the booking list itself.
create policy waitlist_read on public.waitlist
  for select to anon, authenticated using (true);

-- Same discipline as sessions_write/slots_write post-0006_admins.sql:
-- membership in public.admins, not merely being authenticated, is what
-- authorises a direct write. No admin-facing waitlist capability exists yet,
-- but the policy is in place now so one is never accidentally open to every
-- signed-in account the moment it is added.
create policy waitlist_write on public.waitlist
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Revoke-all-then-regrant (see 0002_rls.sql's comment): Supabase's default
-- ACL hands anon/authenticated more than SELECT on every new table, and RLS
-- has no TRUNCATE policy form to close that gap.
revoke all on public.waitlist from anon;
revoke all on public.waitlist from authenticated;

-- claim_token deliberately excluded -- see the column comment above and
-- 0002_rls.sql's identical reasoning for slots.
grant select (id, session_id, player_name, positions, created_at)
  on public.waitlist to anon;

grant select, insert, update, delete on public.waitlist to authenticated;

-- service_role: used by test fixtures/seeding, same treatment as sessions
-- and slots in 0005_service_role_grants.sql. It holds rolbypassrls, so RLS
-- above never applies to it -- these table grants are what it actually needs.
grant select, insert, update, delete on public.waitlist to service_role;

---------------------------------------------------------------------------
-- join_waitlist
--
-- Claims a matching free slot immediately, earliest in pitch order, rather
-- than queueing behind an empty slot -- queueing is only ever for a position
-- that is genuinely unavailable right now. "Pitch order" here is team A/B/C
-- then the eleven positions in their canonical order (the same order
-- POSITIONS lists in src/lib/positions.ts and PITCH_ROWS renders), matching
-- how the WhatsApp message and the booking list already read.
--
-- `for update skip locked` (rather than a plain lock) is what lets two
-- concurrent calls each walk past a slot the other has already grabbed
-- instead of blocking on it: if it is the only matching free slot, the
-- loser simply finds none and queues, which is the correct outcome, not a
-- retry-worthy failure.
---------------------------------------------------------------------------
create or replace function public.join_waitlist(
  p_session_id uuid,
  p_name       text,
  p_positions  text[],
  p_token      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name        text := btrim(coalesce(p_name, ''));
  v_status      text;
  v_slot        public.slots;
  v_waitlist_id uuid;
begin
  -- See my_slot_ids in 0003_rpcs.sql for why this must never be servable
  -- over GET: p_token would land in the URL, and therefore in access logs.
  if current_setting('transaction_read_only')::boolean then
    raise exception 'read_only_not_allowed' using errcode = '25006';
  end if;

  if v_name = '' or char_length(v_name) > 40 then
    raise exception 'invalid_name';
  end if;
  if p_token is null then
    raise exception 'invalid_token';
  end if;
  if p_positions is null or array_length(p_positions, 1) is null
     or not (p_positions <@ array['GK','LB','CB1','CB2','RB','DM','MC','AM','LWF','RWF','ST']) then
    raise exception 'invalid_positions';
  end if;

  select status into v_status from public.sessions where id = p_session_id;
  if v_status is distinct from 'open' then
    raise exception 'session_closed';
  end if;

  -- A player is either in a slot or on the waitlist, never both (see the
  -- design doc's Decisions). The other direction of this invariant --
  -- being auto-placed removes the waitlist row -- is enforced by the
  -- fill_from_waitlist trigger below.
  if exists (
    select 1 from public.slots
     where session_id = p_session_id and claim_token = p_token
  ) then
    raise exception 'already_in_slot';
  end if;

  if exists (
    select 1 from public.waitlist
     where session_id = p_session_id and claim_token = p_token
  ) then
    raise exception 'already_waitlisted';
  end if;

  select * into v_slot
    from public.slots
   where session_id = p_session_id
     and player_name is null
     and position = any(p_positions)
   order by team, array_position(
     array['GK','LB','CB1','CB2','RB','DM','MC','AM','LWF','RWF','ST']::text[], position
   )
   limit 1
     for update skip locked;

  if found then
    update public.slots
       set player_name = v_name, claim_token = p_token, claimed_at = now()
     where id = v_slot.id;

    return jsonb_build_object('placed', true, 'slot_id', v_slot.id);
  end if;

  insert into public.waitlist (session_id, player_name, claim_token, positions)
  values (p_session_id, v_name, p_token, p_positions)
  returning id into v_waitlist_id;

  return jsonb_build_object('placed', false, 'waitlist_id', v_waitlist_id);
end;
$$;

---------------------------------------------------------------------------
-- leave_waitlist
---------------------------------------------------------------------------
create or replace function public.leave_waitlist(p_session_id uuid, p_token uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_setting('transaction_read_only')::boolean then
    raise exception 'read_only_not_allowed' using errcode = '25006';
  end if;

  -- A null p_token simply matches no row (claim_token = null is never true
  -- in SQL), which is exactly the not_waitlisted outcome wanted here -- no
  -- separate invalid_token check needed, unlike join_waitlist where the
  -- token is being stored as new data rather than compared against one.
  delete from public.waitlist
   where session_id = p_session_id and claim_token = p_token;

  if not found then
    raise exception 'not_waitlisted';
  end if;
end;
$$;

---------------------------------------------------------------------------
-- my_waitlist_entry: how a device learns its own queue entry, mirroring
-- my_slot_ids -- ownership is proven by presenting the token, never by
-- reading it back off the row.
---------------------------------------------------------------------------
create or replace function public.my_waitlist_entry(p_session_id uuid, p_token uuid)
returns table(id uuid, positions text[], created_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_setting('transaction_read_only')::boolean then
    raise exception 'read_only_not_allowed' using errcode = '25006';
  end if;

  return query
  select w.id, w.positions, w.created_at
    from public.waitlist w
   where w.session_id = p_session_id
     and p_token is not null
     and w.claim_token = p_token;
end;
$$;

revoke all on function public.join_waitlist(uuid, text, text[], uuid) from public;
revoke all on function public.leave_waitlist(uuid, uuid)              from public;
revoke all on function public.my_waitlist_entry(uuid, uuid)           from public;

grant execute on function public.join_waitlist(uuid, text, text[], uuid) to anon, authenticated;
grant execute on function public.leave_waitlist(uuid, uuid)              to anon, authenticated;
grant execute on function public.my_waitlist_entry(uuid, uuid)           to anon, authenticated;

---------------------------------------------------------------------------
-- fill_from_waitlist: auto-fill trigger.
--
-- The WHEN clause on the trigger itself (not a check inside the function
-- body) is what makes non-recursion structural rather than merely asserted:
-- this function's own write moves player_name from null to non-null, so
-- the very transition the WHEN clause requires (non-null -> null) never
-- holds for it, and the trigger machinery does not even invoke the function
-- a second time -- there is no "second call" to reason about.
--
-- Firing `after update` in the same statement/transaction as the release is
-- what makes this unraceable: the freed slot row is already locked by the
-- UPDATE that fired the trigger (no separate lock is needed here), and the
-- earliest matching waitlist row is locked with `for update skip locked`
-- before being written and deleted -- all before the releasing transaction
-- commits, so there is no window where the slot is visibly empty.
--
-- A trigger (rather than logic inside release_slot alone) is what covers
-- move_slot's vacated source and the organiser's direct admin-clear update
-- too, without either caller having to remember to invoke it.
---------------------------------------------------------------------------
create or replace function public.fill_from_waitlist()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_wait   public.waitlist;
begin
  select status into v_status from public.sessions where id = NEW.session_id;
  if v_status is distinct from 'open' then
    return NEW;
  end if;

  select * into v_wait
    from public.waitlist
   where session_id = NEW.session_id
     and NEW.position = any(positions)
   order by created_at
   limit 1
     for update skip locked;

  if found then
    update public.slots
       set player_name = v_wait.player_name,
           claim_token = v_wait.claim_token,
           claimed_at = now()
     where id = NEW.id;

    delete from public.waitlist where id = v_wait.id;
  end if;

  return NEW;
end;
$$;

create trigger slots_fill_from_waitlist
  after update on public.slots
  for each row
  when (OLD.player_name is not null and NEW.player_name is null)
  execute function public.fill_from_waitlist();

---------------------------------------------------------------------------
-- claim_slot: redefined here (its original definition is in 0003_rpcs.sql;
-- CREATE OR REPLACE preserves the EXECUTE grants already made there, so
-- none are re-issued below) to close a hole in the "never both" invariant.
--
-- join_waitlist refuses to queue a device that already holds a slot, and
-- the auto-fill trigger deletes a placed device's queue row -- but nothing
-- stopped a device that is ALREADY queued from tapping a slot that opens up
-- and claiming it directly, bypassing auto-fill entirely. That device would
-- then hold a slot *and* a queue row, and the next slot to free up could
-- auto-fill them a second time -- exactly the double-occupancy the
-- invariant exists to prevent, and the likely path in practice: a queued
-- player watching the page taps an opening the moment they see it rather
-- than trusting auto-fill to eventually reach them.
--
-- Claiming is a stronger statement of intent than queueing, so a successful
-- claim now quietly removes any queue row for that device in the same
-- session -- no error, no message. It runs after the update, in the same
-- transaction as the claim, so a failed claim (slot_taken, session_closed,
-- ...) leaves the queue row untouched.
--
-- move_slot needs no equivalent change: it requires the caller to already
-- hold the source slot (v_from.player_name is not null, token-checked), and
-- with this fix in place a device holding a slot can no longer have a
-- queue row to begin with (join_waitlist already refused to create one, and
-- claim_slot now removes one on the only other path to holding a slot) --
-- verified empirically in supabase/tests/waitlist_test.sql rather than
-- merely assumed.
---------------------------------------------------------------------------
create or replace function public.claim_slot(p_slot_id uuid, p_name text, p_token uuid)
returns public.slots
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slot   public.slots;
  v_status text;
  v_name   text := btrim(coalesce(p_name, ''));
begin
  if v_name = '' or char_length(v_name) > 40 then
    raise exception 'invalid_name';
  end if;
  if p_token is null then
    raise exception 'invalid_token';
  end if;

  -- The lock is what serialises two simultaneous taps on one slot.
  select * into v_slot from public.slots where id = p_slot_id for update;
  if not found then
    raise exception 'slot_not_found';
  end if;

  select status into v_status from public.sessions where id = v_slot.session_id;
  if v_status is distinct from 'open' then
    raise exception 'session_closed';
  end if;

  if v_slot.player_name is not null then
    raise exception 'slot_taken';
  end if;

  update public.slots
     set player_name = v_name, claim_token = p_token, claimed_at = now()
   where id = p_slot_id
  returning * into v_slot;

  delete from public.waitlist
   where session_id = v_slot.session_id
     and claim_token = p_token;

  return v_slot;
end;
$$;
