-- One-off, session 007 only: add Team D and move the queue into it.
--
-- Run once, in the Supabase SQL editor, AFTER 0016_four_teams.sql is applied
-- and the frontend that knows about Team D is live.
--
-- Every write is inside the one DO block, so it is all or nothing: any
-- failed check below raises, and nothing at all is saved. The statements
-- before it only set up temporary scratch space.
--
-- What it does NOT touch: the 33 existing slots (names, device tokens,
-- claim times, paid ticks) and their phone numbers. That is checked, not
-- assumed -- both are fingerprinted at the start and compared at the end.
--
-- Nobody is sent a promotion notification. Those go out only for activity
-- lines of kind 'autofill', which the queue trigger writes. The moves here
-- are logged as ordinary claims instead.

-- Scratch space for the seat matching below. Temporary: gone when the SQL
-- editor's connection closes, and never visible to anyone else.
create temp table if not exists q_people (idx int primary key, waitlist_id uuid not null, positions text[] not null);
create temp table if not exists q_open   (position text primary key);
create temp table if not exists q_match  (position text primary key, idx int not null);
create temp table if not exists q_seen   (position text primary key);

-- Seats person p_idx, moving people already seated to another of their own
-- positions if that frees one up (an augmenting path). Returns false when
-- no arrangement of the people already in has room for them.
create or replace function pg_temp.seat(p_idx int) returns boolean
language plpgsql as $f$
declare
  v_pos   text;
  v_owner int;
begin
  for v_pos in
    select unnest(positions) from pg_temp.q_people where idx = p_idx
  loop
    continue when not exists (select 1 from pg_temp.q_open where position = v_pos);
    continue when exists (select 1 from pg_temp.q_seen where position = v_pos);
    insert into pg_temp.q_seen (position) values (v_pos);

    v_owner := null;
    select idx into v_owner from pg_temp.q_match where position = v_pos;
    if v_owner is null or pg_temp.seat(v_owner) then
      insert into pg_temp.q_match (position, idx) values (v_pos, p_idx)
        on conflict (position) do update set idx = excluded.idx;
      return true;
    end if;
  end loop;
  return false;
end;
$f$;

do $$
declare
  v_session      sepak.sessions;
  v_count        int;
  v_slots_before text;
  v_slots_after  text;
  v_phones_before text;
  v_phones_after  text;
  v_contacts_before int;
  v_queue_before int;
  v_queue_after  int;
  v_placed       int := 0;
  v_wait         sepak.waitlist;
  v_slot         sepak.slots;
  v_mark         bigint;
  v_idx          int;
  v_position     text;
