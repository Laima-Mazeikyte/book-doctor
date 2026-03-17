-- Migration: add top_100_books table for curated feed (top 100)
-- Feed/curation only; books table stays single source of truth.
-- Data populated by seed script (see scripts/seed-top-100.ts).

create table public.top_100_books (
  book_id integer not null
    references public.books (book_id) on delete cascade,
  genre text not null,
  display_order smallint not null
    check (display_order >= 1 and display_order <= 100),
  primary key (book_id)
);

create index top_100_books_book_id_idx on public.top_100_books (book_id);
create index top_100_books_display_order_idx on public.top_100_books (display_order);

comment on table public.top_100_books is 'Curated top 100 books for initial feed; display_order gives 2-per-genre batching.';

alter table public.top_100_books enable row level security;

drop policy if exists "Allow read for all users" on public.top_100_books;
create policy "Allow read for all users"
  on public.top_100_books
  for select
  using (true);
