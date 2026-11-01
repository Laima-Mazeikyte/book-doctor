-- Find existing award storage before adding book awards to the annotation publication.
-- Run this ENTIRE file in Supabase web SQL Editor: source Database, role postgres.
-- Return the one-row book_award_inventory JSON result.
--
-- One read-only SELECT over PostgreSQL catalogs only. No application-row reads,
-- function execution, Storage downloads, schema/data changes, or statistics resets.
-- No function bodies, trigger arguments, defaults, or stored award/header values
-- are returned. Row estimates are catalog estimates, not exact counts.
--
-- The earlier annotation inventory did not explicitly search award/prize names.
-- Empty candidates here do not prove absence from generic JSON, external sources,
-- excluded platform/archive schemas, or Supabase Storage. public.books is included
-- even when none of its column names mentions awards.

with schemas as materialized (
  select n.oid, n.nspname
  from pg_catalog.pg_namespace n
  where n.nspname !~ '^pg_' and n.nspname not in (
    'information_schema', 'auth', 'storage', 'realtime', '_realtime',
    'supabase_functions', 'supabase_migrations', 'extensions', 'vault', 'net', 'cron',
    'graphql', 'graphql_public', 'pgbouncer', 'pgsodium', 'pgsodium_masks',
    '_analytics', '_supavisor', 'migration_archive'
  ) and not exists (
    select 1 from pg_catalog.pg_depend d
    where d.classid = 'pg_catalog.pg_namespace'::regclass
      and d.objid = n.oid and d.deptype = 'e'
  )
), relations as materialized (
  select c.*, n.nspname as schema_name
  from pg_catalog.pg_class c
  join schemas n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f') and not exists (
    select 1 from pg_catalog.pg_depend d
    where d.classid = 'pg_catalog.pg_class'::regclass
      and d.objid = c.oid and d.deptype = 'e'
  )
), columns as materialized (
  select a.*
  from pg_catalog.pg_attribute a
  join relations r on r.oid = a.attrelid
  where a.attnum > 0 and not a.attisdropped
), candidates as materialized (
  select r.*,
    r.relname ~* '(award|prize|recognition|accolade|honou?r|nomina|finalist|winner)'
      or exists (
        select 1 from columns a
        where a.attrelid = r.oid
          and a.attname ~* '(award|prize|recognition|accolade|honou?r|nomina|finalist|winner)'
      ) as has_award_named_relation_or_column
  from relations r
), selected_relations as materialized (
  select * from candidates
  where has_award_named_relation_or_column
    or (schema_name = 'public' and relname = 'books')
)
select jsonb_build_object(
  'captured_at_utc', statement_timestamp() at time zone 'UTC',
  'role', current_user,
  'schemas_scanned', (select coalesce(jsonb_agg(nspname order by nspname), '[]'::jsonb) from schemas),
  'award_named_relation_count', (select count(*) from candidates where has_award_named_relation_or_column),
  'candidate_relations', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', r.schema_name,
      'name', r.relname,
      'kind', r.relkind,
      'has_award_named_relation_or_column', r.has_award_named_relation_or_column,
      'estimated_rows', r.reltuples::bigint,
      'rls_enabled', r.relrowsecurity,
      'rls_forced', r.relforcerowsecurity,
      'authenticated_can_select', pg_catalog.has_table_privilege('authenticated', r.oid, 'SELECT'),
      'anon_can_select', pg_catalog.has_table_privilege('anon', r.oid, 'SELECT'),
      'columns', (
        select jsonb_agg(jsonb_build_object(
          'name', a.attname,
          'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
          'not_null', a.attnotnull
        ) order by a.attnum)
        from columns a where a.attrelid = r.oid
      ),
      'foreign_keys', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'name', c.conname,
          'validated', c.convalidated,
          'definition', pg_catalog.pg_get_constraintdef(c.oid)
        ) order by c.conname), '[]'::jsonb)
        from pg_catalog.pg_constraint c
        where c.conrelid = r.oid and c.contype = 'f'
      )
    ) order by r.schema_name, r.relname), '[]'::jsonb)
    from selected_relations r
  ),
  'related_routines_without_bodies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname,
      'name', p.proname,
      'identity_arguments', pg_catalog.pg_get_function_identity_arguments(p.oid),
      'security_definer', p.prosecdef
    ) order by n.nspname, p.proname, p.oid), '[]'::jsonb)
    from pg_catalog.pg_proc p
    join schemas n on n.oid = p.pronamespace
    where p.prokind in ('f', 'p')
      and (p.proname ~* '(award|prize|recognition|accolade|honou?r|nomina|finalist|winner)'
        or p.prosrc ~* '(award|prize|recognition|accolade|honou?r|nomina|finalist|winner)')
      and not exists (
        select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_proc'::regclass
          and d.objid = p.oid and d.deptype = 'e'
      )
  )
) as book_award_inventory;
