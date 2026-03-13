-- Migration: create books table for Book Doctor

create extension if not exists "pgcrypto";

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),

  -- From CSV source of truth
  book_id integer not null,
  author text not null,
  title text not null,

  -- Extra metadata for the app
  year smallint,
  isbn text,
  cover_url text,
  summary text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_books_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_books_updated_at on public.books;

create trigger set_books_updated_at
before update on public.books
for each row
execute function public.set_books_updated_at();

alter table public.books enable row level security;

drop policy if exists "Allow read for all users" on public.books;

create policy "Allow read for all users"
  on public.books
  for select
  using (true);

