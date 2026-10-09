-- Payment receipts. Optional: a player ticking paid can attach a screenshot
-- of the transfer, so the organiser can match it in the bank app by the
-- sender's name and the time, both printed by the bank rather than typed.
--
-- Files live in a private bucket, one folder per session and slot:
--   receipts/<session_id>/<slot_id>/<anything>
-- The slot's owner can put a file in their own slot's folder and read it
-- back; admins can read and remove any. Nobody else sees them -- receipts
-- carry full names and account numbers.
--
-- Depends on 0019_accounts.sql: ownership is the signed-in account, which
-- is the only identity the storage service can check.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

---------------------------------------------------------------------------
-- Whether the caller owns the slot a receipt path points at. The path's
-- first folder must be that slot's session, so a receipt cannot be filed
-- under one session and attached in another.
---------------------------------------------------------------------------
create or replace function sepak.owns_receipt_folder(p_name text)
returns boolean
language sql
stable
security definer
set search_path = sepak, pg_temp
as $$
  select exists (
    select 1
      from sepak.slots s
     where auth.uid() is not null
       and s.claim_token = auth.uid()
       and s.session_id::text = (storage.foldername(p_name))[1]
       and s.id::text        = (storage.foldername(p_name))[2]
  );
$$;

revoke all on function sepak.owns_receipt_folder(text) from public;
grant execute on function sepak.owns_receipt_folder(text) to authenticated;

create policy receipts_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and sepak.owns_receipt_folder(name));

create policy receipts_select_own_or_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (sepak.owns_receipt_folder(name) or sepak.is_admin()));

create policy receipts_delete_own_or_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and (sepak.owns_receipt_folder(name) or sepak.is_admin()));

---------------------------------------------------------------------------
-- The slot points at its receipt. Readable like the rest of the slot: the
-- path is not the file, and the file is behind the policies above. The page
-- uses it to show the admin which ticks came with a receipt.
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
-- attach_receipt: called after the file is uploaded. Ticks paid and records
-- the receipt in one step. The path must be in this slot's own folder and
-- the file must really be there.
---------------------------------------------------------------------------
create or replace function sepak.attach_receipt(p_slot_id uuid, p_path text)
returns sepak.slots
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_me   uuid := sepak.require_caller();
  v_slot sepak.slots;
begin
  select * into v_slot from sepak.slots where id = p_slot_id for update;
  if not found then
    raise exception 'slot_not_found';
  end if;
  if v_slot.claim_token is distinct from v_me then
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

revoke all on function sepak.attach_receipt(uuid, text) from public;
grant execute on function sepak.attach_receipt(uuid, text) to anon, authenticated;
