-- confirm-feed-rpc-cost.sql
--
-- Confirms (or refutes) why get_latest_rate_feed_state accounts for 99.83% of database time.
--
-- Run BLOCK BY BLOCK in the Supabase SQL editor — it shows only the LAST statement's result,
-- so running the whole file at once hides everything but the final query.
--
-- Everything here is read-only. Blocks 2–5 wrap themselves in an explicit transaction and end
-- with ROLLBACK; no DDL, no writes, nothing to undo.
--
-- Each block states what would CONFIRM and what would REFUTE the hypothesis. Read those before
-- deciding anything — block 1 can kill the main suspect outright.


-- =====================================================================================
-- BLOCK 1 — Ground truth: what are the join-key types actually?
-- =====================================================================================
-- The whole "the ::text cast forces a seq scan" theory rests on books.book_id NOT already
-- being text. If it is text, `b.book_id::text` is a no-op the planner elides, index usage is
-- fine, and that suspect is dead — move to block 4 (auth.uid()) and block 5 (RLS) instead.
--
-- CONFIRMS the cast theory: books.book_id is anything other than text/varchar
--                           (e.g. integer, bigint, uuid) while feed_items.book_id is text.
-- REFUTES it:               books.book_id and feed_items.book_id are both text.
--
-- This was checked empirically against a scratch Postgres 15 with both columns as text and a
-- unique index on books(book_id): the planner elided `b.book_id::text` and used
-- `Index Scan using books_book_id_key`. So if both sides are already text, the cast costs
-- nothing and suspect #1 is dead — skip to blocks 4 and 6.

select
	table_name,
	column_name,
	data_type,
	udt_name
from information_schema.columns
where table_schema = 'public'
	and table_name in (
		'books', 'feed_items', 'feed_requests',
		'user_ratings', 'user_bookmarks', 'user_not_interested'
	)
	and column_name in ('id', 'book_id', 'request_id', 'user_id')
order by table_name, column_name;


-- ---- 1b. Indexes on the join keys -----------------------------------------------------
-- Looking for: an index on books(book_id), feed_items(request_id, rank),
-- user_ratings(user_id, book_id) and friends. Note whether any is an EXPRESSION index on
-- (book_id::text) — that would rescue the cast.

select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
	and tablename in (
		'books', 'feed_items', 'feed_requests',
		'user_ratings', 'user_bookmarks', 'user_not_interested'
	)
order by tablename, indexname;


-- ---- 1c. Table sizes ------------------------------------------------------------------
-- A seq scan of books only matters if books is big. reltuples is an estimate from the last
-- ANALYZE — cheap, no full scan.

select
	c.relname as table_name,
	c.reltuples::bigint as approx_rows,
	pg_size_pretty(pg_total_relation_size(c.oid)) as total_size
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
	and c.relkind = 'r'
	and c.relname in (
		'books', 'feed_items', 'feed_requests',
		'user_ratings', 'user_bookmarks', 'user_not_interested'
	)
order by c.reltuples desc;


-- ---- 1d. RLS policies -----------------------------------------------------------------
-- get_eligible_feed_books is SECURITY INVOKER, so every policy below is evaluated per row.
-- A policy whose USING expression contains a subquery is a per-row query — that alone can
-- explain the cost.

select
	tablename,
	policyname,
	cmd as command,
	roles,
	qual as using_expression
from pg_policies
where schemaname = 'public'
	and tablename in (
		'books', 'feed_items', 'feed_requests',
		'user_ratings', 'user_bookmarks', 'user_not_interested'
	)
order by tablename, policyname;

-- ...and whether RLS is switched on for each table at all.
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
	and c.relkind = 'r'
	and c.relname in (
		'books', 'feed_items', 'feed_requests',
		'user_ratings', 'user_bookmarks', 'user_not_interested'
	)
order by c.relname;


-- =====================================================================================
-- BLOCK 2 — Impersonate a real user, and PROVE the impersonation worked
-- =====================================================================================
-- This is the step the earlier EXPLAIN runs missed. `set role authenticated` does NOT
-- populate request.jwt.claims, so auth.uid() returns NULL, the function's
-- `where auth.uid() is not null` guard short-circuits, and you measure an empty query.
--
-- set_config(..., true) is the transaction-local form, so it takes a subquery result and
-- picks the test user automatically — no UUID to paste.
--
-- EXPECT: impersonating_user_id is NOT NULL and test_request_id is NOT NULL.
--         If either is null, STOP — nothing below this will mean anything.

begin;

select set_config(
	'request.jwt.claims',
	json_build_object('sub', fr.user_id, 'role', 'authenticated')::text,
	true
)
from public.feed_requests fr
where fr.status = 'completed'
order by fr.created_at desc nulls last
limit 1;

