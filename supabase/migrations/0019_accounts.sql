-- Players sign in. A booking belongs to an account, not to a browser.
--
-- Until now a slot belonged to whoever held a random key stored in one
-- browser. Lose the browser storage -- another app's in-app browser, a
-- private tab, Safari's seven-day wipe -- and the slot could no longer be
-- ticked, moved or released by its owner.
--
-- The booking rules do not change. Every function that took the browser's
-- key (p_token) is kept exactly as it was, and stops being callable from
-- outside. In its place is a public function of the same name without
-- p_token, which passes the signed-in account's id instead. The id is read
-- from the verified sign-in (auth.uid()), never from anything the browser
-- sends, so it cannot be borrowed the way a key could be read.
--
-- claim_token keeps its name and its meaning, "whoever owns this": for a
-- booking made after this migration it is the owner's account id. Old
-- browser keys keep working only through adopt_device below, which moves
-- them onto the account that signs in from that browser.

---------------------------------------------------------------------------
-- Who is calling. Null when signed out.
---------------------------------------------------------------------------
create or replace function sepak.caller_id()
returns uuid
language sql
stable
set search_path = sepak, pg_temp
as $$
  select auth.uid();
$$;

create or replace function sepak.require_caller()
returns uuid
language plpgsql
stable
set search_path = sepak, pg_temp
as $$
declare
  v_id uuid := auth.uid();
begin
  if v_id is null then
    raise exception 'not_signed_in';
  end if;
  return v_id;
end;
$$;

revoke all on function sepak.caller_id()      from public;
revoke all on function sepak.require_caller() from public;

