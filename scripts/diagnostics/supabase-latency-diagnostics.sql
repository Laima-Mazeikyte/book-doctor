-- Investigate a recent slow Supabase request without changing the shared database.
-- Run this ENTIRE file in the Supabase web SQL Editor, Database source, as postgres.
-- Return the final one-row supabase_latency_diagnostics JSON and the request's
-- approximate UTC time (plus HTTP duration/request ID if available).
--
-- PostgreSQL 17 / Supabase. Catalogs, statistics, and optional cron history only.
-- No application rows, feed execution, schema changes, resets, or ANALYZE/VACUUM.
-- The transaction is READ ONLY. A session setting carries the report across COMMIT
-- for the SQL Editor's final result; the final SELECT clears that setting.
--
-- IMPORTANT: pg_stat_statements has NO last-execution timestamp or hourly history.
-- Its counters/maxima are NOT filtered to the last hour. An old maximum cannot be
-- attributed to today's request. Current sessions are NOW, not the incident's past.
-- Only cron run timestamps and last-maintenance timestamps provide event dates.
-- Capture this report before running query benchmarks or resetting statistics.

begin read only;
set local statement_timeout = '20s';
set local lock_timeout = '2s';
set local timezone = 'UTC';

do $diagnostics$
declare
  v_captured timestamptz := statement_timestamp();
  -- Optional: replace with the incident's UTC start, e.g. '2026-10-25 18:00:00+00'.
  -- This bounds cron history/maintenance flags only, NOT statement counters.
  v_since timestamptz := statement_timestamp() - interval '1 hour';
  v_pgss_schema text;
  v_pgss_version text;
  v_pgss_info jsonb;
  v_statements jsonb := jsonb_build_object('available', false);
  v_cron jsonb := jsonb_build_object('available', false, 'reason', 'pg_cron history not installed');
  v_report jsonb;
