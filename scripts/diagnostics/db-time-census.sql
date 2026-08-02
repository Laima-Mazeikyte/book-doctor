-- db-time-census.sql
--
-- "get_latest_rate_feed_state is 12.42% of database time. What is the other 87.58%?"
--
-- Run BLOCK BY BLOCK in the Supabase SQL editor — it shows only the LAST statement's result.
-- Everything here is read-only: catalogs and statistics views only, no DDL, no writes.
-- The single exception is clearly marked at the very bottom and is opt-in.
--
-- Read blocks 0 and 1 before believing any percentage in this file. Both can invalidate the
-- question itself.


-- =====================================================================================
-- BLOCK 0 — Is the denominator even trustworthy?
-- =====================================================================================
-- Three ways "% of database time" can be a lie:
--
--   * WINDOW. pg_stat_statements is cumulative since the last reset. 837 seconds means nothing
--     until you know whether it accumulated over an hour or over three months.
--   * EVICTION. The view holds only `pg_stat_statements.max` distinct statements. Once full,
--     the least-used entries are DISCARDED. If `dealloc` > 0 the totals are missing statements
--     and every percentage computed from them is understated.
--   * TRACK MODE. See block 1.
--
-- WHAT TO LOOK FOR: dealloc = 0, and a stats_reset recent enough to reflect current behaviour.
--                   If dealloc is large, reset the stats (bottom of file) and re-measure later.

select
	i.dealloc as entries_evicted_since_reset,
	i.stats_reset,
	now() - i.stats_reset as measurement_window,
	(select setting from pg_settings where name = 'pg_stat_statements.max') as pgss_max_entries,
	(select count(*) from pg_stat_statements) as entries_currently_held,
	(select setting from pg_settings where name = 'pg_stat_statements.track') as track_mode,
	(select setting from pg_settings where name = 'track_io_timing') as io_timing,
	current_setting('server_version') as pg_version,
	pg_postmaster_start_time() as server_started
from pg_stat_statements_info i;


-- =====================================================================================
-- BLOCK 1 — Top-level vs nested: is the 87% just double-counting?
-- =====================================================================================
-- If pg_stat_statements.track = 'all', statements executed INSIDE functions are recorded
-- separately from the call that invoked them. Summing every row then counts the same work
-- twice: once for `select get_latest_rate_feed_state(...)` and again for each statement in its
-- body. A denominator built that way is inflated, and every share computed against it is
-- deflated.
--
-- This is the most likely explanation for 99.83% (dashboard, probably top-level only) versus
-- 12.42% (my earlier query, which summed everything).
--
-- WHAT TO LOOK FOR: if nested_pct is large, use the toplevel-only figures in block 2 and treat
--                   the 12.42% as wrong. If track = 'top' there are no nested rows and the
--                   12.42% stands — the other 87% is real, other work.

select
	toplevel,
	count(*) as statements,
	sum(calls) as calls,
	round((sum(total_exec_time) / 1000)::numeric, 1) as total_seconds,
	round(
		(100 * sum(total_exec_time) / nullif((select sum(total_exec_time) from pg_stat_statements), 0))::numeric,
		2
	) as pct_of_grand_total
from pg_stat_statements
group by toplevel
order by toplevel desc;


-- ---- 1b. The feed RPC's share computed BOTH ways ---------------------------------------
-- Same statement, two honest denominators. The difference is the artefact.

with grand as (
	select
		sum(total_exec_time) as all_rows,
		sum(total_exec_time) filter (where toplevel) as toplevel_only
	from pg_stat_statements
)
select
	round((sum(s.total_exec_time) / 1000)::numeric, 1) as rpc_total_seconds,
	round((100 * sum(s.total_exec_time) / nullif(g.all_rows, 0))::numeric, 2) as pct_vs_all_rows,
	round((100 * sum(s.total_exec_time) / nullif(g.toplevel_only, 0))::numeric, 2) as pct_vs_toplevel_only
from pg_stat_statements s, grand g
where s.query ilike '%get_latest_rate_feed_state%'
	and s.query not ilike '%pg_stat_statements%'
	and s.toplevel
group by g.all_rows, g.toplevel_only;