---------------------------------------------------------------------------
-- The token-taking functions become internal. Revoked from every client
-- role; the public versions below call them as their owner.
---------------------------------------------------------------------------
revoke all on function sepak.claim_slot(uuid, text, text, uuid)              from public, anon, authenticated;
revoke all on function sepak.join_waitlist(uuid, text, text, text[], uuid)   from public, anon, authenticated;
revoke all on function sepak.leave_waitlist(uuid, uuid)                      from public, anon, authenticated;
revoke all on function sepak.move_slot(uuid, uuid, uuid)                     from public, anon, authenticated;
revoke all on function sepak.release_slot(uuid, uuid)                        from public, anon, authenticated;
revoke all on function sepak.set_slot_paid(uuid, uuid, boolean)              from public, anon, authenticated;
revoke all on function sepak.my_slot_ids(uuid, uuid)                         from public, anon, authenticated;
revoke all on function sepak.my_waitlist_entry(uuid, uuid)                   from public, anon, authenticated;
revoke all on function sepak.create_telegram_link(uuid)                      from public, anon, authenticated;
revoke all on function sepak.has_telegram_chat(uuid)                         from public, anon, authenticated;
revoke all on function sepak.save_push_subscription(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function sepak.delete_push_subscription(uuid, text)            from public, anon, authenticated;
revoke all on function sepak.has_push_subscription(uuid)                     from public, anon, authenticated;

---------------------------------------------------------------------------
-- The public versions. Same names, minus p_token. Granted to anon too, so a
-- signed-out call gets the app's own not_signed_in rather than a bare
-- permission error -- the page reads that and offers sign-in.
---------------------------------------------------------------------------
create function sepak.claim_slot(p_slot_id uuid, p_name text, p_phone text)
returns sepak.slots
language sql
security definer
set search_path = sepak, pg_temp
as $$
  select sepak.claim_slot(p_slot_id, p_name, p_phone, sepak.require_caller());
$$;

create function sepak.join_waitlist(p_session_id uuid, p_name text, p_phone text, p_positions text[])
returns jsonb
language sql
security definer
set search_path = sepak, pg_temp
as $$
  select sepak.join_waitlist(p_session_id, p_name, p_phone, p_positions, sepak.require_caller());
$$;

create function sepak.leave_waitlist(p_session_id uuid)
returns void
language sql
security definer
set search_path = sepak, pg_temp
as $$
  select sepak.leave_waitlist(p_session_id, sepak.require_caller());
$$;

create function sepak.move_slot(p_from uuid, p_to uuid)
returns sepak.slots
language sql
security definer
set search_path = sepak, pg_temp
as $$
  select sepak.move_slot(p_from, p_to, sepak.require_caller());
$$;

create function sepak.release_slot(p_slot_id uuid)
returns sepak.slots
language sql
security definer
set search_path = sepak, pg_temp
as $$
  select sepak.release_slot(p_slot_id, sepak.require_caller());
$$;

create function sepak.set_slot_paid(p_slot_id uuid, p_paid boolean)
returns sepak.slots
language sql
security definer
set search_path = sepak, pg_temp
as $$
  select sepak.set_slot_paid(p_slot_id, sepak.require_caller(), p_paid);
$$;

-- The read helpers answer "nothing" to a signed-out caller rather than
-- raising: every visitor's page asks them on load.
create function sepak.my_slot_ids(p_session_id uuid)
returns setof uuid
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
begin
  if sepak.caller_id() is null then
    return;
  end if;
  return query select sepak.my_slot_ids(p_session_id, sepak.caller_id());
end;
$$;

create function sepak.my_waitlist_entry(p_session_id uuid)
returns table(id uuid, positions text[], created_at timestamptz)
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
begin
  if sepak.caller_id() is null then
    return;
  end if;
  return query select * from sepak.my_waitlist_entry(p_session_id, sepak.caller_id());
end;
$$;

create function sepak.create_telegram_link()
returns uuid
language sql
security definer
set search_path = sepak, pg_temp
as $$
  select sepak.create_telegram_link(sepak.require_caller());
$$;

create function sepak.has_telegram_chat()
returns boolean
language sql
stable
security definer
set search_path = sepak, pg_temp
as $$
  select sepak.caller_id() is not null and sepak.has_telegram_chat(sepak.caller_id());
$$;

create function sepak.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language sql
security definer
set search_path = sepak, pg_temp
as $$
  select sepak.save_push_subscription(sepak.require_caller(), p_endpoint, p_p256dh, p_auth, p_user_agent);
$$;

create function sepak.delete_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = sepak, pg_temp
as $$
  select sepak.delete_push_subscription(sepak.require_caller(), p_endpoint);
$$;

create function sepak.has_push_subscription()
returns boolean
language sql
stable
security definer
set search_path = sepak, pg_temp
as $$
  select sepak.caller_id() is not null and sepak.has_push_subscription(sepak.caller_id());
$$;

revoke all on function sepak.claim_slot(uuid, text, text)                 from public;
revoke all on function sepak.join_waitlist(uuid, text, text, text[])      from public;
revoke all on function sepak.leave_waitlist(uuid)                         from public;
revoke all on function sepak.move_slot(uuid, uuid)                        from public;
revoke all on function sepak.release_slot(uuid)                           from public;
revoke all on function sepak.set_slot_paid(uuid, boolean)                 from public;
revoke all on function sepak.my_slot_ids(uuid)                            from public;
revoke all on function sepak.my_waitlist_entry(uuid)                      from public;
revoke all on function sepak.create_telegram_link()                       from public;
revoke all on function sepak.has_telegram_chat()                          from public;
revoke all on function sepak.save_push_subscription(text, text, text, text) from public;
revoke all on function sepak.delete_push_subscription(text)               from public;
revoke all on function sepak.has_push_subscription()                      from public;

grant execute on function sepak.claim_slot(uuid, text, text)                 to anon, authenticated;
grant execute on function sepak.join_waitlist(uuid, text, text, text[])      to anon, authenticated;
grant execute on function sepak.leave_waitlist(uuid)                         to anon, authenticated;
grant execute on function sepak.move_slot(uuid, uuid)                        to anon, authenticated;
grant execute on function sepak.release_slot(uuid)                           to anon, authenticated;
grant execute on function sepak.set_slot_paid(uuid, boolean)                 to anon, authenticated;
grant execute on function sepak.my_slot_ids(uuid)                            to anon, authenticated;
grant execute on function sepak.my_waitlist_entry(uuid)                      to anon, authenticated;
grant execute on function sepak.create_telegram_link()                       to anon, authenticated;
grant execute on function sepak.has_telegram_chat()                          to anon, authenticated;
grant execute on function sepak.save_push_subscription(text, text, text, text) to anon, authenticated;
grant execute on function sepak.delete_push_subscription(text)               to anon, authenticated;
grant execute on function sepak.has_push_subscription()                      to anon, authenticated;

---------------------------------------------------------------------------
-- adopt_device: the bookings a browser made before sign-in existed move to
-- the account that signs in from that browser. The browser presents its own
-- key, which only it holds (0018_hide_tokens_from_accounts.sql stopped
-- accounts reading keys off the tables).
--
-- One booking per session still holds: a session where the account already
-- has a slot or a queue place keeps the browser's booking where it was,
-- for an admin to sort out, rather than giving one account two places.
-- Returns how many bookings moved.
---------------------------------------------------------------------------
create function sepak.adopt_device(p_device_token uuid)
returns int
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_me    uuid := sepak.require_caller();
  v_moved int := 0;
  v_count int;
begin
  if p_device_token is null or p_device_token = v_me then
    return 0;
  end if;

  update sepak.slots s
     set claim_token = v_me
   where s.claim_token = p_device_token
     and not exists (select 1 from sepak.slots o    where o.session_id = s.session_id and o.claim_token = v_me)
     and not exists (select 1 from sepak.waitlist w where w.session_id = s.session_id and w.claim_token = v_me);
  get diagnostics v_count = row_count;
  v_moved := v_moved + v_count;

  update sepak.waitlist w
     set claim_token = v_me
   where w.claim_token = p_device_token
     and not exists (select 1 from sepak.slots o     where o.session_id = w.session_id and o.claim_token = v_me)
     and not exists (select 1 from sepak.waitlist o2 where o2.session_id = w.session_id and o2.claim_token = v_me);
  get diagnostics v_count = row_count;
  v_moved := v_moved + v_count;

  -- Alerts follow the person. Nothing to collide with: these are many-to-one.
  update sepak.push_subscriptions set claim_token = v_me where claim_token = p_device_token;
  update sepak.telegram_chats     set claim_token = v_me where claim_token = p_device_token;
  delete from sepak.telegram_links where claim_token = p_device_token;

  return v_moved;
end;
$$;

revoke all on function sepak.adopt_device(uuid) from public;
grant execute on function sepak.adopt_device(uuid) to authenticated;

---------------------------------------------------------------------------
-- admin_claim_slot: an admin books someone who cannot sign in. The slot is
-- owned by a fresh random id that no account has, so only admins manage it
-- (they can already tick and clear any slot). Every booking rule applies --
-- phone, one place per number, closed session -- since it is the same
-- function underneath.
---------------------------------------------------------------------------
create function sepak.admin_claim_slot(p_slot_id uuid, p_name text, p_phone text)
returns sepak.slots
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
begin
  if not sepak.is_admin() then
    raise exception 'not_admin';
  end if;
  return sepak.claim_slot(p_slot_id, p_name, p_phone, gen_random_uuid());
end;
$$;

revoke all on function sepak.admin_claim_slot(uuid, text, text) from public;
grant execute on function sepak.admin_claim_slot(uuid, text, text) to authenticated;

---------------------------------------------------------------------------
-- Profiles: the name and number a player books with, saved once so a
-- booking at the rush is one tap. Each account sees and edits only its own.
-- The number is not unique across accounts on purpose: someone who loses
-- an account can start a new one with their own number. One place per
-- number per session is still enforced on the booking itself.
---------------------------------------------------------------------------
create table sepak.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  name       text not null,
  phone      text not null,
  updated_at timestamptz not null default now(),
  constraint profiles_name_length check (char_length(btrim(name)) between 1 and 40),
  constraint profiles_phone_format check (phone ~ '^601[0-9]{8,9}$')
);

