-- Single-row feed pointers (latest request + latest completed) for /api/feed/latest cache hints.
create or replace function public.get_feed_request_snapshot()
returns table (
	latest_request_id bigint,
	latest_request_status text,
	latest_completed_request_id bigint
)
language sql
stable
security invoker
set search_path = public
as $$
	select
		latest_any.id as latest_request_id,
		latest_any.status as latest_request_status,
		latest_completed.id as latest_completed_request_id
	from (
		select fr.id, fr.status
		from public.feed_requests fr
		where auth.uid() is not null
			and fr.user_id = auth.uid()
		order by fr.created_at desc nulls last
		limit 1
	) as latest_any
	left join lateral (
		select fr.id
		from public.feed_requests fr
		where auth.uid() is not null
			and fr.user_id = auth.uid()
			and fr.status = 'completed'
		order by fr.created_at desc nulls last
		limit 1
	) as latest_completed on true;
$$;

comment on function public.get_feed_request_snapshot() is
	'Latest feed request metadata for the current user (one row when any feed exists).';

revoke all on function public.get_feed_request_snapshot() from public;
grant execute on function public.get_feed_request_snapshot() to authenticated;

-- Eligible books for one completed request (inlined joins; feed_items.request_id matches feed_requests.id as text).
create or replace function public.get_eligible_feed_books(
	p_request_id text,
	p_limit integer default 100
)
returns table (
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
	select
		b.id,
		b.book_id::text,
		b.book_name,
		b.author,
		b.summary,
		b.year::integer,
		b.genre1,
		b.genre2,
		b.genre3,
		b.genre4,
		b.genre5,
		b.genre6,
		b.genre7,
		b.type,
		fi.rank
	from public.feed_items fi
	join public.feed_requests fr
		on fi.request_id = fr.id::text
	join public.books b
		on fi.book_id = b.book_id::text
	where auth.uid() is not null
		and fr.user_id = auth.uid()
		and fr.status = 'completed'
		and fi.request_id = p_request_id
		and not exists (
			select 1
			from public.user_ratings ur
			where ur.user_id = auth.uid()
				and ur.book_id = b.book_id
		)
		and not exists (
			select 1
			from public.user_bookmarks ub
			where ub.user_id = auth.uid()
				and ub.book_id = b.book_id
		)
		and not exists (
			select 1
			from public.user_not_interested uni
			where uni.user_id = auth.uid()
				and uni.book_id = b.book_id
		)
	order by fi.rank
	limit greatest(p_limit, 1);
$$;

-- Latest completed feed + eligible books in one scan (no nested RPC call).
create or replace function public.get_latest_rate_feed(
	p_limit integer default 20
)
returns table (
	request_id bigint,
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
	with latest_completed as (
		select fr.id
		from public.feed_requests fr
		where auth.uid() is not null
			and fr.user_id = auth.uid()
			and fr.status = 'completed'
		order by fr.created_at desc nulls last
		limit 1
	)
	select
		lc.id as request_id,
		b.id,
		b.book_id::text,
		b.book_name,
		b.author,
		b.summary,
		b.year::integer,
		b.genre1,
		b.genre2,
		b.genre3,
		b.genre4,
		b.genre5,
		b.genre6,
		b.genre7,
		b.type,
		fi.rank
	from latest_completed lc
	join public.feed_items fi
		on fi.request_id = lc.id::text
	join public.books b
		on fi.book_id = b.book_id::text
	where not exists (
			select 1
			from public.user_ratings ur
			where ur.user_id = auth.uid()
				and ur.book_id = b.book_id
		)
		and not exists (
			select 1
			from public.user_bookmarks ub
			where ub.user_id = auth.uid()
				and ub.book_id = b.book_id
		)
		and not exists (
			select 1
			from public.user_not_interested uni
			where uni.user_id = auth.uid()
				and uni.book_id = b.book_id
		)
	order by fi.rank
	limit greatest(p_limit, 1);
$$;

-- Snapshot metadata plus eligible books in one round trip (for /api/feed/latest full load).
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
	),
	eligible as (
		select
			b.id,
			b.book_id::text as book_id,
			b.book_name,
			b.author,
			b.summary,
			b.year::integer as year,
			b.genre1,
			b.genre2,
			b.genre3,
			b.genre4,
			b.genre5,
			b.genre6,
			b.genre7,
			b.type,
			fi.rank
		from latest_completed lc
		join public.feed_items fi
			on fi.request_id = lc.id::text
		join public.books b
			on fi.book_id = b.book_id::text
		where not exists (
				select 1
				from public.user_ratings ur
				where ur.user_id = auth.uid()
					and ur.book_id = b.book_id
			)
			and not exists (
				select 1
				from public.user_bookmarks ub
				where ub.user_id = auth.uid()
					and ub.book_id = b.book_id
			)
			and not exists (
				select 1
				from public.user_not_interested uni
				where uni.user_id = auth.uid()
					and uni.book_id = b.book_id
			)
		order by fi.rank
		limit greatest(p_limit, 1)
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
	left join eligible e on lc.id is not null;
$$;

comment on function public.get_latest_rate_feed_state(integer) is
	'Feed pointers plus eligible books from the latest completed request in one query.';

revoke all on function public.get_latest_rate_feed_state(integer) from public;
grant execute on function public.get_latest_rate_feed_state(integer) to authenticated;

