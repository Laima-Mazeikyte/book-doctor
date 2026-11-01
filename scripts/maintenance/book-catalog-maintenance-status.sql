-- During/after catalog compaction, including after SQL Editor timeout/NetworkError.
-- For scheduled compaction, use book-catalog-compaction-background-status.sql as well
-- to inspect its audit result, native Cron history and job cleanup.
-- SQL Editor: Database / postgres. One read-only catalog/statistics SELECT.
-- No book scan, query text, cancellation, lock acquisition or maintenance execution.
-- Sessions/progress are capture-time observations; an empty list does not prove success.
-- Avoids relation-size calls, which can wait on the rewrite's exclusive table lock.
-- A completed VACUUM FULL is not audited here: compare allocations and verify data
-- separately after the worker has finished.
with books as materialized (
  select 'public.books'::regclass::oid as oid
), progress as materialized (
  select p.pid, p.command, p.phase, p.heap_blks_total, p.heap_blks_scanned,
    p.heap_tuples_scanned, p.heap_tuples_written, p.index_rebuild_count
  from pg_catalog.pg_stat_progress_cluster p
  where p.datid = (select oid from pg_catalog.pg_database where datname = current_database())
    and p.relid = (select oid from books)
), schema_locks as materialized (
  select l.pid, l.granted, l.mode
  from pg_catalog.pg_locks l
  where l.locktype = 'relation' and l.relation = (select oid from books)
    and l.database = (select oid from pg_catalog.pg_database where datname = current_database())
    and l.mode = 'AccessExclusiveLock' and l.pid <> pg_backend_pid()
)
select jsonb_build_object(
  'captured_at_utc', statement_timestamp() at time zone 'UTC',
  'database_bytes', pg_catalog.pg_database_size(current_database()),
  'table', 'public.books',
  'progress', (select coalesce(jsonb_agg(to_jsonb(p) order by pid), '[]'::jsonb) from progress p),
  'schema_lock_sessions', (select coalesce(jsonb_agg(jsonb_build_object(
    'pid', l.pid, 'lock_granted', l.granted, 'mode', l.mode, 'state', a.state,
    'query_start', a.query_start, 'wait_event_type', a.wait_event_type,
    'wait_event', a.wait_event, 'blocking_pids', pg_catalog.pg_blocking_pids(l.pid)
  ) order by l.pid), '[]'::jsonb)
    from schema_locks l left join pg_catalog.pg_stat_activity a on a.pid = l.pid)
) as book_catalog_maintenance_status;
