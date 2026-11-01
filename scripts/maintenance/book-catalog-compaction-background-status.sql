-- Run after compact-book-catalog-background.sql: Database / postgres.
-- One read-only SELECT. No book scan, relation-size calls, cancellation or job changes.
-- The observer may need another minute after native completion to update the audit.
-- Native succeeded/finished may mean SKIP_LOCKED skipped a busy table: verify savings.
-- If jobs remain after the audit becomes terminal, return this report before retrying.
with attempt as materialized (
  select * from private.book_catalog_compaction where maintenance_key = 'books-full-compaction'
), latest_run as materialized (
  select r.runid, r.status, r.start_time, r.end_time, left(r.return_message, 1000) as message
  from cron.job_run_details r join attempt a on a.worker_job_id = r.jobid
  order by r.runid desc limit 1
)
select jsonb_build_object(
  'captured_at_utc', statement_timestamp() at time zone 'UTC',
  'attempt', (select to_jsonb(a) || jsonb_build_object(
    'recorded_bytes_reclaimed', case when a.books_bytes_after is not null
      then a.books_bytes_before - a.books_bytes_after end
  ) from attempt a),
  'latest_native_worker_run', (select to_jsonb(r) from latest_run r),
  'remaining_jobs', (select coalesce(jsonb_agg(jsonb_build_object(
    'job_id', j.jobid, 'name', j.jobname, 'schedule', j.schedule, 'active', j.active
  ) order by j.jobid), '[]'::jsonb) from cron.job j
    where j.jobname in ('book-doctor-books-compaction', 'book-doctor-books-compaction-observer')),
  'active_rewrite', (select coalesce(jsonb_agg(jsonb_build_object(
    'pid', p.pid, 'command', p.command, 'phase', p.phase,
    'heap_blks_total', p.heap_blks_total, 'heap_blks_scanned', p.heap_blks_scanned,
    'heap_tuples_written', p.heap_tuples_written, 'index_rebuild_count', p.index_rebuild_count
  ) order by p.pid), '[]'::jsonb) from pg_catalog.pg_stat_progress_cluster p
    where p.datid = (select oid from pg_catalog.pg_database where datname = current_database())
      and p.relid = 'public.books'::regclass)
) as book_catalog_background_status;
