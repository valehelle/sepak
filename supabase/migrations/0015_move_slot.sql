---------------------------------------------------------------------------
-- move_slot, again.
--
-- 0008_drop_move_slot.sql removed it on the theory that release-then-claim
-- covered the same ground. 0010_one_booking_per_person.sql then made that
-- false: a device holding a slot cannot claim another one (already_in_slot),
-- so a player who wants a different position has to release first and hope
-- nobody -- including the waitlist -- takes the new position in the gap. One
-- transaction is the only way to offer the change at all.
--
-- Three triggers exist now that did not in 0008, and each destroys something
-- this needs:
--
--   slots_activity      (BEFORE, sorts first) stamps the phone onto the log
--                       line by reading sepak.contacts for the slot.
--   slots_drop_contact  (BEFORE) deletes that contacts row when a slot
--                       empties -- the mover's number.
--   slots_reset_paid    (BEFORE) clears the tick whenever the occupant
--                       changes, which is right for a vacate and wrong for
--                       a move: the same person is still there.
--
-- Hence the ordering below, which is load-bearing:
--
--   1. read the phone, the tick and its timestamp while they still exist
--   2. empty the source  -> release line keeps its phone (slots_activity
--      runs before slots_drop_contact), then the contact is dropped, then
--      slots_fill_from_waitlist may install a queued player here
--   3. re-attach the phone to the destination, BEFORE filling it, so the
--      claim line can find it
--   4. fill the destination
--   5. restore the tick, if there was one. player_name does not change in
--      that statement, so slots_reset_paid leaves it alone; slots_activity
--      logs a `paid` line, which is honest -- they did pay.
--
-- The source emptying in step 2 is deliberately not special-cased. Somebody
-- queued for the position being left takes it immediately, in this same
-- transaction, which is what stops a move being a way to hold two places or
-- to jump the queue. It does mean a move cannot be undone.
--
-- The feed shows a move as `release` + `claim`, two adjacent lines. That
-- pair names both positions, which one `move` line could not: sepak.activity
-- has a single team/position pair per row.
---------------------------------------------------------------------------
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

revoke all on function sepak.move_slot(uuid, uuid, uuid) from public;
grant execute on function sepak.move_slot(uuid, uuid, uuid) to anon, authenticated;

---------------------------------------------------------------------------
-- Wording only: the promotion message's first line. Both channels read
-- promotion_text (0014_telegram.sql), so this changes the Telegram message
-- and the browser notification together.
---------------------------------------------------------------------------
create or replace function sepak.promotion_text(p_activity_id bigint)
returns table (title text, body text, url text)
language sql
stable
security definer
set search_path = sepak, pg_temp
as $$
  select
    'Anda berjaya masuk!'::text,
    format('%s %s — %s · Sesi %s, %s %s',
      'Team ' || sl.team,
      case sl.team when 'A' then se.team_a_name when 'B' then se.team_b_name else se.team_c_name end,
      sepak.position_label(sl.position),
      lpad(se.session_no::text, 3, '0'),
      sepak.play_date_text(se.play_date),
      to_char(se.start_time, 'FMHH12:MI AM')),
    'https://valehelle.github.io/sepak/s/' || se.id::text
    from sepak.activity a
    join sepak.slots sl    on sl.id = a.slot_id
    join sepak.sessions se on se.id = a.session_id
   where a.id = p_activity_id
     and a.kind = 'autofill';
$$;
