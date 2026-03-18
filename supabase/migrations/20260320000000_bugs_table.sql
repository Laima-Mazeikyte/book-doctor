-- Migration: bugs table for bug/feedback reports (submit-only; view in Supabase dashboard).
-- RLS: INSERT for anon and authenticated only. No SELECT/DELETE so app never reads.

create table public.bugs (
  id text not null primary key,
  description text not null,
  author text,
  viewport_width integer,
  device_info jsonb,
  created_at timestamptz not null default now()
);

comment on table public.bugs is 'Bug/feedback reports; RLS allows insert only. View in Supabase Table Editor.';

alter table public.bugs enable row level security;

create policy "Anyone can insert bugs"
  on public.bugs
  for insert
  to anon, authenticated
  with check (true);
