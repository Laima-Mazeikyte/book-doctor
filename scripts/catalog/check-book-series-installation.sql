-- Before retrying an installation, or after a SQL Editor timeout/NetworkError.
-- Database / postgres. One read-only catalog SELECT; no book scans or changes.
-- A missing slug column and NULL series objects are expected after the reported
-- prerequisite failure. Installed objects use this statement's catalog snapshot.
-- Sessions/locks describe capture time only. SQL-text matches are hints, not proof
-- of identity; unrelated schema work can also hold an AccessExclusiveLock on books.
-- No query text, book rows, cancellation or lock acquisition is performed.
with session_locks as materialized (
  select l.pid,
    bool_or(l.locktype = 'advisory' and l.classid = 20261027::oid
      and l.objid = 1::oid and l.objsubid = 2) as slug_allocation_lock,
    bool_or(l.locktype = 'advisory' and l.classid = 20261027::oid
      and l.objid = 2::oid and l.objsubid = 2) as slug_background_install_lock,
    bool_or(l.locktype = 'relation' and l.relation = 'public.books'::regclass
      and l.mode = 'AccessExclusiveLock') as catalog_schema_lock,
    bool_or(not l.granted) as waiting_for_lock
  from pg_catalog.pg_locks l
  where l.database = (select oid from pg_catalog.pg_database where datname = current_database())
    and l.pid <> pg_backend_pid()
  group by l.pid
), observed as materialized (
  select a.pid, a.usename as role, a.state, a.xact_start, a.query_start,
    a.wait_event_type, a.wait_event, pg_catalog.pg_blocking_pids(a.pid) as blocking_pids,
    coalesce(l.slug_allocation_lock, false) as slug_allocation_lock,
    coalesce(l.slug_background_install_lock, false) as slug_background_install_lock,
    coalesce(l.catalog_schema_lock, false) as catalog_schema_lock,
    coalesce(l.waiting_for_lock, false) as waiting_for_lock
  from pg_catalog.pg_stat_activity a left join session_locks l using (pid)
  where a.datname = current_database() and a.pid <> pg_backend_pid()
    and (l.slug_allocation_lock or l.slug_background_install_lock or l.catalog_schema_lock
      or (a.state in ('active', 'idle in transaction', 'idle in transaction (aborted)')
        and (position('assign_book_slug' in lower(coalesce(a.query, ''))) > 0
          or position('private.book_slug_' in lower(coalesce(a.query, ''))) > 0
          or position('add column slug' in lower(coalesce(a.query, ''))) > 0)))
)
select jsonb_build_object(
  'database', current_database(),
  'captured_at_utc', statement_timestamp() at time zone 'UTC',
  'slug_column_present', exists (
    select 1 from pg_catalog.pg_attribute where attrelid = 'public.books'::regclass
      and attname = 'slug' and attnum > 0 and not attisdropped
  ),
  'slug_column_not_null', coalesce((
    select attnotnull from pg_catalog.pg_attribute where attrelid = 'public.books'::regclass
      and attname = 'slug' and attnum > 0 and not attisdropped
  ), false),
  'slug_unique_index_valid', exists (
    select 1 from pg_catalog.pg_index where indexrelid = to_regclass('public.books_slug_key')
      and indisunique and indisvalid and indisready
  ),
  'slug_allocation_trigger_present', exists (
    select 1 from pg_catalog.pg_trigger where tgrelid = 'public.books'::regclass
      and tgname = 'assign_book_slug' and not tgisinternal and tgenabled <> 'D'
  ),
  'series_table', to_regclass('public.book_series')::text,
  'membership_table', to_regclass('public.book_series_members')::text,
  'series_detail_rpc', to_regprocedure('public.get_book_detail_with_series(text)')::text,
  'annotation_importer', to_regprocedure('private.apply_book_annotation_import(text)')::text,
  'observed_migration_sessions', (select coalesce(jsonb_agg(to_jsonb(s) order by pid), '[]'::jsonb)
    from observed s),
  'observation_scope', 'Committed catalog snapshot and capture-time sessions/lock hints only; no book scan. Empty sessions are not historical proof of cancellation.'
) as book_series_installation_status;
