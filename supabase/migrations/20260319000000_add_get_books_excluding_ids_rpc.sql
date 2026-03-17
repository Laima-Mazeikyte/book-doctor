-- RPC to fetch books excluding given book_ids (avoids PostgREST URL length limit when using .not('book_id', 'in', [...]))
-- Used by /api/books/popular for offset >= 100 (batch 6+).

create or replace function public.get_books_excluding_ids(
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
  year smallint
)
language sql
stable
security invoker
as $$
  select b.id, b.book_id, b.book_name, b.author, b.cover_url, b.summary, b.year
  from public.books b
  where (p_exclude_ids is null or cardinality(p_exclude_ids) = 0 or b.book_id != all(p_exclude_ids))
  order by b.cover_url desc nulls last
  limit greatest(p_limit_count, 1);
$$;

comment on function public.get_books_excluding_ids is 'Returns books excluding given book_ids, ordered by cover_url (prefer covers), for popular feed batch 6+.';
