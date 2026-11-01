-- Read-only verification after the URL and series migrations, before frontend deployment.
begin read only;
select jsonb_build_object(
  'catalog_books', count(*),
  'unique_slugs', count(distinct slug),
  'missing_slugs', count(*) filter (where slug is null or slug = ''),
  'maximum_slug_characters', max(length(slug)),
  'slugs_over_100_characters', count(*) filter (where length(slug) > 100),
  'slugs_different_from_current_label', count(*) filter (
    where slug <> private.book_slug_base(book_name, author)
  ),
  'detail_rpc', to_regprocedure('public.get_book_detail_with_series(text)') is not null,
  'allocation_trigger', exists (
    select 1 from pg_trigger where tgrelid = 'public.books'::regclass
      and tgname = 'assign_book_slug' and tgenabled <> 'D'
  )
) as book_url_inventory
from public.books;
commit;
