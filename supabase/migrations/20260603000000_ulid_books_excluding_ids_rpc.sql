-- ULID catalog cutover: popular-feed fallback RPC no longer depends on cover_url.
-- Frontend still calls get_books_excluding_ids for batch 6+ to avoid long PostgREST URLs.

drop function if exists public.get_books_excluding_ids(integer[], integer);
drop function if exists public.get_books_excluding_ids(text[], integer);

create function public.get_books_excluding_ids(
  p_exclude_ids text[],
  p_limit_count int default 60
)
returns table (
  id uuid,
  book_id text,
  book_name text,
  author text,
  summary text,
  year integer,
  genre1 text,
  genre2 text,
  genre3 text,
  genre4 text,
  genre5 text,
  genre6 text,
  genre7 text,
  type text,
  popularity double precision
)
language sql
stable
security invoker
as $$
  select
    b.id,
    b.book_id::text,
    b.book_name,
    b.author,
    b.summary,
    b.year::integer,
    b.genre1,
    b.genre2,
    b.genre3,
    b.genre4,
    b.genre5,
    b.genre6,
    b.genre7,
    b.type,
    b.popularity::double precision
  from public.books b
  where (
    p_exclude_ids is null
    or cardinality(p_exclude_ids) = 0
    or b.book_id::text <> all(p_exclude_ids)
  )
  order by b.popularity desc nulls last, b.book_id
  limit greatest(p_limit_count, 1);
$$;

comment on function public.get_books_excluding_ids(text[], integer) is
  'Returns books excluding ULID book_ids for popular feed batch 6+, ordered by popularity.';