begin
  select n.nspname, e.extversion into v_pgss_schema, v_pgss_version
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_stat_statements';

  if v_pgss_schema is not null then
    begin
      if to_regclass(format('%I.pg_stat_statements_info', v_pgss_schema)) is not null then
        execute format('select to_jsonb(i) from %I.pg_stat_statements_info i', v_pgss_schema)
          into v_pgss_info;
      end if;

      execute format($statements$
        with samples as materialized (
          select s.*, r.rolname as role_name, to_jsonb(s) as raw_stats,
            position('get_rate_feed_bootstrap' in lower(s.query)) > 0
              or position('get_latest_rate_feed_state' in lower(s.query)) > 0
              or position('get_eligible_feed_books' in lower(s.query)) > 0
              or position('user_ratings' in lower(s.query)) > 0
              or position('user_bookmarks' in lower(s.query)) > 0
              or position('user_not_interested' in lower(s.query)) > 0 as feed_or_library
          from %1$I.pg_stat_statements s
          left join pg_catalog.pg_roles r on r.oid = s.userid
          where s.dbid = (select oid from pg_catalog.pg_database where datname = current_database())
            and position('supabase_latency_diagnostics' in lower(coalesce(s.query, ''))) = 0
            and position('pg_stat_statements' in lower(coalesce(s.query, ''))) = 0
        ), rows as materialized (
          select s.*, jsonb_build_object(
            'query_id', queryid::text, 'role', role_name, 'toplevel', toplevel,
            'calls', calls, 'rows', rows,
            'total_exec_ms', round(total_exec_time::numeric, 3),
            'min_exec_ms', round(min_exec_time::numeric, 3),
            'mean_exec_ms', round(mean_exec_time::numeric, 3),
            'max_exec_ms', round(max_exec_time::numeric, 3),
            'stddev_exec_ms', round(stddev_exec_time::numeric, 3),
            'total_plan_ms', round(total_plan_time::numeric, 3),
            'max_plan_ms', round(max_plan_time::numeric, 3),
            'shared_blocks_hit', shared_blks_hit, 'shared_blocks_read', shared_blks_read,
            'temp_blocks_written', temp_blks_written,
            'shared_read_time_ms', coalesce(raw_stats->'shared_blk_read_time', raw_stats->'blk_read_time'),
            'stats_since', raw_stats->'stats_since',
            'minmax_stats_since', raw_stats->'minmax_stats_since',
            'query_preview', case when query ~* '^\s*(with|select|insert|update|delete)\M'
              then left(regexp_replace(query, '\s+', ' ', 'g'), 500)
              else '[utility statement or unavailable SQL; inspect query_id if needed]' end
          ) as payload from samples s
        )
        select jsonb_build_object(
          'available', true,
          'scope', 'Current database; cumulative, not last-hour. Statistics-inspection statements excluded. Previews truncated.',
          'entries', (select count(*) from rows),
          'entries_with_unavailable_sql', (select count(*) from rows where query is null),
          'role_totals_toplevel_only', (
            select coalesce(jsonb_agg(to_jsonb(t) order by total_exec_ms desc), '[]'::jsonb)
            from (
              select role_name as role, count(*) as distinct_statements, sum(calls) as calls,
                round(sum(total_exec_time)::numeric, 3) as total_exec_ms,
                round(max(max_exec_time)::numeric, 3) as largest_statement_max_ms
              from rows where toplevel group by role_name
            ) t
          ),
          'top_total_exec_toplevel', (
            select coalesce(jsonb_agg(payload order by total_exec_time desc), '[]'::jsonb)
            from (select * from rows where toplevel order by total_exec_time desc limit 8) t
          ),
          'top_max_exec_toplevel', (
            select coalesce(jsonb_agg(payload order by max_exec_time desc), '[]'::jsonb)
            from (select * from rows where toplevel order by max_exec_time desc limit 8) t
          ),
          'feed_and_library_including_nested', (
            select coalesce(jsonb_agg(payload order by max_exec_time desc), '[]'::jsonb)
            from (select * from rows where feed_or_library order by max_exec_time desc limit 15) t
          )
        )
      $statements$, v_pgss_schema) into v_statements;
      v_statements := v_statements || jsonb_build_object(
        'extension_version', v_pgss_version, 'schema', v_pgss_schema,
        'global_reset_and_eviction_info', v_pgss_info
      );
    exception
      when insufficient_privilege or undefined_table or object_not_in_prerequisite_state then
        v_statements := jsonb_build_object('available', false, 'reason', sqlerrm);
    end;
  end if;

  if to_regclass('cron.job_run_details') is not null then
    begin
      execute $cron$
        with recent as materialized (
          -- Bound history work through the runid primary key, even on large histories.
          select runid, jobid, database, username, status, start_time, end_time
          from cron.job_run_details order by runid desc limit 100
        )
        select jsonb_build_object(
          'available', true,
          'scope', 'Sample of latest 100 runs across databases, then filtered to this database and incident window; at most 20 shown. No command text.',
          'runs', coalesce((
            select jsonb_agg(to_jsonb(r) order by runid desc) from (
              select *, round(extract(epoch from end_time - start_time) * 1000, 3) as elapsed_ms
              from recent
              where database = current_database()
                and (start_time >= $1 or end_time >= $1 or (start_time is not null and end_time is null))
              order by runid desc limit 20
            ) r
          ), '[]'::jsonb)
        )
      $cron$ into v_cron using v_since;
    exception when insufficient_privilege then
      v_cron := jsonb_build_object('available', false, 'reason', 'No permission to read cron history');
    end;
  end if;

  select jsonb_build_object(
    'environment', jsonb_build_object(
      'captured_at_utc', v_captured, 'incident_window_start_utc', v_since,
      'database', current_database(), 'role', current_user,
      'postgres_version', current_setting('server_version'),
      'server_started_at', pg_postmaster_start_time(), 'in_recovery', pg_is_in_recovery(),
      'transaction_read_only', current_setting('transaction_read_only')
    ),
    'limits', jsonb_build_array(
      'Statement/database counters are cumulative; their old maxima do not date this incident.',
      'Current sessions/waits describe capture time only; idle now does not rule out a past wait.',
      'No users does not exclude Auth, Realtime, cron, autovacuum, dashboard, or platform work.',
      'SQL statistics do not measure browser/network latency or time before Postgres receives work.',
      'Zero planning or I/O time can mean that timing collection is disabled.',
      'Block reads can be served from OS cache; they are not proof of physical disk access.',
      'High variance alone does not prove CPU throttling, pool congestion, or a missing index.',
      'CPU/memory history and the PostgREST pool queue require API logs/metrics, not this SQL report.',
      'Nested statement time overlaps parent time; do not sum both.',
      'Optional cron history visibility follows the SQL role permissions and retention.'
    ),
    'settings', (
      select jsonb_object_agg(name, setting) from pg_catalog.pg_settings
      where name in ('max_connections', 'superuser_reserved_connections', 'reserved_connections',
        'shared_buffers', 'track_activities', 'track_activity_query_size', 'track_counts',
        'track_io_timing', 'track_functions', 'compute_query_id', 'log_min_duration_statement',
        'log_statement', 'pg_stat_statements.track', 'pg_stat_statements.track_planning',
        'pg_stat_statements.max', 'pg_stat_statements.save')
    ),
    'api_role_settings', (
      -- Allowlist: never dump complete rolconfig, which can contain API secrets.
      select coalesce(jsonb_agg(jsonb_build_object('role', r.rolname, 'setting', c.value)
        order by r.rolname, c.value), '[]'::jsonb)
      from pg_catalog.pg_roles r cross join lateral unnest(r.rolconfig) c(value)
      where r.rolname in ('authenticator', 'authenticated', 'anon')
        and split_part(c.value, '=', 1) in ('statement_timeout', 'work_mem',
          'pgrst.server_timing_enabled', 'pgrst.db_plan_enabled', 'pgrst.db_pool',
          'pgrst.db_pool_acquisition_timeout', 'pgrst.db_pool_max_idletime')
    ),
    'statement_statistics', v_statements,
    'database_counters_cumulative', (
      select to_jsonb(d) from pg_catalog.pg_stat_database d where datname = current_database()
    ),
    'current_client_connections_all_databases', (
      select count(*) from pg_catalog.pg_stat_activity where backend_type = 'client backend'
    ),
    'current_sessions_by_role_and_wait', (
      select coalesce(jsonb_agg(to_jsonb(s) order by connections desc), '[]'::jsonb) from (
        select usename as role, application_name, backend_type, state, wait_event_type,
          wait_event, count(*) as connections
        from pg_catalog.pg_stat_activity
        where datname = current_database() and pid <> pg_backend_pid()
        group by usename, application_name, backend_type, state, wait_event_type, wait_event
      ) s
    ),
    'current_active_or_open_transactions', (
      select coalesce(jsonb_agg(to_jsonb(s) order by xact_start nulls last, query_start), '[]'::jsonb) from (
        select pid, usename as role, application_name, backend_type, state,
          wait_event_type, wait_event, query_id::text, backend_start, xact_start,
          query_start, state_change, pg_blocking_pids(pid) as blocking_pids
        from pg_catalog.pg_stat_activity
        where datname = current_database() and pid <> pg_backend_pid()
          and (state = 'active' or state like 'idle in transaction%')
        order by xact_start nulls last, query_start limit 30
      ) s
    ),
    'table_counters_and_latest_maintenance', (
      select coalesce(jsonb_agg(to_jsonb(t) order by schemaname, relname), '[]'::jsonb) from (
        select schemaname, relname, seq_scan, seq_tup_read, idx_scan, n_live_tup, n_dead_tup,
          n_mod_since_analyze, last_vacuum, last_autovacuum, last_analyze, last_autoanalyze,
          vacuum_count, autovacuum_count, analyze_count, autoanalyze_count,
          coalesce(last_vacuum >= v_since or last_autovacuum >= v_since
            or last_analyze >= v_since or last_autoanalyze >= v_since, false) as latest_maintenance_in_window
        from pg_catalog.pg_stat_all_tables
        where (schemaname = 'public' and relname in ('books', 'feed_requests', 'feed_items',
          'user_ratings', 'user_bookmarks', 'user_not_interested'))
          or (schemaname = 'auth' and relname in ('sessions', 'refresh_tokens'))
      ) t
    ),
    'recent_cron_history_sample', v_cron
  ) into v_report;

  perform set_config('book_doctor_diagnostics.supabase_latency_report', v_report::text, false);
end;
$diagnostics$;

commit;

with captured as materialized (
  select nullif(current_setting('book_doctor_diagnostics.supabase_latency_report', true), '')::jsonb as report
)
select report as supabase_latency_diagnostics
from captured
where set_config('book_doctor_diagnostics.supabase_latency_report', '', false) = '';
