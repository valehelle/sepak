---------------------------------------------------------------------------
-- One booking per person per session: one per device, and one per phone
-- number.
--
-- claim_slot previously checked only that the target slot was free, so a
-- single device could hold several positions -- one person could take a
-- whole team during the opening rush. join_waitlist has always refused a
-- device that already holds a slot (already_in_slot); this brings the
-- direct claim path in line with it, reusing the same error code so the
-- client's existing copy applies unchanged.
--
-- Enforced here rather than in the client because the client is public:
-- a browser can call claim_slot directly. The rule is scoped to one
-- session -- holding a slot in session 6 must not block session 7 -- and
-- is expressed as a lookup by claim_token, which is the device's identity.
--
-- Deliberately NOT a unique constraint on (session_id, claim_token):
-- released slots keep claim_token null, and a partial unique index would
-- also have to reason about the waitlist's own token column. A check
-- inside the already-locking RPC is simpler and covers every writer that
-- matters, since anon cannot write the table directly (0002_rls.sql).
--
-- The device check alone is easy to walk around -- a second browser, a
-- private window, or clearing site data all mint a fresh token -- so the
-- phone number is checked too, across both the pitch and the queue. A
-- person therefore holds at most one place in a session no matter how many
-- devices they use, and the number is something they cannot trivially
-- invent a second of.
--
-- Duplicate player_name stays allowed: two different players really are
-- sometimes both called Amir. The claim sheet already warns about it.
--
-- Claims made before sepak.contacts existed carry no phone row, so they
-- never block anyone.
---------------------------------------------------------------------------

-- The phone checks below look a number up across a session; this keeps that
-- a probe rather than a scan once a few seasons of sessions have piled up.
create index if not exists contacts_phone_idx on sepak.contacts (phone);

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

  update sepak.slots
     set player_name = v_name, claim_token = p_token, claimed_at = now()
   where id = p_slot_id
  returning * into v_slot;

  insert into sepak.contacts (slot_id, phone) values (p_slot_id, p_phone);

  delete from sepak.waitlist
   where session_id = v_slot.session_id
     and claim_token = p_token;

  return v_slot;
end;
$$;

---------------------------------------------------------------------------
-- join_waitlist: the same one-person rule on the queue side. The device
-- checks (already_in_slot / already_waitlisted) were already here; the
-- phone checks are new, so a second device cannot queue a number that is
-- already booked or already waiting.
---------------------------------------------------------------------------
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
