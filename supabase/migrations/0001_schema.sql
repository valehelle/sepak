create table public.sessions (
  id            uuid primary key default gen_random_uuid(),
  session_no    int  not null,
  title         text not null,
  play_date     date not null,
  start_time    time not null,
  duration_mins int  not null default 120 check (duration_mins between 15 and 480),
  venue         text not null,
  fee_myr       numeric(6,2) check (fee_myr is null or fee_myr >= 0),
  team_a_name   text not null default 'Merah',
  team_b_name   text not null default 'Putih',
  team_c_name   text not null default 'Kuning',
  status        text not null default 'open' check (status in ('open', 'closed')),
  created_at    timestamptz not null default now(),
  constraint sessions_title_not_blank check (btrim(title) <> ''),
  constraint sessions_venue_not_blank check (btrim(venue) <> '')
);

comment on column public.sessions.fee_myr is
  'Null or 0 means free; the Yuran line is then omitted from the UI and WhatsApp text.';

create table public.slots (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.sessions (id) on delete cascade,
  team         text not null check (team in ('A', 'B', 'C')),
  position     text not null check (position in
                 ('GK','LB','CB1','CB2','RB','DM','MC','AM','LWF','RWF','ST')),
  player_name  text,
  claim_token  uuid,
  claimed_at   timestamptz,
  constraint slots_unique_position unique (session_id, team, position),
  constraint slots_name_length check (player_name is null or char_length(btrim(player_name)) between 1 and 40),
  -- A slot is either fully empty or fully claimed, never half-claimed.
  constraint slots_claim_complete check (
    (player_name is null and claim_token is null and claimed_at is null) or
    (player_name is not null and claim_token is not null and claimed_at is not null)
  )
);

comment on column public.slots.position is
  'CB1 and CB2 are distinct keys so the unique constraint can hold two centre-backs; both display as CB.';
comment on column public.slots.claim_token is
  'The claiming device''s localStorage UUID. Presenting it is what authorises release or move.';

create index slots_session_idx on public.slots (session_id);
create index sessions_play_date_idx on public.sessions (play_date desc);

-- Realtime pushes slot changes to every open session page.
alter publication supabase_realtime add table public.slots;
