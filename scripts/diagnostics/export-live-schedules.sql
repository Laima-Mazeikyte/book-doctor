-- Run in the same Supabase project's SQL Editor, using the postgres role.
-- A SINGLE SELECT over cron configuration: no writes and no job execution.
-- pg_cron was confirmed installed by the live schema inventory.
-- Job commands can contain embedded credentials. Export as JSON and save in the
-- ignored temp/live-schedules-export.json file for review, not in migrations.

select jsonb_build_object(
  'format', 'book-doctor-cron-inventory-v1',
  'exported_at', statement_timestamp(),
  'database', current_database(),
  'exported_by', current_user,
  'cron_job_row_security_active', pg_catalog.row_security_active('cron.job'::regclass),
  'job_count', count(*),
  'jobs', coalesce(jsonb_agg(to_jsonb(j) order by j.jobid), '[]'::jsonb)
) as schedule_export
from cron.job j;
