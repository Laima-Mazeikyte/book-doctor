-- Diagnose a preview with export_found=false before repeating any upload.
-- Supabase web SQL Editor: Database, postgres; use the same project as Table Editor.
-- One read-only SELECT. No application data is changed or returned.
-- Reads counts/version IDs from private import tables, and catalogs for candidate
-- CSV-created tables. It does not scan rows in other candidate tables.
with parameters(export_version) as (
  values ('book-annotations-test-001'::text)
), registrations as materialized (
  select export_version, state, manifest->>'record_count' as expected_books,
    created_at, applied_at
  from private.book_annotation_exports
  order by created_at desc limit 20
), private_staging as materialized (
  select export_version, count(*) as staged_books
  from private.book_annotation_import_rows
  group by export_version
), candidates as materialized (
  select c.oid, n.nspname as schema_name, c.relname as table_name,
    c.reltuples::bigint as estimated_rows
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
    and not exists (
      select 1 from (values ('export_version'), ('book_id'), ('record')) expected(column_name)
      where not exists (
        select 1 from pg_catalog.pg_attribute a
        where a.attrelid = c.oid and a.attname = expected.column_name
          and a.attnum > 0 and not a.attisdropped
      )
    )
)
select jsonb_build_object(
  'role', current_user,
  'database', current_database(),
  'target_export_version', (select export_version from parameters),
  'target_export_present', exists (
    select 1 from private.book_annotation_exports e
    join parameters p using (export_version)
  ),
  'recent_registrations', (
    select coalesce(jsonb_agg(to_jsonb(r) order by created_at desc), '[]'::jsonb)
    from registrations r
  ),
  'private_staging_rows_all_exports', (
    select coalesce(sum(staged_books), 0) from private_staging
  ),
  'private_staging_by_export', (
    select coalesce(jsonb_agg(to_jsonb(s) order by export_version), '[]'::jsonb)
    from private_staging s
  ),
  'candidate_import_tables', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', c.schema_name, 'table', c.table_name, 'estimated_rows', c.estimated_rows,
      'import_columns', (
        select jsonb_object_agg(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod))
        from pg_catalog.pg_attribute a
        where a.attrelid = c.oid and a.attname in ('export_version', 'book_id', 'record')
          and a.attnum > 0 and not a.attisdropped
      )
    ) order by c.schema_name, c.table_name), '[]'::jsonb)
    from candidates c
  ),
  'staging_export_foreign_keys', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', c.conname, 'validated', c.convalidated,
      'definition', pg_catalog.pg_get_constraintdef(c.oid)
    ) order by c.conname), '[]'::jsonb)
    from pg_catalog.pg_constraint c
    where c.conrelid = 'private.book_annotation_import_rows'::regclass
      and c.contype = 'f'
      and c.confrelid = 'private.book_annotation_exports'::regclass
  )
) as book_annotation_import_location;