set local role authenticated;

select
	auth.uid() as impersonating_user_id,
	(
		select fr.id
		from public.feed_requests fr
		where fr.user_id = auth.uid() and fr.status = 'completed'
		order by fr.created_at desc nulls last
		limit 1
	) as test_request_id;

rollback;


-- =====================================================================================
-- BLOCK 3 — The real end-to-end cost of the RPC
-- =====================================================================================
-- This gives the honest total: what PostgREST actually pays per call, for one real user.
-- Compare its `Execution Time` against the 515ms production mean.
--
-- It will NOT show you inner plan nodes. Both functions are declared
-- `set search_path = public`, and a SQL function carrying a SET clause can never be inlined
-- by the planner — so you get one opaque `Function Scan`. That is expected; block 3b below
-- reconstructs the same query by hand so the nodes are visible.

begin;

select set_config(
	'request.jwt.claims',
	json_build_object('sub', fr.user_id, 'role', 'authenticated')::text,
	true
)
from public.feed_requests fr
where fr.status = 'completed'
order by fr.created_at desc nulls last
limit 1;

set local role authenticated;

explain (analyze, buffers, verbose, settings)
select * from public.get_latest_rate_feed_state(20);

rollback;


-- =====================================================================================
-- BLOCK 3b — The same query, hand-inlined, so you can see the plan
-- =====================================================================================
-- Verbatim reproduction of what get_eligible_feed_books does today, casts and per-row
-- auth.uid() included. This is the BASELINE that blocks 4 and 5 are measured against.
--
-- CONFIRMS the cast theory:  `Seq Scan on books` with `actual rows` in the thousands.
-- CONFIRMS the auth.uid() theory: the NOT EXISTS nodes show high `loops=`, or you see
--                            `Filter: (uid() = ...)` being re-evaluated per row.
-- REFUTES both:              index scans throughout and a total in the low tens of ms — in
--                            which case the plan is fine and the 515ms mean is CPU
--                            contention on the shared free-tier instance. Go to block 6.

begin;

select set_config(
	'request.jwt.claims',
	json_build_object('sub', fr.user_id, 'role', 'authenticated')::text,
	true
)
from public.feed_requests fr
where fr.status = 'completed'
order by fr.created_at desc nulls last
limit 1;

set local role authenticated;

explain (analyze, buffers, verbose)
select
	b.id, b.book_id::text, b.book_name, b.author, b.summary, b.year::integer,
	b.genre1, b.genre2, b.genre3, b.genre4, b.genre5, b.genre6, b.genre7, b.type,
	fi.rank
from public.feed_items fi
join public.feed_requests fr
	on fi.request_id = fr.id::text
join public.books b
	on fi.book_id = b.book_id::text
where auth.uid() is not null
	and fr.user_id = auth.uid()
	and fr.status = 'completed'
	and fi.request_id = (
		select fr2.id::text
		from public.feed_requests fr2
		where fr2.user_id = auth.uid() and fr2.status = 'completed'
		order by fr2.created_at desc nulls last
		limit 1
	)
	and not exists (
		select 1 from public.user_ratings ur
		where ur.user_id = auth.uid() and ur.book_id = b.book_id
	)
	and not exists (
		select 1 from public.user_bookmarks ub
		where ub.user_id = auth.uid() and ub.book_id = b.book_id
	)
	and not exists (
		select 1 from public.user_not_interested uni
		where uni.user_id = auth.uid() and uni.book_id = b.book_id
	)
order by fi.rank
limit 20;

rollback;


-- =====================================================================================
-- BLOCK 4 — A/B: does hoisting auth.uid() help?
-- =====================================================================================
-- Same work, but auth.uid() is evaluated once as an InitPlan via `(select auth.uid())`
-- instead of per row inside each correlated NOT EXISTS. This is the standard Supabase RLS
-- fix. Valid regardless of what block 1 said about column types.
--
-- NOTE: this variant changes TWO things at once — it also drops the
-- `join feed_requests fr on fi.request_id = fr.id::text`, which is redundant once
-- `fi.request_id` is pinned to a constant. So a win here is the two combined. If it wins big,
-- split them before writing the migration to see which one earned it.
--
-- Compare this total time against BLOCK 3b's (the hand-inlined baseline — block 3 is opaque
-- and not comparable). A large drop means the fix is worth a migration.
--
-- Nothing is created or altered — this is the candidate query inlined, not a new function.

begin;

select set_config(
	'request.jwt.claims',
	json_build_object('sub', fr.user_id, 'role', 'authenticated')::text,
	true
)
from public.feed_requests fr
where fr.status = 'completed'
order by fr.created_at desc nulls last
limit 1;

set local role authenticated;

