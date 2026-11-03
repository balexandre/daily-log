-- Adds your own meal tags (Dairy, Gluten, … plus any you create).
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- Only needed for a database created before this file existed; schema.sql already includes it.

create table public.meal_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  position int not null default 0,
  archived boolean not null default false,                                      -- hidden from the meal panel
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.meal_tags enable row level security;

create policy "Own meal tags" on public.meal_tags for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.meal_tags to authenticated;