alter table sepak.profiles enable row level security;

create policy profiles_own on sepak.profiles
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on sepak.profiles from anon;
revoke all on sepak.profiles from authenticated;
grant select, insert, update on sepak.profiles to authenticated;
grant select, insert, update, delete on sepak.profiles to service_role;

---------------------------------------------------------------------------
-- Admin rights belong to an account, not to an email address.
--
-- Email confirmation is off, so anyone can register with any address. With
-- admin rights keyed on the address alone, whoever registered an
-- allowlisted address first -- before its owner did -- would be an admin.
-- Each admin row is now bound to one account: the existing ones to the
-- accounts that already hold those addresses, new ones at the moment they
-- are added, which requires the account to exist. A super admin adds
-- someone after that person has signed in once.
---------------------------------------------------------------------------
alter table sepak.admins
  add column user_id uuid unique references auth.users (id) on delete set null;

update sepak.admins a
   set user_id = u.id
  from auth.users u
 where lower(u.email) = a.email;

create or replace function sepak.bind_admin_account()
returns trigger
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
begin
  if TG_OP = 'INSERT' or NEW.email is distinct from OLD.email or NEW.user_id is null then
    select id into NEW.user_id from auth.users where lower(email) = NEW.email;
    if NEW.user_id is null then
      raise exception 'admin_needs_account';
    end if;
  end if;
  return NEW;
end;
$$;

revoke all on function sepak.bind_admin_account() from public;

create trigger admins_bind_account
  before insert or update on sepak.admins
  for each row
  execute function sepak.bind_admin_account();

create or replace function sepak.is_admin()
returns boolean
language sql
stable
security definer
set search_path = sepak, pg_temp
as $$
  select auth.uid() is not null
     and exists (select 1 from sepak.admins where user_id = auth.uid());
$$;

create or replace function sepak.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = sepak, pg_temp
as $$
  select auth.uid() is not null
     and exists (select 1 from sepak.admins where user_id = auth.uid() and role = 'super');
$$;
