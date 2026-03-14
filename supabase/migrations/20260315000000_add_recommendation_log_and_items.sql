-- Migration: add recommendation_log and recommendation_items for Book Doctor
-- recommendation_log: one row per recommendation request (metadata).
-- recommendation_items: one row per recommended book, linked by request_id.

-- 1. recommendation_log
create table public.recommendation_log (
  id bigint generated always as identity primary key,
  request_id text not null,
  user_id uuid null,
  latency_ms double precision null,
  created_at timestamptz null default now()
);

create index recommendation_log_user_id_idx on public.recommendation_log (user_id);

comment on table public.recommendation_log is 'One row per recommendation request; links to recommendation_items via request_id.';

alter table public.recommendation_log enable row level security;

-- Users can read their own log rows
create policy "Users can read own recommendation_log"
  on public.recommendation_log
  for select
  using (user_id = auth.uid());

-- Allow anon and authenticated insert (e.g. when creating a new recommendation)
create policy "Allow insert on recommendation_log"
  on public.recommendation_log
  for insert
  with check (true);

-- 2. recommendation_items
create table public.recommendation_items (
  id bigint generated always as identity primary key,
  request_id text not null,
  user_id uuid null,
  book_id text not null,
  rank integer not null,
  created_at timestamptz null default now()
);

create index recommendation_items_request_id_idx on public.recommendation_items (request_id);

comment on table public.recommendation_items is 'One row per recommended book per request; 1-based rank 1–10.';

alter table public.recommendation_items enable row level security;

-- Users can read their own items (same user_id as in log)
create policy "Users can read own recommendation_items"
  on public.recommendation_items
  for select
  using (user_id = auth.uid());

-- Allow anon insert so anonymous requests (no Bearer token) still work
create policy "Allow anon insert on recommendation_items"
  on public.recommendation_items
  for insert
  to anon
  with check (true);

-- Authenticated users can also insert (e.g. when saving recommendations)
create policy "Allow authenticated insert on recommendation_items"
  on public.recommendation_items
  for insert
  to authenticated
  with check (true);
