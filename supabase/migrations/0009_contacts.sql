---------------------------------------------------------------------------
-- contacts: a phone number per claimed slot or waitlist entry, readable by
-- admins only.
--
-- A separate table rather than a column on slots/waitlist, on purpose.
-- Those two tables are what every visitor's browser subscribes to over
-- Realtime, and `authenticated` holds a full-column select on both (an
-- admin needs it), which a signed-in account that is NOT on the allowlist
-- also holds. A phone column there would ride along in that account's
-- Realtime payload. This table has no grant to anon or authenticated at
-- all, is not in the publication, and is only ever read through
-- contact_phone(), which checks sepak.is_admin() itself.
--
-- Exactly one parent per row: a number belongs to a claim or to a queue
-- entry. Auto-fill moves the row from one parent to the other rather than
-- copying it, so a number never exists twice.
---------------------------------------------------------------------------
create table sepak.contacts (
  id          uuid primary key default gen_random_uuid(),
  slot_id     uuid unique references sepak.slots (id) on delete cascade,
  waitlist_id uuid unique references sepak.waitlist (id) on delete cascade,
  phone       text not null,
  created_at  timestamptz not null default now(),
  constraint contacts_one_parent check ((slot_id is null) <> (waitlist_id is null)),
  -- Stored normalised: Malaysian mobile in international digits without the
  -- plus, so "012-345 6789" and "+60 12 345 6789" are the same row. Mobile
  -- only (601…): the point is WhatsApp and calls, not a landline.
  constraint contacts_phone_format check (phone ~ '^601[0-9]{8,9}$')
);

comment on table sepak.contacts is
  'Phone per claim/queue entry. Admin-only via contact_phone(); no direct grants.';

alter table sepak.contacts enable row level security;
-- No policies for anon/authenticated: with RLS on and no policy, nothing is
-- visible even if a grant slipped in later. Belt and braces with the
-- revokes below.
revoke all on sepak.contacts from anon;
revoke all on sepak.contacts from authenticated;
grant select, insert, update, delete on sepak.contacts to service_role;

---------------------------------------------------------------------------
-- Vacating a slot drops its contact, whoever vacates it: release_slot, the
-- organiser's direct update, anything. BEFORE so it runs ahead of the AFTER
-- trigger slots_fill_from_waitlist, which may immediately install the next
-- occupant's contact on the same slot_id.
---------------------------------------------------------------------------
create or replace function sepak.drop_slot_contact()
returns trigger
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
begin
  delete from sepak.contacts where slot_id = OLD.id;
  return NEW;
end;
$$;

create trigger slots_drop_contact
  before update on sepak.slots
  for each row
  when (OLD.player_name is not null and NEW.player_name is null)
  execute function sepak.drop_slot_contact();

---------------------------------------------------------------------------
-- fill_from_waitlist: redefined (same trigger, same WHEN clause -- see
-- 0007_waitlist.sql) to move the queue entry's contact onto the slot before
-- the entry is deleted, since that delete would otherwise cascade it away.
---------------------------------------------------------------------------
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
    update sepak.slots
       set player_name = v_wait.player_name,
           claim_token = v_wait.claim_token,
           claimed_at = now()
     where id = NEW.id;

    update sepak.contacts
       set slot_id = NEW.id, waitlist_id = null
     where waitlist_id = v_wait.id;

    delete from sepak.waitlist where id = v_wait.id;
  end if;

  return NEW;
end;
$$;

---------------------------------------------------------------------------
-- claim_slot / join_waitlist now take the phone. The old signatures are
-- dropped rather than kept as overloads: PostgREST resolves an RPC by name
-- plus the argument names it is given, and two candidates that both match
-- a JSON body's keys is a 300 Multiple Choices, not a call.
---------------------------------------------------------------------------
drop function if exists sepak.claim_slot(uuid, text, uuid);
drop function if exists sepak.join_waitlist(uuid, text, text[], uuid);

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

  update sepak.slots
     set player_name = v_name, claim_token = p_token, claimed_at = now()
   where id = p_slot_id
  returning * into v_slot;

  insert into sepak.contacts (slot_id, phone) values (p_slot_id, p_phone);

  -- Cascade takes the queue entry's contact with it.
  delete from sepak.waitlist
   where session_id = v_slot.session_id
     and claim_token = p_token;

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
    update sepak.slots
       set player_name = v_name, claim_token = p_token, claimed_at = now()
     where id = v_slot.id;

    insert into sepak.contacts (slot_id, phone) values (v_slot.id, p_phone);

    return jsonb_build_object('placed', true, 'slot_id', v_slot.id);
  end if;

  insert into sepak.waitlist (session_id, player_name, claim_token, positions)
  values (p_session_id, v_name, p_token, p_positions)
  returning id into v_waitlist_id;

  insert into sepak.contacts (waitlist_id, phone) values (v_waitlist_id, p_phone);

  return jsonb_build_object('placed', false, 'waitlist_id', v_waitlist_id);
end;
$$;

revoke all on function sepak.claim_slot(uuid, text, text, uuid)            from public;
revoke all on function sepak.join_waitlist(uuid, text, text, text[], uuid) from public;
grant execute on function sepak.claim_slot(uuid, text, text, uuid)            to anon, authenticated;
grant execute on function sepak.join_waitlist(uuid, text, text, text[], uuid) to anon, authenticated;

---------------------------------------------------------------------------
-- contact_phone: the only read path. Admin-gated inside the function, so
-- the EXECUTE grant to `authenticated` (needed for the JWT to reach it)
-- gives a signed-in non-admin nothing but `not_admin`. Not granted to anon
-- at all. Returns null for a claim made before this migration.
---------------------------------------------------------------------------
create or replace function sepak.contact_phone(p_slot_id uuid default null, p_waitlist_id uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_phone text;
begin
  if not sepak.is_admin() then
    raise exception 'not_admin';
  end if;
  if (p_slot_id is null) = (p_waitlist_id is null) then
    raise exception 'invalid_contact_ref';
  end if;

  select phone into v_phone
    from sepak.contacts
   where (p_slot_id is not null and slot_id = p_slot_id)
      or (p_waitlist_id is not null and waitlist_id = p_waitlist_id);

  return v_phone;
end;
$$;

revoke all on function sepak.contact_phone(uuid, uuid) from public;
grant execute on function sepak.contact_phone(uuid, uuid) to authenticated;