explain (analyze, buffers, verbose)
with me as materialized (
	select auth.uid() as uid
),
req as materialized (
	select fr.id
	from public.feed_requests fr
	where fr.user_id = (select uid from me)
		and fr.status = 'completed'
	order by fr.created_at desc nulls last
	limit 1
)
select
	b.id, b.book_id::text, b.book_name, b.author, b.summary, b.year::integer,
	b.genre1, b.genre2, b.genre3, b.genre4, b.genre5, b.genre6, b.genre7, b.type,
	fi.rank
from public.feed_items fi
join public.books b on fi.book_id = b.book_id::text
where fi.request_id = (select id::text from req)
	and not exists (
		select 1 from public.user_ratings ur
		where ur.user_id = (select uid from me) and ur.book_id = b.book_id
	)
	and not exists (
		select 1 from public.user_bookmarks ub
		where ub.user_id = (select uid from me) and ub.book_id = b.book_id
	)
	and not exists (
		select 1 from public.user_not_interested uni
		where uni.user_id = (select uid from me) and uni.book_id = b.book_id
	)
order by fi.rank
limit 20;

rollback;


-- =====================================================================================
-- BLOCK 5 — A/B: does dropping the ::text cast help?
-- =====================================================================================
-- ONLY RUN THIS IF BLOCK 1 SHOWED books.book_id AND feed_items.book_id ARE THE SAME TYPE.
-- If they differ, this block will throw a type error — which is itself the answer: the cast
-- is load-bearing, and the fix is to align the column types (or add an expression index on
-- books((book_id::text))), not to delete the cast.
--
-- Identical to block 4 except the join has no cast. Compare all three totals:
--   block 3 = today,  block 4 = auth.uid() hoisted,  block 5 = hoisted + no cast.

begin;

select set_config(
	'request.jwt.claims',
	json_build_object('sub', fr.user_id, 'role', 'authenticated')::text,
	true
)
from public.feed_requests fr
where fr.status = 'completed'
order by fr.created_at desc nulls last
limit 1;

set local role authenticated;

explain (analyze, buffers, verbose)
with me as materialized (
	select auth.uid() as uid
),
req as materialized (
	select fr.id
	from public.feed_requests fr
	where fr.user_id = (select uid from me)
		and fr.status = 'completed'
	order by fr.created_at desc nulls last
	limit 1
)
select
	b.id, b.book_id::text, b.book_name, b.author, b.summary, b.year::integer,
	b.genre1, b.genre2, b.genre3, b.genre4, b.genre5, b.genre6, b.genre7, b.type,
	fi.rank
from public.feed_items fi
join public.books b on b.book_id = fi.book_id          -- no cast on the books side
where fi.request_id = (select id::text from req)
	and not exists (
		select 1 from public.user_ratings ur
		where ur.user_id = (select uid from me) and ur.book_id = b.book_id
	)
	and not exists (
		select 1 from public.user_bookmarks ub
		where ub.user_id = (select uid from me) and ub.book_id = b.book_id
	)
	and not exists (
		select 1 from public.user_not_interested uni
		where uni.user_id = (select uid from me) and uni.book_id = b.book_id
	)
order by fi.rank
limit 20;

rollback;


-- =====================================================================================
-- BLOCK 6 — How much of the 515ms is contention rather than the plan?
-- =====================================================================================
-- If blocks 3–5 all come back fast (tens of ms) while production still averages 515ms, the
-- query is fine and the instance is starved. This shows the spread: a mean far above the
-- median is the signature of throttling / queueing, not of a bad plan.

-- Column names are the PG13+ spelling. If this errors with "column does not exist", the
-- extension is older — drop the `_exec` and use mean_time / min_time / max_time / total_time.
--
-- The percentage divides by a scalar subquery over the WHOLE table, not a window over the
-- filtered rows, so it really is "share of all database time".

select
	calls,
	round(mean_exec_time::numeric, 1) as mean_ms,
	round(min_exec_time::numeric, 1) as min_ms,
	round(max_exec_time::numeric, 1) as max_ms,
	round(stddev_exec_time::numeric, 1) as stddev_ms,
	round(total_exec_time::numeric / 1000, 1) as total_seconds,
	round(
		(100 * total_exec_time / nullif((select sum(total_exec_time) from pg_stat_statements), 0))::numeric,
		2
	) as pct_of_all_db_time
from pg_stat_statements
where query ilike '%get_latest_rate_feed_state%'
	and query not ilike '%pg_stat_statements%'
order by total_exec_time desc
limit 5;


-- ---- 6b. Reset the counters, then re-measure after a fix ------------------------------
-- Run this ONLY when you want a clean before/after. It discards all query statistics for the
-- project (statistics only — no data is touched). Re-run block 6 a day later to compare.
--
--   select pg_stat_statements_reset();
