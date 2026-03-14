-- Migration: add user_ratings table for Book Doctor
-- Users can read/insert/update/delete only their own ratings.
-- book_id references public.books(book_id) (integer business ID).

-- 1. Prerequisite: unique on books.book_id (required for FK)
alter table public.books
  add constraint books_book_id_key unique (book_id);

-- 2. Table definition
create table public.user_ratings (
  user_id uuid not null,
  book_id integer not null
    references public.books (book_id) on delete cascade,
  book_rating smallint not null
    check (book_rating >= 1 and book_rating <= 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

create index user_ratings_book_id_idx on public.user_ratings (book_id);

comment on table public.user_ratings is 'User ratings for books; RLS restricts to own rows.';

-- 3. updated_at trigger
create or replace function public.set_user_ratings_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_user_ratings_updated_at on public.user_ratings;

create trigger set_user_ratings_updated_at
  before update on public.user_ratings
  for each row
  execute function public.set_user_ratings_updated_at();

-- 4. Row-Level Security
alter table public.user_ratings enable row level security;

drop policy if exists "Users can read own ratings" on public.user_ratings;
create policy "Users can read own ratings"
  on public.user_ratings
  for select
  using (user_id = auth.uid());

drop policy if exists "Users can insert own ratings" on public.user_ratings;
create policy "Users can insert own ratings"
  on public.user_ratings
  for insert
  with check (user_id = auth.uid());

drop policy if exists "Users can update own ratings" on public.user_ratings;
create policy "Users can update own ratings"
  on public.user_ratings
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can delete own ratings" on public.user_ratings;
create policy "Users can delete own ratings"
  on public.user_ratings
  for delete
  using (user_id = auth.uid());
