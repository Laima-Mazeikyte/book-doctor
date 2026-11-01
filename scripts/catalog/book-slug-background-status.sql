-- After scheduling apply-book-slugs-background.sql. Database / postgres.
-- One read-only SELECT; no book scan, query/command export, cancellation or writes.
-- Run after the scheduler created private.book_slug_installation.
-- Requires existing cron.job and cron.job_run_details relations.
-- recorded_attempt.state is authoritative: a caught migration failure can leave the
-- Cron wrapper marked succeeded because failure recording and cleanup succeeded.
-- A missing job alone is NOT proof that the migration succeeded.
-- Cron history is a bounded sample; retention or disabled run logging can hide a run.
with recent as materialized (
  select runid, jobid, job_pid, database, username, status, start_time, end_time,
    left(return_message, 1000) as return_message,
    position('book-doctor:public-book-slugs:20261027000000' in coalesce(command, '')) > 0 as matches_migration
  from cron.job_run_details order by runid desc limit 100
), sessions as materialized (
  select distinct a.pid, a.state, a.xact_start, a.query_start,
    a.wait_event_type, a.wait_event, pg_catalog.pg_blocking_pids(a.pid) as blocking_pids
  from pg_catalog.pg_locks l join pg_catalog.pg_stat_activity a using (pid)
  where l.locktype = 'advisory' and l.classid = 20261027::oid
    and l.objid in (1::oid, 2::oid) and l.objsubid = 2
    and a.datname = current_database() and a.pid <> pg_backend_pid()
)
select jsonb_build_object(
  'captured_at_utc', statement_timestamp() at time zone 'UTC',
  'slug_column_present', exists (select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.books'::regclass and attname = 'slug' and attnum > 0 and not attisdropped),
  'slug_column_not_null', coalesce((select attnotnull from pg_catalog.pg_attribute
    where attrelid = 'public.books'::regclass and attname = 'slug' and attnum > 0 and not attisdropped), false),
  'slug_unique_index_valid', exists (select 1 from pg_catalog.pg_index
    where indexrelid = to_regclass('public.books_slug_key') and indisunique and indisvalid and indisready),
  'slug_allocation_trigger_present', exists (select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.books'::regclass and tgname = 'assign_book_slug' and not tgisinternal and tgenabled <> 'D'),
  'scheduled_job', (select jsonb_build_object('job_id', jobid, 'active', active,
    'schedule', schedule) from cron.job where jobname = 'book-doctor-public-book-slugs-20261027'),
  'recorded_attempt', (select to_jsonb(a) from private.book_slug_installation a
    where migration_key='20261027000000_public_book_slugs'),
  'observed_slug_sessions', (select coalesce(jsonb_agg(to_jsonb(s) order by pid), '[]'::jsonb) from sessions s),
  'recent_migration_runs', (select coalesce(jsonb_agg(to_jsonb(r) order by runid desc), '[]'::jsonb)
    from (select runid, jobid, job_pid, status, start_time, end_time, return_message
      from recent where matches_migration and database = current_database()
      order by runid desc limit 5) r)
) as book_slug_background_status;
