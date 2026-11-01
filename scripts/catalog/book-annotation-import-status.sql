-- After an apply timeout, run in SQL Editor: Database, postgres.
-- One read-only SELECT. No importer execution, cancellation, advisory-lock
-- acquisition, book scan, role changes, or session/query text returned.
-- Publication state and staging count use the statement snapshot. Live lock/session
-- details are a capture-time observation, not a historical record of the timeout.
-- The importer holds this advisory lock until its whole transaction finishes.
with parameters(export_version) as (
  values ('book-annotations-test-001'::text)
), importer_sessions as (
  select l.pid, l.granted as import_lock_granted,
    a.state, a.wait_event_type, a.wait_event,
    a.xact_start, a.query_start,
    pg_catalog.pg_blocking_pids(l.pid) as blocking_pids
  from pg_catalog.pg_locks l
  left join pg_catalog.pg_stat_activity a on a.pid = l.pid
  where l.locktype = 'advisory'
    and l.database = (select oid from pg_catalog.pg_database where datname = current_database())
    and l.classid = 19730101::oid and l.objid = 20261025::oid and l.objsubid = 2
)
select jsonb_build_object(
  'captured_at_utc', statement_timestamp() at time zone 'UTC',
  'export_version', p.export_version,
  'export_found', e.export_version is not null,
  'state', e.state,
  'expected_books', (e.manifest->>'record_count')::bigint,
  'applied_at', e.applied_at,
  'summary', e.summary,
  'remaining_staged_books', (select count(*) from private.book_annotation_import_rows s
    where s.export_version = p.export_version),
  'importer_transactions', (select coalesce(jsonb_agg(to_jsonb(s) order by pid), '[]'::jsonb)
    from importer_sessions s)
) as book_annotation_import_status
from parameters p
left join private.book_annotation_exports e using (export_version);
