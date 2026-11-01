-- Install after public book slugs and series storage, before testing the book page.
-- This read function is separate so series imports can run without the slug backfill.
-- Safe to repeat; preserves the existing detail response and reader grants.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

do $prerequisites$
begin
  if not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.books'::regclass and a.attname = 'slug'
      and a.attnum > 0 and not a.attisdropped and a.attnotnull
  ) then
    raise exception 'Install 20261027000000_public_book_slugs.sql before the series detail function';
  end if;
  if to_regclass('public.book_series') is null or to_regclass('public.book_series_members') is null then
    raise exception 'Install 20261028000000_book_series.sql before the series detail function';
  end if;
end;
$prerequisites$;

create or replace function public.get_book_detail_with_series(p_slug text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with current_book as materialized (
    select b.id, b.book_id, b.slug, b.book_name, b.author, b.summary, b.year,
      b.genre1, b.genre2, b.genre3, b.genre4, b.genre5, b.genre6, b.genre7, b.type,
      b.quality_band, b.book_ranking, b.author_ranking, b.awards,
      b.pace_value, b.vocabulary_value, b.depth_value, b.originality_value,
      b.discussion_potential_value, b.violence_value, b.spice_value,
      b.atmosphere_value, b.entry_barrier_value,
      b.keyword1, b.keyword2, b.keyword3, b.keyword4, b.keyword5,
      b.keyword6, b.keyword7, b.keyword8, b.keyword9, b.keyword10
    from public.books b where b.slug = p_slug
  ), membership as materialized (
    select s.id, s.series_title, m.series_number
    from current_book b join public.book_series_members m using (book_id)
    join public.book_series s on s.id = m.series_id
  )
  select jsonb_build_object('book', to_jsonb(b), 'series', (
    select jsonb_build_object('title', s.series_title, 'number', s.series_number,
      'members', (select coalesce(jsonb_agg(jsonb_build_object(
        'book_id', other.book_id, 'slug', other.slug, 'title', other.book_name, 'number', m.series_number
      ) order by m.series_number, other.book_id), '[]'::jsonb)
      from public.book_series_members m join public.books other using (book_id)
      where m.series_id = s.id)
    ) from membership s
  )) from current_book b;
$$;
revoke all on function public.get_book_detail_with_series(text) from public, anon, authenticated, service_role;
grant execute on function public.get_book_detail_with_series(text) to anon, authenticated;
comment on function public.get_book_detail_with_series(text) is
  'Public catalog detail and lightweight ordered series members in one read. SECURITY INVOKER preserves catalog RLS. No ranking-derived membership or application writes.';

notify pgrst, 'reload schema';
commit;
