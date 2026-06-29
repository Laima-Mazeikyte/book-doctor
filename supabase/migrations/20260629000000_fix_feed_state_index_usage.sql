-- Fix: get_latest_rate_feed_state sequentially scanned feed_items (~677ms) because it joined
-- feed_items to a materialized CTE (`fi.request_id = latest_completed.id::text`). The planner
-- cannot turn a value coming from a materialized CTE into an index condition, so it fell back
-- to a hash join + full Seq Scan of feed_items — ignoring feed_items_request_rank_idx.
--
-- Reuse get_eligible_feed_books, which takes request_id as a SCALAR parameter
-- (`fi.request_id = p_request_id`); a constant predicate lets the planner use the existing
-- (request_id, rank) index for both the lookup and the ordering. Identical return signature,
-- so no application change. Expected: ~828ms -> tens of ms, and flat as feed_items grows.

create or replace function public.get_latest_rate_feed_state(
	p_limit integer default 20
)
returns table (
	latest_request_id bigint,
	latest_request_status text,
	latest_completed_request_id bigint,
	id uuid,
	book_id text,
	book_name text,
	author text,
	summary text,
	year integer,
	genre1 text,
	genre2 text,
	genre3 text,
	genre4 text,
	genre5 text,
	genre6 text,
	genre7 text,
	type text,
	rank integer
)
language sql
stable
security invoker
set search_path = public
as $$
	with latest_any as (
		select fr.id, fr.status
		from public.feed_requests fr
		where auth.uid() is not null
			and fr.user_id = auth.uid()
		order by fr.created_at desc nulls last
		limit 1
	),
	latest_completed as (
		select fr.id
		from public.feed_requests fr
		where auth.uid() is not null
			and fr.user_id = auth.uid()
			and fr.status = 'completed'
		order by fr.created_at desc nulls last
		limit 1
	)
	select
		la.id as latest_request_id,
		la.status as latest_request_status,
		lc.id as latest_completed_request_id,
		e.id,
		e.book_id,
		e.book_name,
		e.author,
		e.summary,
		e.year,
		e.genre1,
		e.genre2,
		e.genre3,
		e.genre4,
		e.genre5,
		e.genre6,
		e.genre7,
		e.type,
		e.rank
	from latest_any la
	left join latest_completed lc on true
	left join lateral public.get_eligible_feed_books(lc.id::text, p_limit) e
		on lc.id is not null;
$$;

comment on function public.get_latest_rate_feed_state(integer) is
	'Feed pointers plus eligible books from the latest completed request in one query. Books come from get_eligible_feed_books (scalar request_id) so feed_items uses its (request_id, rank) index instead of a seq scan.';

revoke all on function public.get_latest_rate_feed_state(integer) from public;
grant execute on function public.get_latest_rate_feed_state(integer) to authenticated;