begin
  ---------------------------------------------------------------------------
  -- Preconditions. Any surprise stops the whole thing before a single write.
  ---------------------------------------------------------------------------
  select count(*) into v_count from sepak.sessions where session_no = 7;
  if v_count <> 1 then
    raise exception 'expected exactly one session 007, found %', v_count;
  end if;
  select * into v_session from sepak.sessions where session_no = 7 for update;

  if v_session.status <> 'open' then
    raise exception 'session 007 is %, expected open', v_session.status;
  end if;

  select count(*) into v_count from sepak.slots where session_id = v_session.id and team = 'D';
  if v_count <> 0 then
    raise exception 'session 007 already has % Team D slots -- this script has run before', v_count;
  end if;

  select count(*) into v_count from sepak.slots where session_id = v_session.id;
  if v_count <> 33 then
    raise exception 'session 007 has % slots, expected 33', v_count;
  end if;

  -- Lock the existing slots and the queue so nobody books or joins mid-run.
  -- It holds for a fraction of a second.
  perform 1 from sepak.slots    where session_id = v_session.id for update;
  perform 1 from sepak.waitlist where session_id = v_session.id for update;

  ---------------------------------------------------------------------------
  -- Fingerprints of everything that must not change.
  ---------------------------------------------------------------------------
  select md5(coalesce(string_agg(
           concat_ws('|', id, team, position, player_name, claim_token, claimed_at, paid, paid_at),
           ',' order by id), ''))
    into v_slots_before
    from sepak.slots where session_id = v_session.id;

  select md5(coalesce(string_agg(concat_ws('|', c.slot_id, c.phone), ',' order by c.slot_id), ''))
    into v_phones_before
    from sepak.contacts c join sepak.slots s on s.id = c.slot_id
   where s.session_id = v_session.id;

  select count(*) into v_contacts_before from sepak.contacts;
  select count(*) into v_queue_before from sepak.waitlist where session_id = v_session.id;
  -- Every activity line this run writes has an id above this.
  select coalesce(max(id), 0) into v_mark from sepak.activity;

  ---------------------------------------------------------------------------
  -- Team names: A and B in red, C and D in yellow.
  ---------------------------------------------------------------------------
  update sepak.sessions
     set team_a_name = 'Merah', team_b_name = 'Merah', team_c_name = 'Kuning', team_d_name = 'Kuning'
   where id = v_session.id;

  ---------------------------------------------------------------------------
  -- Team D: eleven empty slots.
  ---------------------------------------------------------------------------
  insert into sepak.slots (session_id, team, position)
  select v_session.id, 'D', p.position
    from (values ('GK'),('LB'),('CB1'),('CB2'),('RB'),('DM'),
                 ('MC'),('AM'),('LWF'),('RWF'),('ST')) as p(position);

  ---------------------------------------------------------------------------
  -- Who goes where. Queue order decides who gets in; positions are then
  -- shuffled among those already in whenever that makes room for the next
  -- person in line. Slot-by-slot filling would let a flexible early player
  -- take the one position a later player can play, and push that later
  -- player out in favour of someone further back.
  --
  -- The first person the matching cannot fit is skipped, not the end of
  -- the run: someone further back may want a position still open.
  ---------------------------------------------------------------------------
  truncate pg_temp.q_people, pg_temp.q_open, pg_temp.q_match;

  insert into pg_temp.q_people (idx, waitlist_id, positions)
  select row_number() over (order by created_at, id), id, positions
    from sepak.waitlist where session_id = v_session.id;

  insert into pg_temp.q_open (position)
  select position from sepak.slots
   where session_id = v_session.id and team = 'D' and player_name is null;

  for v_idx in select idx from pg_temp.q_people order by idx loop
    truncate pg_temp.q_seen;
    perform pg_temp.seat(v_idx);
  end loop;

  -- The moves themselves, in queue order.
  for v_idx, v_position in
    select m.idx, m.position from pg_temp.q_match m order by m.idx
  loop
    select w.* into v_wait
      from sepak.waitlist w join pg_temp.q_people p on p.waitlist_id = w.id
     where p.idx = v_idx;
    select * into v_slot
      from sepak.slots
     where session_id = v_session.id and team = 'D' and position = v_position;

    if v_slot.player_name is not null or not (v_position = any(v_wait.positions)) then
      raise exception 'matching produced a bad seat for % -- nothing saved', v_wait.player_name;
    end if;

    -- Phone first: the activity trigger on slots reads it off this row.
    update sepak.contacts set slot_id = v_slot.id, waitlist_id = null where waitlist_id = v_wait.id;

    update sepak.slots
       set player_name = v_wait.player_name, claim_token = v_wait.claim_token, claimed_at = now()
     where id = v_slot.id;

    -- Leaving the queue this way is part of the move, so it is not logged
    -- as the player leaving. Same flag claim_slot uses.
    perform set_config('sepak.actor', 'system', true);
    delete from sepak.waitlist where id = v_wait.id;
    perform set_config('sepak.actor', '', true);

    v_placed := v_placed + 1;
    raise notice 'Team D %: % (queue #%)', v_slot.position, v_wait.player_name, v_idx;
  end loop;

  -- Nobody got in ahead of someone earlier in the queue who could have
  -- been seated: everyone placed is in the queue's first v_placed places,
  -- unless an earlier person could not fit any open position at all.
  select count(*) into v_count
    from pg_temp.q_people p
   where p.idx < (select max(idx) from pg_temp.q_match)
     and not exists (select 1 from pg_temp.q_match m where m.idx = p.idx)
     and exists (select 1 from pg_temp.q_open o where o.position = any(p.positions));
  if v_count <> 0 then
    raise notice '% earlier queued players were skipped because every position they chose went to someone ahead of them', v_count;
  end if;

  ---------------------------------------------------------------------------
  -- Postconditions. Any failure here undoes everything above.
  ---------------------------------------------------------------------------
  select md5(coalesce(string_agg(
           concat_ws('|', id, team, position, player_name, claim_token, claimed_at, paid, paid_at),
           ',' order by id), ''))
    into v_slots_after
    from sepak.slots where session_id = v_session.id and team <> 'D';
  if v_slots_after <> v_slots_before then
    raise exception 'an existing slot changed -- nothing saved';
  end if;

  select md5(coalesce(string_agg(concat_ws('|', c.slot_id, c.phone), ',' order by c.slot_id), ''))
    into v_phones_after
    from sepak.contacts c join sepak.slots s on s.id = c.slot_id
   where s.session_id = v_session.id and s.team <> 'D';
  if v_phones_after <> v_phones_before then
    raise exception 'an existing phone number changed -- nothing saved';
  end if;

  select count(*) into v_count from sepak.contacts;
  if v_count <> v_contacts_before then
    raise exception 'phone count went from % to % -- nothing saved', v_contacts_before, v_count;
  end if;

  select count(*) into v_count from sepak.slots where session_id = v_session.id and team = 'D';
  if v_count <> 11 then
    raise exception 'expected 11 Team D slots, found % -- nothing saved', v_count;
  end if;

  select count(*) into v_queue_after from sepak.waitlist where session_id = v_session.id;
  select count(*) into v_count
    from sepak.slots where session_id = v_session.id and team = 'D' and player_name is not null;
  if v_count <> v_placed or v_queue_before - v_queue_after <> v_placed then
    raise exception 'placed %, filled %, queue shrank by % -- nothing saved',
      v_placed, v_count, v_queue_before - v_queue_after;
  end if;

  -- Every new player brought their phone with them.
  select count(*) into v_count
    from sepak.slots s
   where s.session_id = v_session.id and s.team = 'D' and s.player_name is not null
     and not exists (select 1 from sepak.contacts c where c.slot_id = s.id);
  if v_count <> 0 then
    raise exception '% new Team D players have no phone attached -- nothing saved', v_count;
  end if;

  -- The move must not have queued a single promotion message, and the log
  -- should say exactly one claim per person moved and nothing else.
  select count(*) into v_count from sepak.activity where id > v_mark and kind = 'autofill';
  if v_count <> 0 then
    raise exception '% promotion lines were written -- nothing saved', v_count;
  end if;
  select count(*) into v_count from sepak.activity where id > v_mark;
  if v_count <> v_placed then
    raise exception 'expected % activity lines, found % -- nothing saved', v_placed, v_count;
  end if;

  raise notice 'done: % moved from the queue into Team D, % still queued, % Team D slots open',
    v_placed, v_queue_after, 11 - v_placed;
end $$;
