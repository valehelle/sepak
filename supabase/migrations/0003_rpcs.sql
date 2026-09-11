---------------------------------------------------------------------------
-- claim_slot
---------------------------------------------------------------------------
create or replace function sepak.claim_slot(p_slot_id uuid, p_name text, p_token uuid)
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
  if p_token is null then
    raise exception 'invalid_token';
  end if;

  -- The lock is what serialises two simultaneous taps on one slot.
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

  return v_slot;
end;
$$;

---------------------------------------------------------------------------
-- release_slot
---------------------------------------------------------------------------
create or replace function sepak.release_slot(p_slot_id uuid, p_token uuid)
returns sepak.slots
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_slot   sepak.slots;
  v_status text;
begin
  select * into v_slot from sepak.slots where id = p_slot_id for update;
  if not found then
    raise exception 'slot_not_found';
  end if;

  select status into v_status from sepak.sessions where id = v_slot.session_id;
  if v_status is distinct from 'open' then
    raise exception 'session_closed';
  end if;

  if v_slot.player_name is null then
    raise exception 'slot_empty';
  end if;

  -- Holding the token is the whole authorisation story for a player. A null
  -- p_token is safe to compare here only because slots_claim_complete never
  -- allows a named slot to carry a null claim_token -- v_slot.claim_token is
  -- guaranteed non-null once v_slot.player_name is not null (checked above).
  if v_slot.claim_token is distinct from p_token then
    raise exception 'wrong_token';
  end if;

  update sepak.slots
     set player_name = null, claim_token = null, claimed_at = null
   where id = p_slot_id
  returning * into v_slot;

  return v_slot;
end;
$$;

---------------------------------------------------------------------------
-- move_slot
---------------------------------------------------------------------------
create or replace function sepak.move_slot(p_from uuid, p_to uuid, p_token uuid)
returns sepak.slots
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_from   sepak.slots;
  v_to     sepak.slots;
  v_status text;
  v_name   text;
begin
  if p_from = p_to then
    raise exception 'same_slot';
  end if;

  -- Lock both rows in a deterministic order so two opposing moves cannot deadlock.
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

  if v_from.player_name is null then raise exception 'slot_empty'; end if;
  -- Safe against a null p_token only because slots_claim_complete guarantees
  -- v_from.claim_token is non-null whenever v_from.player_name is (checked above).
  if v_from.claim_token is distinct from p_token then raise exception 'wrong_token'; end if;
  if v_to.player_name is not null then raise exception 'slot_taken'; end if;

  v_name := v_from.player_name;

  update sepak.slots
     set player_name = null, claim_token = null, claimed_at = null
   where id = p_from;

  update sepak.slots
     set player_name = v_name, claim_token = p_token, claimed_at = now()
   where id = p_to
  returning * into v_to;

  return v_to;
end;
$$;

---------------------------------------------------------------------------
-- create_session (organiser only; security invoker, so RLS does the gating)
---------------------------------------------------------------------------
create or replace function sepak.create_session(
  p_session_no    int,
  p_title         text,
  p_play_date     date,
  p_start_time    time,
  p_duration_mins int,
  p_venue         text,
  p_fee_myr       numeric,
  p_team_a_name   text,
  p_team_b_name   text,
  p_team_c_name   text
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
    venue, fee_myr, team_a_name, team_b_name, team_c_name
  ) values (
    p_session_no, btrim(p_title), p_play_date, p_start_time, coalesce(p_duration_mins, 120),
    btrim(p_venue), p_fee_myr,
    coalesce(nullif(btrim(p_team_a_name), ''), 'Merah'),
    coalesce(nullif(btrim(p_team_b_name), ''), 'Putih'),
    coalesce(nullif(btrim(p_team_c_name), ''), 'Kuning')
  )
  returning * into v_session;

  -- All 33 slots in the same transaction: a session is never half-built.
  insert into sepak.slots (session_id, team, position)
  select v_session.id, t.team, p.position
    from (values ('A'), ('B'), ('C')) as t(team)
   cross join (values ('GK'),('LB'),('CB1'),('CB2'),('RB'),('DM'),
                     ('MC'),('AM'),('LWF'),('RWF'),('ST')) as p(position);

  return v_session;
end;
$$;

---------------------------------------------------------------------------
-- my_slot_ids: how a device learns which slots are its own now that
-- claim_token is no longer readable off the table. It leaks nothing --
-- ownership must already be demonstrated by presenting the token, and only
-- ids come back, never names or tokens.
--
-- p_token is the entire player authorisation model, so this must never be
-- callable over GET -- that would put it in the URL, and therefore in Kong
-- access logs and browser history. Dropping the `stable` marker alone does
-- NOT achieve this: PostgREST always runs GET/HEAD against a function in a
-- READ ONLY transaction regardless of its declared volatility (this is
-- true for VOLATILE functions too), and only rejects the call if the
-- function actually attempts something that transaction mode forbids. A
-- plain `select` has nothing to forbid, so a merely-non-stable version of
-- this function still returns 200 on GET. The explicit read-only check
-- below is what actually closes it, reusing Postgres's own
-- read_only_sql_transaction SQLSTATE (25006) so PostgREST maps it to the
-- same 405 the other four RPCs already produce under GET.
---------------------------------------------------------------------------
create or replace function sepak.my_slot_ids(p_session_id uuid, p_token uuid)
returns setof uuid
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
begin
  if current_setting('transaction_read_only')::boolean then
    raise exception 'read_only_not_allowed' using errcode = '25006';
  end if;

  return query
  select id from sepak.slots
   where session_id = p_session_id
     and p_token is not null
     and claim_token = p_token;
end;
$$;

---------------------------------------------------------------------------
-- Execute grants. Functions are executable by PUBLIC by default, so each
-- one is revoked first and then granted deliberately.
---------------------------------------------------------------------------
revoke all on function sepak.claim_slot(uuid, text, uuid)   from public;
revoke all on function sepak.release_slot(uuid, uuid)        from public;
revoke all on function sepak.move_slot(uuid, uuid, uuid)     from public;
revoke all on function sepak.create_session(int, text, date, time, int, text, numeric, text, text, text) from public;
revoke all on function sepak.my_slot_ids(uuid, uuid)         from public;

grant execute on function sepak.claim_slot(uuid, text, uuid)  to anon, authenticated;
grant execute on function sepak.release_slot(uuid, uuid)      to anon, authenticated;
grant execute on function sepak.move_slot(uuid, uuid, uuid)   to anon, authenticated;
grant execute on function sepak.create_session(int, text, date, time, int, text, numeric, text, text, text) to authenticated;
grant execute on function sepak.my_slot_ids(uuid, uuid)       to anon, authenticated;
