-- Migration: add recommendation_requests table for webhook-driven recommendation flow.
-- Frontend inserts a row; Supabase Database Webhook fires and POSTs to backend.

create table public.recommendation_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz null default now()
);

create index recommendation_requests_user_id_idx on public.recommendation_requests (user_id);

comment on table public.recommendation_requests is 'One row per "user asked for recommendations"; webhook on INSERT calls backend.';

alter table public.recommendation_requests enable row level security;

-- Authenticated users can insert their own request
create policy "Users can insert own recommendation_requests"
  on public.recommendation_requests
  for insert
  with check (user_id = auth.uid());

-- Optional: allow users to read their own requests (e.g. to confirm or pass request_id)
create policy "Users can read own recommendation_requests"
  on public.recommendation_requests
  for select
  using (user_id = auth.uid());