-- =====================================================================================
-- BLOCK 2 — The actual answer: top 25 statements by total time
-- =====================================================================================
-- Top-level only, so nothing is double-counted. This is the list that tells you where the
-- database's time really goes.
--
-- WHAT TO LOOK FOR: whether the 87% is ONE more big thing (fixable) or a long flat tail
--                   (means the instance is simply undersized for the workload).
--                   Watch `stddev_ms` — larger than `mean_ms` means throttling/queueing,
--                   not a slow query.

select
	round((100 * total_exec_time / nullif((select sum(total_exec_time) from pg_stat_statements where toplevel), 0))::numeric, 2) as pct,
	round((total_exec_time / 1000)::numeric, 1) as total_s,
	calls,
	round(mean_exec_time::numeric, 1) as mean_ms,
	round(stddev_exec_time::numeric, 1) as stddev_ms,
	round(max_exec_time::numeric, 1) as max_ms,
	rows,
	coalesce(r.rolname, '?') as role,
	left(regexp_replace(s.query, '\s+', ' ', 'g'), 140) as query
from pg_stat_statements s
left join pg_roles r on r.oid = s.userid
where s.toplevel
order by s.total_exec_time desc
limit 25;


-- =====================================================================================
-- BLOCK 3 — Who is spending it? (by role)
-- =====================================================================================
-- On Supabase a large share of database time is usually NOT your app:
--   authenticated / anon  → PostgREST, i.e. your app
--   supabase_admin        → Realtime, Storage, internal jobs
--   authenticator         → PostgREST's own connection/role switching
--   postgres              → SQL editor, dashboard introspection, migrations
--   supabase_auth_admin   → GoTrue (login, token refresh)
--
-- WHAT TO LOOK FOR: if most time sits under supabase_admin or supabase_auth_admin, your app's
--                   queries are a minority tenant and the feed RPC really is your #1 lever.

select
	coalesce(r.rolname, '?') as role,
	count(*) as statements,
	sum(s.calls) as calls,
	round((sum(s.total_exec_time) / 1000)::numeric, 1) as total_s,
	round((100 * sum(s.total_exec_time) / nullif((select sum(total_exec_time) from pg_stat_statements where toplevel), 0))::numeric, 2) as pct
from pg_stat_statements s
left join pg_roles r on r.oid = s.userid
where s.toplevel
group by r.rolname
order by sum(s.total_exec_time) desc;


-- =====================================================================================
-- BLOCK 4 — What kind of work is it? (by subsystem)
-- =====================================================================================
-- PostgREST wraps app traffic recognisably: RPC calls contain `pgrst_call`, table reads
-- contain `_postgrest_t`. Everything else is platform or tooling.
--
-- WHAT TO LOOK FOR: 'Realtime' is the classic silent hog — it polls for changes continuously,
--                   and on a free instance that can dwarf application traffic.

select
	case
		when query ilike '%realtime.%' or query ilike '%list_changes%' then 'Realtime'
		when query ilike '%auth.users%' or query ilike '%refresh_tokens%'
			or query ilike '%auth.sessions%' or query ilike '%auth.identities%' then 'GoTrue / auth'
		when query ilike '%storage.%' then 'Storage'
		when query ilike '%cron.%' then 'pg_cron'
		when query ilike '%pgrst_call%' then 'App RPC (PostgREST)'
		when query ilike '%_postgrest_t%' then 'App table reads (PostgREST)'
		when query ilike '%pg_catalog%' or query ilike '%information_schema%'
			or query ilike '%pg_stat_%' then 'Dashboard / introspection'
		when query ilike 'vacuum%' or query ilike 'analyze%' then 'Maintenance'
		else 'Other'
	end as subsystem,
	count(*) as statements,
	sum(calls) as calls,
	round((sum(total_exec_time) / 1000)::numeric, 1) as total_s,
	round((100 * sum(total_exec_time) / nullif((select sum(total_exec_time) from pg_stat_statements where toplevel), 0))::numeric, 2) as pct
from pg_stat_statements
where toplevel
group by 1
order by sum(total_exec_time) desc;


-- =====================================================================================
-- BLOCK 5 — Three other lenses
-- =====================================================================================
-- Total time hides two failure modes: something slow but rare, and something fast but
-- relentless. Both matter for a shared-CPU instance.

