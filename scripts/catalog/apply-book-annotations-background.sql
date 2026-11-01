-- Alternative to 99-apply.sql for this verified delivery after a Dashboard timeout.
-- Run this ENTIRE file in SQL Editor: Database, postgres. Do not also run 99-apply.sql.
-- Requires the existing pg_cron extension; does not install extensions or change roles.
-- Schedules the same atomic importer, normally starting at the next minute boundary.
-- Five-minute statement limit; two-second lock limit. No global timeout changes.
-- The job removes itself after success OR a caught SQL error/statement cancellation.
-- On failure, book changes roll back and the private export summary records the error.
-- Server/connection failures can prevent cleanup; check status before scheduling again.
-- SQL Editor only schedules the work; it does not wait for the publication.
-- https://supabase.com/docs/guides/cron
begin;
set local statement_timeout = '20s';
set local lock_timeout = '2s';

do $schedule$
declare
  v_export private.book_annotation_exports%rowtype;
  v_command text := $command$
set statement_timeout = '5min';
set lock_timeout = '2s';
do $run$
declare
  v_started timestamptz := clock_timestamp();
  v_error_state text;
  v_error_message text;
begin
  -- This exception block rolls back the ENTIRE importer on any caught failure.
  begin
    perform private.apply_book_annotation_import('book-annotations-test-001');
  exception
    when query_canceled then
      v_error_state := sqlstate;
      v_error_message := sqlerrm;
    when others then
      v_error_state := sqlstate;
      v_error_message := sqlerrm;
  end;

  if v_error_state is not null then
    update private.book_annotation_exports set summary = jsonb_build_object(
      'last_background_attempt', jsonb_build_object(
        'status', 'failed', 'started_at', v_started, 'finished_at', clock_timestamp(),
        'sqlstate', v_error_state, 'message', v_error_message
      )
    ) where export_version = 'book-annotations-test-001' and state = 'staging';
  end if;

  -- The catch above lets this cleanup commit even when publication failed.
  perform cron.unschedule('book-annotations-test-001-apply');
end;
$run$;
$command$;
begin
  if current_user <> 'postgres' then
    raise exception 'Schedule this private import as postgres in the SQL Editor';
  end if;
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron is not installed; no job was scheduled';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(19730101, 20261025) then
    raise exception 'An importer transaction is already open; inspect status before retrying';
  end if;
  select * into v_export from private.book_annotation_exports
  where export_version = 'book-annotations-test-001' for update;
  if not found then raise exception 'Export registration is missing'; end if;
  if v_export.state = 'applied' then return; end if;
  if v_export.state <> 'staging'
    or v_export.payload_sha256 <> '1d3eb7bbcef444aba1fe9d2650be8b731d9c35d0338a04707931eef75aa88bea'
    or (v_export.manifest->>'record_count')::bigint is distinct from 116528::bigint then
    raise exception 'Export identity does not match this reviewed delivery';
  end if;
  if (select count(*) from private.book_annotation_import_rows
      where export_version = 'book-annotations-test-001') <> 116528 then
    raise exception 'Staging is incomplete; no job was scheduled';
  end if;
  if exists (select 1 from cron.job where jobname = 'book-annotations-test-001-apply') then
    raise exception 'An import job already exists; inspect status instead of scheduling another';
  end if;
  perform cron.schedule('book-annotations-test-001-apply', '* * * * *', v_command);
end;
$schedule$;
commit;

select jsonb_build_object(
  'export_version', 'book-annotations-test-001',
  'state', (select state from private.book_annotation_exports
    where export_version = 'book-annotations-test-001'),
  'scheduled_job', (select jsonb_build_object(
    'job_id', jobid, 'active', active, 'schedule', schedule, 'database', database, 'role', username
  ) from cron.job where jobname = 'book-annotations-test-001-apply'),
  'next_step', 'Run book-annotation-import-status.sql after the job starts. Cron success alone does not prove publication; check export state and summary.'
) as book_annotation_background_schedule;
