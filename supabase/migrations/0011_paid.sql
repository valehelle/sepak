---------------------------------------------------------------------------
-- Payment tick.
--
-- A player who has handed the organiser the fee marks their own slot paid,
-- and the tick shows on the pitch for everyone. There is no admin
-- confirmation step: this is a friendly weekly game, the tick is a
-- self-declaration, and the organiser reconciles it against what actually
-- reached them. It is bookkeeping, not authorisation -- nothing in the app
-- depends on it being true.
--
-- Authorisation reuses the claim token, exactly like release_slot: the
-- device that took the slot is the one that may tick it. An admin may tick
-- or untick any slot, for corrections.
---------------------------------------------------------------------------

alter table sepak.slots
  add column paid    boolean not null default false,
  add column paid_at timestamptz;

comment on column sepak.slots.paid is
  'Player-declared: the fee was handed to the organiser. Never a permission.';

-- An empty slot is never paid, and a paid slot always carries its timestamp.
-- The reset trigger below is what keeps this true through every vacate path.
alter table sepak.slots
  add constraint slots_paid_complete check (
    (paid and player_name is not null and paid_at is not null) or
    (not paid and paid_at is null)
  );

---------------------------------------------------------------------------
-- Whoever occupies a slot next starts unpaid: the tick belongs to the
-- person, not to the position. A trigger (rather than logic in each RPC)
-- covers every writer -- release_slot, the organiser's direct admin-clear
-- update, move_slot's source and destination, and the nested update inside
-- fill_from_waitlist, which fires these BEFORE triggers again.
---------------------------------------------------------------------------
create or replace function sepak.reset_paid_on_occupant_change()
returns trigger
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
begin
  if NEW.player_name is distinct from OLD.player_name then
    NEW.paid := false;
    NEW.paid_at := null;
  end if;
  return NEW;
end;
$$;

create trigger slots_reset_paid
  before update on sepak.slots
  for each row
  execute function sepak.reset_paid_on_occupant_change();

---------------------------------------------------------------------------
-- set_slot_paid
--
-- Deliberately no session_closed check, unlike claim_slot and release_slot:
-- money often changes hands at the pitch, after the organiser has locked
-- the list. Closing a session freezes who plays, not who has settled up.
---------------------------------------------------------------------------
create or replace function sepak.set_slot_paid(p_slot_id uuid, p_token uuid, p_paid boolean)
returns sepak.slots
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_slot sepak.slots;
begin
  if p_paid is null then
    raise exception 'invalid_paid';
  end if;

  select * into v_slot from sepak.slots where id = p_slot_id for update;
  if not found then
    raise exception 'slot_not_found';
  end if;

  if v_slot.player_name is null then
    raise exception 'slot_empty';
  end if;

  -- Same authorisation story as release_slot: holding the token is the
  -- whole of it. Safe against a null p_token because slots_claim_complete
  -- guarantees claim_token is non-null once player_name is (checked above).
  if v_slot.claim_token is distinct from p_token and not sepak.is_admin() then
    raise exception 'wrong_token';
  end if;

  update sepak.slots
     set paid    = p_paid,
         paid_at = case when p_paid then now() else null end
   where id = p_slot_id
  returning * into v_slot;

  return v_slot;
end;
$$;

revoke all on function sepak.set_slot_paid(uuid, uuid, boolean) from public;
grant execute on function sepak.set_slot_paid(uuid, uuid, boolean) to anon, authenticated;

-- The tick is public, like every other name on the list. paid_at stays out
-- of anon's grant: nobody needs the minute, and the column-level grant is
-- also what Realtime honours, so this keeps it off the wire entirely.
grant select (paid) on sepak.slots to anon;
