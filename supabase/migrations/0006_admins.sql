-- The admin allowlist. Being authenticated grants nothing on its own any
-- more (see the sessions_write/slots_write replacement below) -- membership
-- in this table is the entire authorisation story from here on. Signups can
-- therefore be safely opened (supabase/config.toml, [auth] enable_signup)
-- in this same migration: a freshly-registered account still starts with no
-- row here, hence no write access to anything.
create table public.admins (
  email      text primary key,
  role       text not null check (role in ('super', 'admin')),
  added_by   text,
  created_at timestamptz not null default now(),
  constraint admins_email_not_blank check (btrim(email) <> ''),
  -- Comparisons below always go through lower(...) too (email casing varies
  -- at sign-in), but storing it pre-normalised keeps the primary key itself
  -- from splitting one real admin into two rows that differ only by case.
  constraint admins_email_lowercase check (email = lower(email))
);

comment on table public.admins is
  'The allowlist: the only source of write authorisation for sessions/slots.
   A row''s mere existence grants admin; role = ''super'' additionally grants
   admin management.';

---------------------------------------------------------------------------
-- is_admin / is_super_admin
--
-- auth.jwt() ->> 'email' was verified against this stack (queried as
-- `authenticated` with request.jwt.claims set) before relying on it here:
-- it returns the email claim exactly as it was signed, case included --
-- Postgres does not fold it -- so every comparison below normalises with
-- lower() against the already-lowercased `admins.email`.
---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admins
     where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admins
     where email = lower(coalesce(auth.jwt() ->> 'email', ''))
       and role = 'super'
  );
$$;

revoke all on function public.is_admin()       from public;
revoke all on function public.is_super_admin() from public;
-- Needed by the callers below: RLS policies evaluate under the querying
-- role's own privileges even though these functions run SECURITY DEFINER,
-- so `authenticated` needs EXECUTE to use them inside a USING/WITH CHECK.
grant execute on function public.is_admin()       to authenticated;
grant execute on function public.is_super_admin() to authenticated;

---------------------------------------------------------------------------
-- sessions_write / slots_write: replace "is authenticated" with
-- "is on the allowlist". sessions_read/slots_read are untouched -- players
-- still read without logging in.
---------------------------------------------------------------------------
drop policy sessions_write on public.sessions;
drop policy slots_write    on public.slots;

create policy sessions_write on public.sessions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy slots_write on public.slots
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

---------------------------------------------------------------------------
-- RLS on admins itself.
-- Any admin may read the list (the admin screen needs to show it); only a
-- super admin may add, edit or remove rows -- a plain admin cannot promote
-- itself or anyone else.
---------------------------------------------------------------------------
alter table public.admins enable row level security;

create policy admins_select on public.admins
  for select to authenticated using (public.is_admin());

create policy admins_insert on public.admins
  for insert to authenticated with check (public.is_super_admin());

create policy admins_update on public.admins
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

create policy admins_delete on public.admins
  for delete to authenticated using (public.is_super_admin());

-- Same discipline as 0002_rls.sql: revoke-all-then-regrant, because
-- Supabase's default ACL hands anon (and authenticated) more than SELECT --
-- TRUNCATE, TRIGGER, REFERENCES -- on every new table, and RLS has no
-- TRUNCATE policy form to close that gap. admins is a list of the
-- organisers' own email addresses, so anon gets nothing at all here, not
-- even read: no grant is issued to it below.
revoke all on public.admins from anon;
revoke all on public.admins from authenticated;

grant select, insert, update, delete on public.admins to authenticated;
-- service_role: used by test fixtures/seeding, same as sessions/slots in
-- 0005. It holds rolbypassrls, so these table grants are what it actually
-- needs; RLS above never applies to it.
grant select, insert, update, delete on public.admins to service_role;

---------------------------------------------------------------------------
-- Last-super protection: a BEFORE UPDATE OR DELETE FOR EACH ROW trigger.
-- A trigger (rather than a check spread across the delete/update RLS path)
-- is what can see the *other* rows in the same table to count remaining
-- supers, and it fires uniformly for every writer, service_role included --
-- so a super admin can never delete or demote themselves (or be
-- deleted/demoted) once they are the only one left.
---------------------------------------------------------------------------
create or replace function public.prevent_last_super_removal()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_other_supers int;
begin
  if OLD.role <> 'super' then
    -- Removing/demoting a plain admin never threatens the invariant.
    if TG_OP = 'DELETE' then return OLD; end if;
    return NEW;
  end if;

  if TG_OP = 'UPDATE' and NEW.role = 'super' then
    -- Still a super afterwards (e.g. only added_by changed) -- nothing to guard.
    return NEW;
  end if;

  select count(*) into v_other_supers
    from public.admins
   where role = 'super' and email <> OLD.email;

  if v_other_supers = 0 then
    raise exception 'last_super_admin';
  end if;

  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

create trigger admins_protect_last_super
  before update or delete on public.admins
  for each row execute function public.prevent_last_super_removal();

---------------------------------------------------------------------------
-- Seed. Idempotent so re-running this migration (or a future `db reset`)
-- never duplicates or errors on an already-seeded allowlist.
---------------------------------------------------------------------------
insert into public.admins (email, role)
values ('hazmiirfan92@gmail.com', 'super')
on conflict (email) do nothing;

-- Keeps the pre-existing local login (used by tests/manual QA) working
-- under the new allowlist model, as a plain admin rather than super.
insert into public.admins (email, role, added_by)
values ('admin@sepak.local', 'admin', 'hazmiirfan92@gmail.com')
on conflict (email) do nothing;