-- 5a. Slowest per call (min 20 calls, so one-off migrations don't pollute it)
select
	round(mean_exec_time::numeric, 1) as mean_ms,
	round(max_exec_time::numeric, 1) as max_ms,
	calls,
	round((total_exec_time / 1000)::numeric, 1) as total_s,
	left(regexp_replace(query, '\s+', ' ', 'g'), 120) as query
from pg_stat_statements
where toplevel and calls >= 20
order by mean_exec_time desc
limit 15;

-- 5b. Chattiest — a 2ms query called 500k times is 1000 seconds
select
	calls,
	round(mean_exec_time::numeric, 2) as mean_ms,
	round((total_exec_time / 1000)::numeric, 1) as total_s,
	left(regexp_replace(query, '\s+', ' ', 'g'), 120) as query
from pg_stat_statements
where toplevel
order by calls desc
limit 15;

-- 5c. Heaviest on I/O and on temp spills (temp_blks > 0 means it spilled to disk —
--     on a 0.5GB free instance that is often the real cause of multi-second outliers)
select
	round((total_exec_time / 1000)::numeric, 1) as total_s,
	calls,
	shared_blks_read as disk_blocks_read,
	shared_blks_hit as cache_blocks_hit,
	temp_blks_read + temp_blks_written as temp_blocks,
	left(regexp_replace(query, '\s+', ' ', 'g'), 110) as query
from pg_stat_statements
where toplevel and (shared_blks_read > 0 or temp_blks_written > 0)
order by (shared_blks_read + temp_blks_read + temp_blks_written) desc
limit 15;


-- =====================================================================================
-- BLOCK 6 — Instance health, independent of any single query
-- =====================================================================================
-- Confirms or kills the "the instance is starved, not the query" theory.
--
-- WHAT TO LOOK FOR: cache_hit_pct below ~99 means the working set no longer fits in RAM.
--                   Non-zero temp_files means queries are spilling to disk.
--                   Non-zero deadlocks or high conflicts means contention.

select
	numbackends as current_connections,
	round(100.0 * blks_hit / nullif(blks_hit + blks_read, 0), 2) as cache_hit_pct,
	blks_read as disk_reads,
	temp_files,
	pg_size_pretty(temp_bytes) as temp_written,
	deadlocks,
	xact_commit,
	xact_rollback,
	stats_reset
from pg_stat_database
where datname = current_database();


-- ---- 6b. Connection census -------------------------------------------------------------
-- Free tier caps connections hard. Saturation shows up as client-side latency with no
-- corresponding slow query — exactly the profile in the browser trace.

select
	coalesce(application_name, '(none)') as application_name,
	state,
	count(*) as connections,
	max(now() - state_change) as longest_in_state
from pg_stat_activity
where datname = current_database()
group by 1, 2
order by connections desc;


-- ---- 6c. What is the server waiting on right now? --------------------------------------
-- Most useful if you run it DURING a slow period. Lots of LWLock / BufferPin / IO waits =
-- resource starvation. Empty result = the instance is idle and the problem is elsewhere.

select
	wait_event_type,
	wait_event,
	count(*) as sessions,
	max(now() - query_start) as longest_running
from pg_stat_activity
where datname = current_database()
	and state = 'active'
	and pid <> pg_backend_pid()
group by 1, 2
order by sessions desc;


-- =====================================================================================
-- BLOCK 7 — Tables doing more work than they should
-- =====================================================================================
-- A table with millions of sequential scans is a missing index somewhere you have not looked
-- yet. n_dead_tup high with an old last_autovacuum means bloat, which makes everything slower.

select
	relname as table_name,
	seq_scan,
	seq_tup_read,
	idx_scan,
	case
		when seq_scan + coalesce(idx_scan, 0) = 0 then null
		else round(100.0 * seq_scan / (seq_scan + coalesce(idx_scan, 0)), 1)
	end as pct_seq_scans,
	n_live_tup,
	n_dead_tup,
	last_autovacuum,
	last_autoanalyze
from pg_stat_user_tables
order by seq_tup_read desc nulls last
limit 20;


-- =====================================================================================
-- BLOCK 8 — Optional: start a clean measurement window
-- =====================================================================================
-- Only if block 0 showed a stale stats_reset or a non-zero dealloc. This discards ALL query
-- STATISTICS for the project — statistics only, no data of any kind is touched. It is the one
-- statement in this file that changes anything.
--
-- After running it, use the app normally for a day, then re-run blocks 2–4 for numbers that
-- describe current behaviour rather than everything since the project was created.
--
--   select pg_stat_statements_reset();
