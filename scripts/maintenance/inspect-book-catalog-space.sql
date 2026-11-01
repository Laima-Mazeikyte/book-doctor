-- After reclaiming empty import staging: Supabase SQL Editor, Database / postgres.
-- Run this ENTIRE file and return book_catalog_space_inspection.
-- READ ONLY: catalog metadata and optional physical page statistics for books only.
-- No book values, identifiers, user rows, SQL bodies or credentials are returned.
-- Does not install extensions, change grants, VACUUM, REINDEX, rewrite or delete data.
-- If pgstattuple is already installed and accessible, inspect the heap approximately
-- and each valid ready B-tree index. Otherwise report the missing capability.
-- These reads can cause I/O; the whole inspection has a 20-second statement limit.
-- Free space is reusable allocation, NOT a promise of bytes recoverable by compaction.
-- Page statistics accumulate during the scan and are not one MVCC snapshot.
-- https://www.postgresql.org/docs/17/pgstattuple.html
begin read only;
set local statement_timeout = '20s';
set local lock_timeout = '2s';

do $inspection$
declare
  v_extension_schema text;
  v_heap_function oid;
  v_index_function oid;
  v_heap jsonb := jsonb_build_object('available', false, 'reason', 'pgstattuple is not installed');
  v_indexes jsonb := '[]'::jsonb;
  v_index record;
  v_index_stats jsonb;
  v_report jsonb;
begin
  select n.nspname into v_extension_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgstattuple';

  if v_extension_schema is not null then
    v_heap_function := to_regprocedure(format('%I.pgstattuple_approx(regclass)', v_extension_schema));
    v_index_function := to_regprocedure(format('%I.pgstatindex(regclass)', v_extension_schema));
    v_heap := jsonb_build_object('available', false, 'reason', 'Heap inspection function unavailable or not executable');
    if v_heap_function is not null and pg_catalog.has_function_privilege(v_heap_function, 'EXECUTE') then
      begin
        execute format('select to_jsonb(s) from %I.pgstattuple_approx($1) s', v_extension_schema)
          into v_heap using 'public.books'::regclass;
        v_heap := jsonb_build_object('available', true, 'method', 'pgstattuple_approx', 'statistics', v_heap);
      exception when insufficient_privilege then
        v_heap := jsonb_build_object('available', false, 'reason', 'Physical heap inspection permission denied');
      end;
    end if;
  end if;

  for v_index in
    select c.oid, c.relname, c.reloptions, i.indisprimary, i.indisunique, i.indisvalid, i.indisready,
      am.amname, pg_catalog.pg_relation_size(c.oid) as bytes
    from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
    join pg_catalog.pg_am am on am.oid = c.relam
    where i.indrelid = 'public.books'::regclass
    order by pg_catalog.pg_relation_size(c.oid) desc, c.relname
  loop
    v_index_stats := jsonb_build_object('available', false, 'reason',
      'Requires an executable pgstattuple.pgstatindex(regclass) and a valid ready B-tree index');
    if v_index.amname = 'btree' and v_index.indisvalid and v_index.indisready
      and v_index_function is not null
      and pg_catalog.has_function_privilege(v_index_function, 'EXECUTE') then
      begin
        execute format('select to_jsonb(s) from %I.pgstatindex($1) s', v_extension_schema)
          into v_index_stats using v_index.oid::regclass;
        v_index_stats := jsonb_build_object('available', true, 'statistics', v_index_stats);
      exception when insufficient_privilege then
        v_index_stats := jsonb_build_object('available', false, 'reason', 'Physical index inspection permission denied');
      end;
    end if;
    v_indexes := v_indexes || jsonb_build_array(jsonb_build_object(
      'name', v_index.relname, 'bytes', v_index.bytes, 'access_method', v_index.amname,
      'primary_key', v_index.indisprimary, 'unique', v_index.indisunique,
      'valid', v_index.indisvalid, 'ready', v_index.indisready,
      'storage_parameters', v_index.reloptions, 'physical_inspection', v_index_stats
    ));
  end loop;

  select jsonb_build_object(
    'captured_at_utc', statement_timestamp() at time zone 'UTC',
    'role', current_user, 'read_only', current_setting('transaction_read_only'),
    'pgstattuple_schema', v_extension_schema,
    'database_sizes', (select jsonb_agg(jsonb_build_object(
      'database', datname, 'bytes', pg_catalog.pg_database_size(oid)
    ) order by datname) from pg_catalog.pg_database),
    'books_allocation', jsonb_build_object(
      'heap_main_bytes', pg_catalog.pg_relation_size(b.oid),
      'table_bytes_including_toast', pg_catalog.pg_table_size(b.oid),
      'index_bytes', pg_catalog.pg_indexes_size(b.oid),
      'total_bytes', pg_catalog.pg_total_relation_size(b.oid),
      'estimated_rows', b.reltuples::bigint, 'storage_parameters', b.reloptions,
      'statistics', (select jsonb_build_object(
        'live_rows_estimate', s.n_live_tup, 'dead_rows_estimate', s.n_dead_tup,
        'last_autovacuum', s.last_autovacuum, 'last_autoanalyze', s.last_autoanalyze,
        'updates_cumulative', s.n_tup_upd, 'hot_updates_cumulative', s.n_tup_hot_upd
      ) from pg_catalog.pg_stat_all_tables s where s.relid = b.oid)
    ),
    'heap_physical_inspection', v_heap,
    'indexes', v_indexes,
    'interpretation', jsonb_build_array(
      'Bytes are raw allocations; divide by 1000000 for decimal MB or 1048576 for MiB.',
      'pgstattuple_approx estimates live tuple size and free space; heap page overhead is not free space.',
      'An estimated dead-row count of zero does not exclude free space left by completed vacuum.',
      'Low B-tree leaf density or deleted pages can justify reviewing a rebuild; index size alone does not.',
      'Not all free space is avoidable: table/index fillfactor, tuple alignment and page packing need space.',
      'Heap inspection excludes separate TOAST/index storage; their allocations are reported separately.',
      'This report authorizes no deletion or rewrite. Compaction can require locks and extra disk capacity.'
    )
  ) into v_report from pg_catalog.pg_class b where b.oid = 'public.books'::regclass;

  perform set_config('book_doctor_diagnostics.book_catalog_space', v_report::text, false);
end;
$inspection$;
commit;

with captured as materialized (
  select nullif(current_setting('book_doctor_diagnostics.book_catalog_space', true), '')::jsonb as report
)
select report as book_catalog_space_inspection
from captured
where set_config('book_doctor_diagnostics.book_catalog_space', '', false) = '';
