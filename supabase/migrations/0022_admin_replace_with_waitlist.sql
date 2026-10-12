-- An admin swaps a player for somebody in the queue.
--
-- The usual reason: someone has not paid, or will not come, and the
-- organiser wants a particular queued player in -- not necessarily the first
-- in line, and not necessarily one who chose that position.
--
-- In one transaction:
--   * the player in the slot goes to the FRONT of the queue, for the
--     position they held, keeping their number and their browser's claim on
--     the queue place (so their page shows them queued);
--   * the chosen queued player takes the slot, exactly as an automatic
--     promotion would -- logged as 'autofill', which is what sends them the
--     "Anda berjaya masuk!" message (0013_push.sql, 0014_telegram.sql);
--   * the paid tick and any receipt stay behind with the old occupant's
--     place: the newcomer starts unpaid (0011_paid.sql, 0021_receipts.sql).

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
  -- admin_replace_with_waitlist (below) empties a slot on its way to filling
  -- it with the person the admin chose; the queue must not get there first.
  if coalesce(current_setting('sepak.skip_autofill', true), '') = 'on' then
    return NEW;
  end if;

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

create or replace function sepak.admin_replace_with_waitlist(p_slot_id uuid, p_waitlist_id uuid)
returns sepak.slots
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_slot    sepak.slots;
  v_wait    sepak.waitlist;
  v_status  text;
  v_phone   text;
  v_front   timestamptz;
  v_requeue uuid;
begin
  if not sepak.is_admin() then
    raise exception 'not_admin';
  end if;

  select * into v_slot from sepak.slots where id = p_slot_id for update;
  if not found then
    raise exception 'slot_not_found';
  end if;
  if v_slot.player_name is null then
    raise exception 'slot_empty';
  end if;

  select status into v_status from sepak.sessions where id = v_slot.session_id;
  if v_status is distinct from 'open' then
    raise exception 'session_closed';
  end if;

  select * into v_wait from sepak.waitlist where id = p_waitlist_id for update;
  if not found or v_wait.session_id <> v_slot.session_id then
    raise exception 'not_waitlisted';
  end if;

  -- The outgoing player's number, read before the slot is emptied: emptying
  -- it drops the contacts row (slots_drop_contact, 0009_contacts.sql).
  select phone into v_phone from sepak.contacts where slot_id = p_slot_id;

  -- Ahead of everyone already waiting.
  select least(coalesce(min(created_at), now()), now()) - interval '1 second'
    into v_front
    from sepak.waitlist where session_id = v_slot.session_id;

  perform set_config('sepak.skip_autofill', 'on', true);

  -- Out: logged as the admin emptying the slot.
  update sepak.slots
     set player_name = null, claim_token = null, claimed_at = null
   where id = p_slot_id;

  -- ...and into the front of the queue, for the position they held.
  insert into sepak.waitlist (session_id, player_name, claim_token, positions, created_at)
  values (v_slot.session_id, v_slot.player_name, v_slot.claim_token, array[v_slot.position], v_front)
  returning id into v_requeue;
  if v_phone is not null then
    insert into sepak.contacts (waitlist_id, phone) values (v_requeue, v_phone);
  end if;

  -- In: the number first, which the activity line reads.
  update sepak.contacts set slot_id = p_slot_id, waitlist_id = null where waitlist_id = v_wait.id;

  perform set_config('sepak.actor', 'system', true);
  update sepak.slots
     set player_name = v_wait.player_name, claim_token = v_wait.claim_token, claimed_at = now()
   where id = p_slot_id
  returning * into v_slot;
  delete from sepak.waitlist where id = v_wait.id;
  perform set_config('sepak.actor', '', true);

  perform set_config('sepak.skip_autofill', '', true);
  return v_slot;
end;
$$;

revoke all on function sepak.admin_replace_with_waitlist(uuid, uuid) from public;
grant execute on function sepak.admin_replace_with_waitlist(uuid, uuid) to authenticated;
