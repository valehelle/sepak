-- A fourth team, and a separate goalkeeper fee.
--
-- Additive only: no existing slot, name, phone or tick is touched. Sessions
-- made before this keep their three teams -- the app draws the teams a
-- session actually has slots for, so an old session never grows an empty
-- Team D. New sessions get four.
--
-- Safe to apply before the frontend that knows about Team D ships, with one
-- exception: a session created in that window has Team D slots the old
-- frontend cannot parse. Nobody creates sessions in a ten-minute window.

alter table sepak.slots drop constraint slots_team_check;
alter table sepak.slots add constraint slots_team_check check (team in ('A', 'B', 'C', 'D'));

alter table sepak.activity drop constraint activity_team_check;
alter table sepak.activity add constraint activity_team_check check (team in ('A', 'B', 'C', 'D'));

-- Two bibs, two teams each: A and B in red, C and D in yellow.
alter table sepak.sessions alter column team_b_name set default 'Merah';
alter table sepak.sessions add column team_d_name text not null default 'Kuning';

alter table sepak.sessions
  add column fee_gk_myr numeric(6,2) check (fee_gk_myr is null or fee_gk_myr >= 0);

comment on column sepak.sessions.fee_gk_myr is
  'What a goalkeeper pays. Null means the same as fee_myr; 0 means goalkeepers play free.';

---------------------------------------------------------------------------
-- create_session: two more parameters, both defaulted so a caller that
-- names only the old ten still works. The old signature is dropped rather
-- than overloaded: a ten-argument call would otherwise match both.
---------------------------------------------------------------------------
drop function sepak.create_session(int, text, date, time, int, text, numeric, text, text, text);

create function sepak.create_session(
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
    coalesce(nullif(btrim(p_team_a_name), ''), 'Merah'),
    coalesce(nullif(btrim(p_team_b_name), ''), 'Merah'),
    coalesce(nullif(btrim(p_team_c_name), ''), 'Kuning'),
    coalesce(nullif(btrim(p_team_d_name), ''), 'Kuning')
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

revoke all on function sepak.create_session(int, text, date, time, int, text, numeric, text, text, text, text, numeric) from public;
grant execute on function sepak.create_session(int, text, date, time, int, text, numeric, text, text, text, text, numeric) to authenticated, service_role;

---------------------------------------------------------------------------
-- The promotion message names the team, so it has to know Team D's name.
-- Otherwise identical to 0015_move_slot.sql.
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
