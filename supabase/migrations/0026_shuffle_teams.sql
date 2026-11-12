---------------------------------------------------------------------------
-- An admin shuffles which team each group of players is.
--
-- Every player in a team moves together, keeping their position, paid tick
-- and receipt, to another team: the players who were Team Kuning A can
-- become Team Merah B. The team names stay where they are; only who is in
-- them changes. The order is random, and no team keeps its own players, so
-- a shuffle always changes something.
--
-- It moves the slot rows rather than renaming teams, so every open page
-- sees it through the slots Realtime feed (0001) and nothing else that
-- points at a slot (contacts, move requests, receipts) has to follow.
---------------------------------------------------------------------------

-- Rows swap team in one UPDATE, which passes through states where two rows
-- share a team and position. Checked at the end of the statement instead.
alter table sepak.slots drop constraint slots_unique_position;
alter table sepak.slots add constraint slots_unique_position
  unique (session_id, team, position) deferrable initially immediate;

create or replace function sepak.admin_shuffle_teams(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = sepak, pg_temp
as $$
declare
  v_status text;
  v_teams  text[];
  v_to     text[];
begin
  if not sepak.is_admin() then
    raise exception 'not_admin';
  end if;

  select status into v_status from sepak.sessions where id = p_session_id for update;
  if not found then
    raise exception 'session_not_found';
  end if;
  if v_status <> 'open' then
    raise exception 'session_closed';
  end if;

  select array_agg(distinct team order by team) into v_teams
    from sepak.slots where session_id = p_session_id;

  -- Draw until no team maps to itself. With three or four teams about a
  -- third of draws qualify, so this ends almost at once.
  loop
    select array_agg(t order by random()) into v_to from unnest(v_teams) t;
    exit when not exists (
      select 1 from generate_subscripts(v_teams, 1) i where v_teams[i] = v_to[i]);
  end loop;

  set constraints sepak.slots_unique_position deferred;
  update sepak.slots s
     set team = v_to[array_position(v_teams, s.team)]
   where s.session_id = p_session_id;
  set constraints sepak.slots_unique_position immediate;
end;
$$;

revoke all on function sepak.admin_shuffle_teams(uuid) from public, anon;
grant execute on function sepak.admin_shuffle_teams(uuid) to authenticated;
