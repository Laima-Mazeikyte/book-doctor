-- Migration: add goodreads_import_jobs table for Goodreads CSV sync.
--
-- Flow: the frontend (logged-in users only) parses the Goodreads export CSV,
-- inserts ONE job row holding [{ goodreads_id, rating }] with status 'pending',
-- then polls the row. A separate map-server (service role) resolves
-- goodreads_id -> catalog book_id against its private map, upserts user_ratings,
-- and writes back status/matched_count/unmatched. The map itself never touches
-- Supabase or the client.
--
-- RLS: users may insert/select/delete only their own rows. There is deliberately
-- NO user UPDATE policy — only the map-server (service role, bypasses RLS)
-- transitions status and writes results, so a client can't forge a result.

create table public.goodreads_import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),

  -- Frontend writes: [{ goodreads_id: int, rating: int(1-5) }]
  items jsonb not null,

  -- Map-server writes:
  status text not null default 'pending'
    check (status in ('pending', 'done', 'error')),
  matched_count integer not null default 0,
  unmatched jsonb not null default '[]'::jsonb,  -- [goodreads_id, ...]
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index goodreads_import_jobs_user_id_idx
  on public.goodreads_import_jobs (user_id, created_at desc);

comment on table public.goodreads_import_jobs is
  'Goodreads CSV import jobs. Frontend inserts items + polls; map-server writes results. RLS restricts to own rows (no user UPDATE).';

-- updated_at trigger (matches existing table conventions)
create or replace function public.set_goodreads_import_jobs_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_goodreads_import_jobs_updated_at on public.goodreads_import_jobs;

create trigger set_goodreads_import_jobs_updated_at
  before update on public.goodreads_import_jobs
  for each row
  execute function public.set_goodreads_import_jobs_updated_at();

-- Row-Level Security
alter table public.goodreads_import_jobs enable row level security;

drop policy if exists "Users can read own import jobs" on public.goodreads_import_jobs;
create policy "Users can read own import jobs"
  on public.goodreads_import_jobs
  for select
  using (user_id = auth.uid());

drop policy if exists "Users can insert own import jobs" on public.goodreads_import_jobs;
create policy "Users can insert own import jobs"
  on public.goodreads_import_jobs
  for insert
  with check (user_id = auth.uid());

drop policy if exists "Users can delete own import jobs" on public.goodreads_import_jobs;
create policy "Users can delete own import jobs"
  on public.goodreads_import_jobs
  for delete
  using (user_id = auth.uid());
