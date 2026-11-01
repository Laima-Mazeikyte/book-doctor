-- Optional after successful publication. SQL Editor: Database, postgres.
-- Reclaims the EMPTY staging table's allocated space without dropping its schema.
-- Refuses an open importer transaction or ANY remaining staged rows, across exports.
-- The table lock also prevents a CSV upload racing the emptiness check.
-- Does not truncate books, publication history, or referencing tables. No CASCADE.
begin;
set local statement_timeout = '10s';
set local lock_timeout = '2s';

do $reclaim$
declare
  v_before bigint;
  v_after bigint;
begin
  if current_user <> 'postgres' then
    raise exception 'Run staging maintenance as postgres in the SQL Editor';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(19730101, 20261025) then
    raise exception 'An importer transaction is open; staging maintenance skipped';
  end if;
  lock table private.book_annotation_import_rows in access exclusive mode;
  if exists (select 1 from private.book_annotation_import_rows) then
    raise exception 'Staged rows remain; nothing was truncated';
  end if;

  v_before := pg_catalog.pg_total_relation_size('private.book_annotation_import_rows');
  truncate table only private.book_annotation_import_rows continue identity restrict;
  v_after := pg_catalog.pg_total_relation_size('private.book_annotation_import_rows');

  perform set_config('book_doctor_diagnostics.staging_space_report', jsonb_build_object(
    'bytes_before', v_before, 'bytes_after', v_after,
    'bytes_reclaimed', greatest(v_before - v_after, 0),
    'space_reclaimed', pg_catalog.pg_size_pretty(greatest(v_before - v_after, 0))
  )::text, false);
end;
$reclaim$;
commit;

with captured as materialized (
  select nullif(current_setting('book_doctor_diagnostics.staging_space_report', true), '')::jsonb as report
)
select report as book_annotation_staging_space
from captured
where set_config('book_doctor_diagnostics.staging_space_report', '', false) = '';
