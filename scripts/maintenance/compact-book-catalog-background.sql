-- Run this ENTIRE file in SQL Editor: Database / postgres, instead of foreground compaction.
-- The short request schedules a standalone VACUUM for roughly two minutes from now.
-- Run only in a quiet maintenance window after checking available PHYSICAL disk space.
-- Book reads/writes, including production, wait during the exclusive rewrite.
-- Requires existing pg_cron with run logging enabled. Changes no global/role timeouts.
-- VACUUM is the worker's ONLY statement: no DO, BEGIN, SET or cleanup in that command.
-- Native database/role statement timeouts still apply; Dashboard request timeouts do not.
-- A separate observer records the native result and removes both jobs after the attempt.
-- The worker uses a calendar-minute schedule, not an every-minute retry loop. Cron has
-- no year field; if the observer is interrupted, this pattern could recur next year.
-- Inspect status before any retry, and check that both jobs are gone after completion.
-- SKIP_LOCKED may skip a busy table: native success is NOT proof of recovered bytes.
-- This request creates only small private audit metadata and Cron jobs; no books updated.
-- https://github.com/citusdata/pg_cron
begin;
set local statement_timeout = '20s';
set local lock_timeout = '2s';
create schema if not exists private;
create table if not exists private.book_catalog_compaction (
  maintenance_key text primary key,
  attempt integer not null,
  state text not null check (state in ('queued', 'finished', 'failed', 'not_started')),
  queued_at timestamptz not null,
  scheduled_for timestamptz not null,
  cron_timezone text not null,
  worker_job_id bigint,
  observer_job_id bigint,
  native_run_id bigint,
  started_at timestamptz,
  finished_at timestamptz,
  native_status text,
  message text,
  books_bytes_before bigint not null,
  books_bytes_after bigint
);
alter table private.book_catalog_compaction enable row level security;
revoke all on private.book_catalog_compaction from public, anon, authenticated, service_role;

do $schedule$
declare
  v_run_at timestamptz := date_trunc('minute', clock_timestamp()) + interval '2 minutes';
  v_timezone text := coalesce(nullif(current_setting('cron.timezone', true), ''), 'GMT');
  v_local_run timestamp;
  v_schedule text;
  v_worker bigint;
  v_observer bigint;
  v_before bigint;
begin
  if current_user <> 'postgres' then raise exception 'Run as postgres'; end if;
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron')
    or to_regclass('cron.job_run_details') is null then
    raise exception 'Existing pg_cron with run history is required';
  end if;
  if current_setting('cron.log_run', true) = 'off' then
    raise exception 'Cron run logging is disabled; no compaction was scheduled';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(20261029, 1) then
    raise exception 'Another compaction scheduler/observer is open; inspect status';
  end if;
  if exists (select 1 from cron.job where jobname in (
    'book-doctor-books-compaction', 'book-doctor-books-compaction-observer'
  )) then raise exception 'A compaction job already exists; inspect background status before retrying'; end if;
  if exists (select 1 from pg_catalog.pg_stat_progress_cluster
    where datid = (select oid from pg_catalog.pg_database where datname = current_database())
      and relid = 'public.books'::regclass)
    or exists (select 1 from pg_catalog.pg_locks
      where locktype = 'relation' and relation = 'public.books'::regclass
        and mode = 'AccessExclusiveLock' and pid <> pg_backend_pid()) then
    raise exception 'Catalog maintenance/schema work is active; inspect maintenance status';
  end if;

  v_before := pg_catalog.pg_total_relation_size('public.books');
  v_local_run := v_run_at at time zone v_timezone;
  v_schedule := format('%s %s %s %s *', extract(minute from v_local_run)::integer,
    extract(hour from v_local_run)::integer, extract(day from v_local_run)::integer,
    extract(month from v_local_run)::integer);
  v_worker := cron.schedule('book-doctor-books-compaction', v_schedule,
    '-- book-doctor:books-compaction
vacuum (full, analyze, skip_locked) public.books;');
  v_observer := cron.schedule('book-doctor-books-compaction-observer', '* * * * *', $observe$
do $observer$
declare
  v_attempt private.book_catalog_compaction%rowtype;
  v_run record;
  v_after bigint;
begin
  perform set_config('lock_timeout', '2s', true);
  if not pg_catalog.pg_try_advisory_xact_lock(20261029, 1) then return; end if;
  select * into v_attempt from private.book_catalog_compaction
    where maintenance_key = 'books-full-compaction' for update;
  if not found or v_attempt.state <> 'queued' then return; end if;
  select runid, status, start_time, end_time, return_message into v_run
    from cron.job_run_details where jobid = v_attempt.worker_job_id
    order by runid desc limit 1;
  if found then
    if v_run.status not in ('succeeded', 'failed') or v_run.end_time is null then return; end if;
    begin
      v_after := pg_catalog.pg_total_relation_size('public.books');
    exception when lock_not_available then
      v_after := null;
    end;
    update private.book_catalog_compaction set
      state = case when v_run.status = 'succeeded' then 'finished' else 'failed' end,
      native_run_id = v_run.runid, native_status = v_run.status,
      started_at = v_run.start_time, finished_at = v_run.end_time,
      message = left(v_run.return_message, 1000), books_bytes_after = v_after
    where maintenance_key = v_attempt.maintenance_key;
  elsif clock_timestamp() > v_attempt.scheduled_for + interval '15 minutes' then
    -- No execution record: expire the calendar job instead of leaving an annual retry.
    -- Do not stop a worker whose execution record is currently nonterminal.
    update private.book_catalog_compaction set state = 'not_started', finished_at = clock_timestamp(),
      message = 'No native worker history appeared within 15 minutes of the scheduled time'
    where maintenance_key = v_attempt.maintenance_key;
  else return;
  end if;
  if exists (select 1 from cron.job where jobid = v_attempt.worker_job_id
    and jobname = 'book-doctor-books-compaction') then
    perform cron.unschedule(v_attempt.worker_job_id);
  end if;
  if exists (select 1 from cron.job where jobid = v_attempt.observer_job_id
    and jobname = 'book-doctor-books-compaction-observer') then
    perform cron.unschedule(v_attempt.observer_job_id);
  end if;
end;
$observer$;
$observe$);

  insert into private.book_catalog_compaction(
    maintenance_key, attempt, state, queued_at, scheduled_for, cron_timezone,
    worker_job_id, observer_job_id, books_bytes_before
  ) values ('books-full-compaction', 1, 'queued', clock_timestamp(), v_run_at,
    v_timezone, v_worker, v_observer, v_before)
  on conflict (maintenance_key) do update set
    attempt = private.book_catalog_compaction.attempt + 1, state = 'queued',
    queued_at = excluded.queued_at, scheduled_for = excluded.scheduled_for,
    cron_timezone = excluded.cron_timezone, worker_job_id = excluded.worker_job_id,
    observer_job_id = excluded.observer_job_id, native_run_id = null, started_at = null,
    finished_at = null, native_status = null, message = null,
    books_bytes_before = excluded.books_bytes_before, books_bytes_after = null;
end;
$schedule$;
commit;

select jsonb_build_object(
  'attempt', (select to_jsonb(a) from private.book_catalog_compaction a
    where maintenance_key = 'books-full-compaction'),
  'worker_timeout_policy', 'Unmodified native database/role defaults apply; no Dashboard request dependency',
  'next_step', 'Run book-catalog-compaction-background-status.sql after scheduled_for. An observer may take another minute to record the result and remove both jobs. Verify actual size savings afterward.'
) as book_catalog_background_schedule;
