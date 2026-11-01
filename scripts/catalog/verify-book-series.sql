-- Run after series storage and again after the v2 export is applied.
-- series_detail_rpc may be null until the separate slug-dependent page function is installed.
-- Supabase SQL Editor: Database / postgres. One read-only SELECT; no book names,
-- series names, application-user rows, or importer execution returned.
select jsonb_build_object(
  'captured_at_utc', statement_timestamp() at time zone 'UTC',
  'series_count', (select count(*) from public.book_series),
  'member_books', (select count(*) from public.book_series_members),
  'invalid_memberships', (select count(*) from public.book_series_members m
    left join public.book_series s on s.id = m.series_id
    left join public.books b using (book_id)
    where s.id is null or b.book_id is null or m.series_number < 0.01
      or m.series_number in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
  'orphan_series', (select count(*) from public.book_series s where not exists (
    select 1 from public.book_series_members m where m.series_id = s.id)),
  'series_detail_rpc', (select jsonb_build_object(
    'function', p.oid::regprocedure::text, 'security_definer', p.prosecdef,
    'volatility', p.provolatile, 'settings', p.proconfig,
    'anon_can_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
    'authenticated_can_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.get_book_detail_with_series(text)')),
  'tables', (select jsonb_agg(jsonb_build_object(
    'table', c.relname, 'rls_enabled', c.relrowsecurity,
    'allocated_bytes', pg_total_relation_size(c.oid),
    'anon_can_select', has_table_privilege('anon', c.oid, 'SELECT'),
    'authenticated_can_select', has_table_privilege('authenticated', c.oid, 'SELECT'),
    'anon_can_write', has_table_privilege('anon', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE'),
    'authenticated_can_write', has_table_privilege('authenticated', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')
  ) order by c.relname) from pg_catalog.pg_class c
    where c.oid in ('public.book_series'::regclass, 'public.book_series_members'::regclass)),
  'private_import_access', jsonb_build_object(
    'anon_can_apply', has_function_privilege('anon', 'private.apply_book_annotation_import(text)', 'EXECUTE'),
    'authenticated_can_apply', has_function_privilege('authenticated', 'private.apply_book_annotation_import(text)', 'EXECUTE'),
    'service_role_can_apply', has_function_privilege('service_role', 'private.apply_book_annotation_import(text)', 'EXECUTE'))
) as book_series_verification;
