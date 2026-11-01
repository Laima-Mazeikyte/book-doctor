-- Investigate an apply timeout AFTER checking book-annotation-import-status.sql.
-- Run this ENTIRE file in Supabase SQL Editor: Database, postgres.
-- READ ONLY transaction. EXPLAIN without ANALYZE plans the importer statements;
-- it does NOT update/delete rows, invoke the importer, or fire book triggers.
-- Catalogs/statistics plus the export's manifest; no book or library rows returned.
-- No ANALYZE/VACUUM, schema changes, role changes, query-text dumps or trigger args.
-- Costs/row counts are ESTIMATES, not measured milliseconds or proof of a cause.
-- Statistics are cumulative/current; this does not reconstruct the failed request.
-- https://www.postgresql.org/docs/17/sql-explain.html
begin read only;
set local statement_timeout = '20s';
set local lock_timeout = '2s';

do $diagnostics$
declare
  v_version text := 'book-annotations-test-001';
  v_manifest jsonb;
  v_update_plan jsonb;
  v_match_plan jsonb;
  v_cleanup_plan jsonb;
  v_report jsonb;
begin
  select manifest into v_manifest from private.book_annotation_exports
  where export_version = v_version;
  if not found then raise exception 'Export registration is missing'; end if;

  -- Same UPDATE projection/join as private.apply_book_annotation_import(text).
  execute $plan$
    explain (format json, settings true)
    update public.books b set
      book_ranking = case when nullif(s.record->'book_ranking', 'null'::jsonb) is null then null else
        s.record->'book_ranking' || jsonb_build_object(
          'population_count', $2#>'{ranking_sources,book,population_count}',
          'version', $2#>'{ranking_sources,book,version}') end,
      author_ranking = case when nullif(s.record->'author_ranking', 'null'::jsonb) is null then null else
        s.record->'author_ranking' || jsonb_build_object(
          'population_count', $2#>'{ranking_sources,author,population_count}',
          'version', $2#>'{ranking_sources,author,version}') end,
      awards = nullif(s.record->'awards', 'null'::jsonb),
      annotation_export_version = $1,
      annotations_updated_at = statement_timestamp()
    from private.book_annotation_import_rows s
    where s.export_version = $1 and b.book_id = s.book_id
  $plan$ into v_update_plan using v_version, v_manifest;

  execute $plan$
    explain (format json, settings true)
    select count(*) from private.book_annotation_import_rows s
    join public.books b using (book_id) where s.export_version = $1
  $plan$ into v_match_plan using v_version;

  execute $plan$
    explain (format json, settings true)
    delete from private.book_annotation_import_rows where export_version = $1
  $plan$ into v_cleanup_plan using v_version;

  with targets as (
    select c.*, n.nspname as schema_name from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where (n.nspname = 'public' and c.relname = 'books')
      or (n.nspname = 'private' and c.relname in ('book_annotation_import_rows', 'book_annotation_exports'))
  )
  select jsonb_build_object(
    'captured_at_utc', statement_timestamp() at time zone 'UTC',
    'export_version', v_version,
    'transaction_read_only', current_setting('transaction_read_only'),
    'plans_are_estimates_only', true,
    'plans', jsonb_build_object('update', v_update_plan, 'matching_count', v_match_plan, 'cleanup', v_cleanup_plan),
    'settings', (select jsonb_object_agg(name, setting) from pg_catalog.pg_settings
      where name in ('work_mem', 'maintenance_work_mem', 'statement_timeout', 'lock_timeout',
        'shared_buffers', 'effective_cache_size', 'random_page_cost', 'seq_page_cost',
        'enable_hashjoin', 'enable_mergejoin', 'enable_nestloop', 'track_io_timing', 'jit')),
    'tables', (select jsonb_agg(jsonb_build_object(
      'schema', t.schema_name, 'table', t.relname,
      'estimated_rows', t.reltuples::bigint,
      'heap_bytes', pg_catalog.pg_relation_size(t.oid),
      'table_bytes_including_toast', pg_catalog.pg_table_size(t.oid),
      'index_bytes', pg_catalog.pg_indexes_size(t.oid),
      'rls_enabled', t.relrowsecurity,
      'statistics', (select jsonb_build_object(
        'n_live_tup_estimate', s.n_live_tup, 'n_dead_tup_estimate', s.n_dead_tup,
        'n_mod_since_analyze', s.n_mod_since_analyze,
        'last_analyze', s.last_analyze, 'last_autoanalyze', s.last_autoanalyze,
        'last_autovacuum', s.last_autovacuum,
        'updates_cumulative', s.n_tup_upd, 'hot_updates_cumulative', s.n_tup_hot_upd
      ) from pg_catalog.pg_stat_all_tables s where s.relid = t.oid)
    ) order by t.schema_name, t.relname) from targets t),
    'indexes', (select coalesce(jsonb_agg(jsonb_build_object(
      'schema', t.schema_name, 'table', t.relname,
      'definition', pg_catalog.pg_get_indexdef(i.indexrelid),
      'valid', i.indisvalid, 'ready', i.indisready, 'unique', i.indisunique,
      'bytes', pg_catalog.pg_relation_size(i.indexrelid)
    ) order by t.schema_name, t.relname, i.indexrelid), '[]'::jsonb)
      from targets t join pg_catalog.pg_index i on i.indrelid = t.oid),
    'triggers_without_arguments_or_bodies', (select coalesce(jsonb_agg(jsonb_build_object(
      'schema', t.schema_name, 'table', t.relname, 'name', tr.tgname,
      'enabled', tr.tgenabled, 'internal', tr.tgisinternal,
      'per_row', (tr.tgtype::integer & 1) <> 0,
      'fires_on_update', (tr.tgtype::integer & 16) <> 0,
      'fires_on_delete', (tr.tgtype::integer & 8) <> 0,
      'update_columns', (select coalesce(jsonb_agg(a.attname order by a.attnum), '[]'::jsonb)
        from pg_catalog.pg_attribute a where a.attrelid = t.oid and a.attnum = any(tr.tgattr::smallint[])),
      'function_schema', n.nspname, 'function', p.proname,
      'language', l.lanname, 'function_cost_estimate', p.procost
    ) order by t.schema_name, t.relname, tr.tgname), '[]'::jsonb)
      from targets t join pg_catalog.pg_trigger tr on tr.tgrelid = t.oid
      join pg_catalog.pg_proc p on p.oid = tr.tgfoid
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      join pg_catalog.pg_language l on l.oid = p.prolang),
    'constraints', (select coalesce(jsonb_agg(jsonb_build_object(
      'schema', t.schema_name, 'table', t.relname, 'name', c.conname,
      'validated', c.convalidated, 'definition', pg_catalog.pg_get_constraintdef(c.oid)
    ) order by t.schema_name, t.relname, c.conname), '[]'::jsonb)
      from targets t join pg_catalog.pg_constraint c on c.conrelid = t.oid)
  ) into v_report;

  perform set_config('book_doctor_diagnostics.annotation_apply_report', v_report::text, false);
end;
$diagnostics$;
commit;

with captured as materialized (
  select nullif(current_setting('book_doctor_diagnostics.annotation_apply_report', true), '')::jsonb as report
)
select report as book_annotation_apply_diagnostics
from captured
where set_config('book_doctor_diagnostics.annotation_apply_report', '', false) = '';
