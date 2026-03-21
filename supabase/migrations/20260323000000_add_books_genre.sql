-- Add optional genre on books (catalog source of truth; top_100_books.genre remains for feed curation).

alter table public.books
  add column if not exists genre text;

comment on column public.books.genre is 'Primary genre label from the catalog; nullable for legacy rows until backfilled.';
