-- Payment receipts. Optional: a player ticking paid can attach a screenshot
-- of the transfer, so the organiser can match it in the bank app by the
-- sender's name and the time -- both printed by the bank, not typed.
--
-- Bookings belong to a browser key (claim_token), which the storage service
-- cannot check. So players never write to storage: the `receipt` Edge
-- Function takes the photo with the browser key, asks the database below
-- whether that key owns the slot, stores the file as service_role, and
-- attaches it. Only admins can read or remove receipts -- they carry full
-- names and account numbers.
--
-- Files live in a private bucket, one folder per session and slot:
--   receipts/<session_id>/<slot_id>/<anything>

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy receipts_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and sepak.is_admin());

create policy receipts_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and sepak.is_admin());

---------------------------------------------------------------------------
-- The slot points at its receipt. Readable like the rest of the slot: the
-- path is not the file, and the file is admin-only. The page uses it to say
-- a receipt was sent, and to show admins which ticks came with one.
---------------------------------------------------------------------------
alter table sepak.slots add column receipt_path text;

grant select (receipt_path) on sepak.slots to anon, authenticated;

-- Unticking, or the slot changing hands (which unticks it, 0011_paid.sql),
-- lets go of the receipt. Named to sort after slots_reset_paid, whose reset
-- of `paid` this reads.
create or replace function sepak.reset_receipt_when_unpaid()
returns trigger
language plpgsql
set search_path = sepak, pg_temp
as $$
begin
  if not NEW.paid then
    NEW.receipt_path := null;
  end if;
  return NEW;
end;
$$;

create trigger slots_reset_receipt
  before update on sepak.slots
  for each row
  execute function sepak.reset_receipt_when_unpaid();

---------------------------------------------------------------------------
-- For the Edge Function only (service_role). Before storing anything: does
-- this browser key own the slot? Returns the folder to store under.
---------------------------------------------------------------------------
create or replace function sepak.receipt_folder_for(p_slot_id uuid, p_token uuid)
returns text
language plpgsql
stable
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_slot sepak.slots;
begin
  select * into v_slot from sepak.slots where id = p_slot_id;
  if not found then
    raise exception 'slot_not_found';
  end if;
  if p_token is null or v_slot.claim_token is distinct from p_token then
    raise exception 'wrong_token';
  end if;
  return v_slot.session_id::text || '/' || v_slot.id::text;
end;
$$;

---------------------------------------------------------------------------
-- After storing: tick paid and record the receipt, in one step. Checked
-- again here, under the row lock, so the slot cannot have changed hands
-- between the two calls.
---------------------------------------------------------------------------
create or replace function sepak.attach_receipt(p_slot_id uuid, p_token uuid, p_path text)
returns sepak.slots
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_slot sepak.slots;
begin
  select * into v_slot from sepak.slots where id = p_slot_id for update;
  if not found then
    raise exception 'slot_not_found';
  end if;
  if p_token is null or v_slot.claim_token is distinct from p_token then
    raise exception 'wrong_token';
  end if;
  if p_path is null
     or (storage.foldername(p_path))[1] is distinct from v_slot.session_id::text
     or (storage.foldername(p_path))[2] is distinct from v_slot.id::text then
    raise exception 'invalid_receipt';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'receipts' and name = p_path) then
    raise exception 'invalid_receipt';
  end if;

  update sepak.slots
     set paid = true,
         paid_at = coalesce(paid_at, now()),
         receipt_path = p_path
   where id = p_slot_id
  returning * into v_slot;

  return v_slot;
end;
$$;

revoke all on function sepak.receipt_folder_for(uuid, uuid)     from public, anon, authenticated;
revoke all on function sepak.attach_receipt(uuid, uuid, text)   from public, anon, authenticated;
grant execute on function sepak.receipt_folder_for(uuid, uuid)   to service_role;
grant execute on function sepak.attach_receipt(uuid, uuid, text) to service_role;
