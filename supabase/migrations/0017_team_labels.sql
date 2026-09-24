-- Teams are named, not lettered, wherever people read them: "Team Merah A"
-- rather than "Team A Merah". On a four-team night two teams share each bib,
-- and the letter says nothing about which one you are in.
--
-- No row is touched. Existing sessions keep their names; only the defaults
-- for new ones and the wording of the promotion message change.

alter table sepak.sessions alter column team_a_name set default 'Merah A';
alter table sepak.sessions alter column team_b_name set default 'Merah B';
alter table sepak.sessions alter column team_c_name set default 'Kuning A';
alter table sepak.sessions alter column team_d_name set default 'Kuning B';

create or replace function sepak.create_session(
  p_session_no    int,
  p_title         text,
  p_play_date     date,
  p_start_time    time,
  p_duration_mins int,
  p_venue         text,
  p_fee_myr       numeric,
  p_team_a_name   text,
  p_team_b_name   text,
  p_team_c_name   text,
  p_team_d_name   text    default null,
  p_fee_gk_myr    numeric default null
)
returns sepak.sessions
language plpgsql
set search_path = sepak, pg_temp
as $$
declare
  v_session sepak.sessions;
begin
  insert into sepak.sessions (
    session_no, title, play_date, start_time, duration_mins,
    venue, fee_myr, fee_gk_myr, team_a_name, team_b_name, team_c_name, team_d_name
  ) values (
    p_session_no, btrim(p_title), p_play_date, p_start_time, coalesce(p_duration_mins, 120),
    btrim(p_venue), p_fee_myr, p_fee_gk_myr,
    coalesce(nullif(btrim(p_team_a_name), ''), 'Merah A'),
    coalesce(nullif(btrim(p_team_b_name), ''), 'Merah B'),
    coalesce(nullif(btrim(p_team_c_name), ''), 'Kuning A'),
    coalesce(nullif(btrim(p_team_d_name), ''), 'Kuning B')
  )
  returning * into v_session;

  -- All 44 slots in the same transaction: a session is never half-built.
  insert into sepak.slots (session_id, team, position)
  select v_session.id, t.team, p.position
    from (values ('A'), ('B'), ('C'), ('D')) as t(team)
   cross join (values ('GK'),('LB'),('CB1'),('CB2'),('RB'),('DM'),
                     ('MC'),('AM'),('LWF'),('RWF'),('ST')) as p(position);

  return v_session;
end;
$$;

---------------------------------------------------------------------------
-- The promotion message, by team name. Otherwise as in 0016_four_teams.sql.
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
      'Team',
      case sl.team
        when 'A' then se.team_a_name
        when 'B' then se.team_b_name
        when 'C' then se.team_c_name
        else se.team_d_name
      end,
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
