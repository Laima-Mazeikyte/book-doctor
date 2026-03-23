-- Feed flow: frontend inserts feed_requests; webhook calls backend; backend writes feed_items and updates status.

create table public.feed_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  status text not null default 'pending',
  error_message text null,
  result_count integer null,
  processed_at timestamptz null,
  created_at timestamptz null default now()
);

create index feed_requests_user_id_idx on public.feed_requests (user_id);

comment on table public.feed_requests is 'One row per feed batch request; webhook on INSERT calls backend; status tracks lifecycle.';

alter table public.feed_requests enable row level security;

create policy "Users can insert own feed_requests"
  on public.feed_requests
  for insert
  with check (user_id = auth.uid());

create policy "Users can read own feed_requests"
  on public.feed_requests
  for select
  using (user_id = auth.uid());

create table public.feed_items (
  id bigint generated always as identity primary key,
  request_id text not null,
  user_id uuid null,
  book_id text not null,
  rank integer not null,
  created_at timestamptz null default now()
);

create index feed_items_request_id_idx on public.feed_items (request_id);

comment on table public.feed_items is 'Ranked feed results per feed_requests.id (as request_id).';

alter table public.feed_items enable row level security;

-- Allow read when the linked feed_request belongs to the user (request_id matches feed_requests.id).
create policy "Users can read feed_items for own feed_requests"
  on public.feed_items
  for select
  using (
    exists (
      select 1
      from public.feed_requests fr
      where fr.id::text = feed_items.request_id
        and fr.user_id = auth.uid()
    )
  );

-- Backend (service role) inserts feed_items; RLS does not apply to service role
