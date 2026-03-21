-- Catalog: genre1–genre7 + type on books; align get_books_excluding_ids for /api/books/popular (batch 6+).

alter table public.books add column if not exists genre1 text;
alter table public.books add column if not exists genre2 text;
alter table public.books add column if not exists genre3 text;
alter table public.books add column if not exists genre4 text;
alter table public.books add column if not exists genre5 text;
alter table public.books add column if not exists genre6 text;
alter table public.books add column if not exists genre7 text;
alter table public.books add column if not exists type text;

drop function if exists public.get_books_excluding_ids(integer[], integer);

create function public.get_books_excluding_ids(
  p_exclude_ids integer[],
  p_limit_count int default 60
)
returns table (
  id uuid,
  book_id integer,
  book_name text,
  author text,
  cover_url text,
  summary text,
  year smallint,
  genre1 text,
  genre2 text,
  genre3 text,
  genre4 text,
  genre5 text,
  genre6 text,
  genre7 text,
  type text
)
language sql
stable
security invoker
as $$
  select
    b.id,
    b.book_id,
    b.book_name,
    b.author,
    b.cover_url,
    b.summary,
    b.year,
    b.genre1,
    b.genre2,
    b.genre3,
    b.genre4,
    b.genre5,
    b.genre6,
    b.genre7,
    b.type
  from public.books b
  where (p_exclude_ids is null or cardinality(p_exclude_ids) = 0 or b.book_id != all(p_exclude_ids))
  order by b.cover_url desc nulls last
  limit greatest(p_limit_count, 1);
$$;

comment on function public.get_books_excluding_ids(integer[], integer) is
  'Returns books excluding given book_ids, ordered by cover_url (prefer covers), for popular feed batch 6+; includes genre1–genre7 and type.';
