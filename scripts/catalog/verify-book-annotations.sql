-- Run after both 20261025 annotation migrations, and again after the real import.
-- Supabase web SQL Editor: Database, postgres. One read-only SELECT.
-- Returns catalog settings, aggregate catalog counts, and publication summaries.
-- No user rows, book names, author names, award records, or function bodies returned.
with book_counts as (
  select count(*) as total_books,
    count(*) filter (where annotation_export_version is not null) as published_books,
    count(*) filter (where book_ranking is not null) as ranked_books,
    count(*) filter (where author_ranking is not null) as books_with_ranked_authors,
    count(*) filter (where awards is not null and awards <> '[]'::jsonb) as books_with_awards,
    count(*) filter (where nullif(btrim(book_name), '') is null or nullif(btrim(author), '') is null) as invalid_core_identities,
    count(*) filter (where not private.valid_book_annotation_ranking(book_ranking)
      or not private.valid_book_annotation_ranking(author_ranking)
      or not private.valid_book_annotation_awards(awards)) as invalid_annotations
  from public.books
), read_rpcs as (
  select p.* from pg_catalog.pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname in (
    'get_rate_feed_bootstrap_annotated', 'get_eligible_feed_books_annotated',
    'get_eligible_top_100_books_annotated'
  )
)
select jsonb_build_object(
  'captured_at_utc', statement_timestamp() at time zone 'UTC',
  'role', current_user,
  'books', (select to_jsonb(b) from book_counts b),
  'read_rpcs', (select coalesce(jsonb_agg(jsonb_build_object(
    'function', p.oid::regprocedure::text,
    'security_definer', p.prosecdef,
    'volatility', p.provolatile,
    'settings', p.proconfig,
    'authenticated_can_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    'anon_can_execute', has_function_privilege('anon', p.oid, 'EXECUTE')
  ) order by p.proname), '[]'::jsonb) from read_rpcs p),
  'private_import_access', jsonb_build_object(
    'authenticated_can_read_staging', has_table_privilege('authenticated', 'private.book_annotation_import_rows', 'SELECT'),
    'anon_can_read_staging', has_table_privilege('anon', 'private.book_annotation_import_rows', 'SELECT'),
    'service_role_can_apply', has_function_privilege('service_role', 'private.apply_book_annotation_import(text)', 'EXECUTE')
  ),
  'recent_publications', (
    select coalesce(jsonb_agg(to_jsonb(e) order by created_at desc), '[]'::jsonb)
    from (select export_version, state, created_at, applied_at, summary
      from private.book_annotation_exports order by created_at desc limit 10) e
  )
) as book_annotation_verification;
