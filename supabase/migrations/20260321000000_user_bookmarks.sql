-- Migration: add user_bookmarks table for Book Doctor
-- Users can read/insert/delete only their own bookmarks (anon + authenticated).
-- book_id references public.books(book_id) (integer business ID).

create table public.user_bookmarks (
  user_id uuid not null,
  book_id integer not null
    references public.books (book_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

create index user_bookmarks_book_id_idx on public.user_bookmarks (book_id);

comment on table public.user_bookmarks is 'User bookmarks (plan to read); RLS restricts to own rows.';

alter table public.user_bookmarks enable row level security;

create policy "Users can read own bookmarks"
  on public.user_bookmarks
  for select
  using (user_id = auth.uid());

create policy "Users can insert own bookmarks"
  on public.user_bookmarks
  for insert
  with check (user_id = auth.uid());

create policy "Users can delete own bookmarks"
  on public.user_bookmarks
  for delete
  using (user_id = auth.uid());
