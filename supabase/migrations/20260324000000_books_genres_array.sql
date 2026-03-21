-- Multiple genres per book (e.g. pipe-separated in source TSV → text[]).

alter table public.books
  add column if not exists genres text[];

-- Backfill from legacy single `genre` column (migration 20260323000000) when present
update public.books b
set genres = coalesce(
  (
    select array_agg(trim(t.x)) filter (where trim(t.x) <> '')
    from unnest(string_to_array(b.genre, '|')) as t(x)
  ),
  '{}'::text[]
)
where b.genres is null
  and b.genre is not null
  and b.genre like '%|%';

update public.books
set genres = array[trim(genre)]
where genres is null
  and genre is not null
  and trim(genre) <> '';

alter table public.books
  drop column if exists genre;

comment on column public.books.genres is 'Ordered genre labels from catalog (e.g. split from TSV pipe-separated list).';
