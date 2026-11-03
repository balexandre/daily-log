-- Daily Log database.
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
--
-- Every table has a user_id column and row-level security, so each signed-in
-- person can only ever read and change their own rows. That is what keeps the
-- data private even though the publishable key is visible in the website.

-- The things you track ------------------------------------------------------

create table public.symptoms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  rating text not null default 'scale' check (rating in ('scale', 'yesno')),  -- 1–10, or just "it happened"
  locations text[] not null default '{}',                                       -- e.g. Temples, Forehead
  show_on_today boolean not null default false,                                 -- one-tap button + month grid column
  ask_in_checkin boolean not null default false,                                -- "Any bloating today?" in the evening
  position int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,                                                           -- a column in the month grid
  position int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- What happened ---------------------------------------------------------------

-- One row per thing logged during the day: a symptom, a meal, a coffee…
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('symptom', 'meal', 'coffee', 'water', 'drink', 'stress', 'exercise', 'meds')),
  at timestamptz not null default now(),
  day date not null,                                                            -- the local calendar day, set by the app
  symptom_id uuid references public.symptoms on delete set null,
  severity int check (severity between 1 and 10),
  details jsonb not null default '{}',                                          -- meal name, tags, location, note…
  created_at timestamptz not null default now()
);

create index entries_user_day on public.entries (user_id, day);

-- One row per day: the evening check-in and the "memorable moment" note.
create table public.days (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  note text,
  sleep_hours numeric(4, 2),                                                    -- the night before this day
  sleep_quality text check (sleep_quality in ('poor', 'ok', 'good')),
  water_glasses int check (water_glasses >= 0),
  stress text check (stress in ('low', 'medium', 'high')),
  screen_time text check (screen_time in ('under4', '4to8', 'over8')),
  exercise text check (exercise in ('none', 'walk', 'workout')),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- An × in the month grid: this habit was done on this day.
create table public.habit_marks (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  habit_id uuid not null references public.habits on delete cascade,
  day date not null,
  primary key (habit_id, day)
);

create index habit_marks_user_day on public.habit_marks (user_id, day);

-- Privacy: you only see your own rows -----------------------------------------

alter table public.symptoms enable row level security;
alter table public.habits enable row level security;
alter table public.entries enable row level security;
alter table public.days enable row level security;
alter table public.habit_marks enable row level security;

create policy "Own symptoms" on public.symptoms for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Own habits" on public.habits for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Own entries" on public.entries for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Own days" on public.days for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Own habit marks" on public.habit_marks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.habits h where h.id = habit_id and h.user_id = (select auth.uid()))
  );

grant select, insert, update, delete on public.symptoms, public.habits, public.entries, public.days, public.habit_marks to authenticated;
