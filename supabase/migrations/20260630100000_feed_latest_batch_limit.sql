-- Align get_latest_rate_feed_state default with feed backend batch size (50 books per request).

create or replace function public.get_latest_rate_feed_state(
	p_limit integer default 50
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
	'Feed pointers plus eligible books from the latest completed request in one query. Default limit matches feed backend batch size (50).';
