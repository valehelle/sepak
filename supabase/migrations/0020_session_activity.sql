-- One session's history, for the activity section on that session's page.
-- The organiser's feed mixed every session together; this is the same feed
-- (0012_activity.sql, activity_feed), narrowed to one session.
--
-- Additive: activity_feed stays as it is. Admin-only, like it, because the
-- lines carry phone numbers.

create or replace function sepak.session_activity(p_session_id uuid, p_limit int default 200)
returns table (
  id          bigint,
  session_id  uuid,
  session_no  int,
  kind        text,
  actor       text,
  player_name text,
  phone       text,
  team        text,
  "position"  text,
  created_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = sepak, pg_temp
as $$
begin
  if not sepak.is_admin() then
    raise exception 'not_admin';
  end if;

  return query
  select a.id, a.session_id, s.session_no, a.kind, a.actor,
         a.player_name, a.phone, a.team, a.position, a.created_at
    from sepak.activity a
    join sepak.sessions s on s.id = a.session_id
   where a.session_id = p_session_id
   order by a.created_at desc, a.id desc
   limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

revoke all on function sepak.session_activity(uuid, int) from public;
grant execute on function sepak.session_activity(uuid, int) to authenticated;
