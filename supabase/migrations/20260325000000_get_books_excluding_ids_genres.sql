-- Include books.genres in RPC used by /api/books/popular (batch 6+).
-- Postgres does not allow CREATE OR REPLACE when the return row type changes; drop first.

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
  genres text[]
)
language sql
stable
security invoker
as $$
  select b.id, b.book_id, b.book_name, b.author, b.cover_url, b.summary, b.year, b.genres
  from public.books b
  where (p_exclude_ids is null or cardinality(p_exclude_ids) = 0 or b.book_id != all(p_exclude_ids))
  order by b.cover_url desc nulls last
  limit greatest(p_limit_count, 1);
$$;

comment on function public.get_books_excluding_ids(integer[], integer) is 'Returns books excluding given book_ids, ordered by cover_url (prefer covers), for popular feed batch 6+; includes genres.';
