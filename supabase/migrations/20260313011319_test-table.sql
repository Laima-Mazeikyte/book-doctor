-- Simple test table
create table public.test_table (
  id uuid primary key default gen_random_uuid(),
  name text,
  created_at timestamptz default now()
);

-- Enable RLS (optional, good practice for Supabase)
alter table public.test_table enable row level security;

-- Allow read for authenticated users (adjust policy as needed)
create policy "Allow read for authenticated users"
  on public.test_table
  for select
  to authenticated
  using (true);
