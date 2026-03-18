-- Migration: add user_not_interested table for Book Doctor
-- Users can read/insert/delete only their own "not interested" books.
-- book_id references public.books(book_id) (integer business ID).

create table public.user_not_interested (
  user_id uuid not null,
  book_id integer not null
    references public.books (book_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

create index user_not_interested_book_id_idx on public.user_not_interested (book_id);

comment on table public.user_not_interested is 'Books the user marked as not interested; excluded from recommendation lists.';

alter table public.user_not_interested enable row level security;

create policy "Users can read own not interested"
  on public.user_not_interested
  for select
  using (user_id = auth.uid());

create policy "Users can insert own not interested"
  on public.user_not_interested
  for insert
  with check (user_id = auth.uid());

create policy "Users can delete own not interested"
  on public.user_not_interested
  for delete
  using (user_id = auth.uid());
