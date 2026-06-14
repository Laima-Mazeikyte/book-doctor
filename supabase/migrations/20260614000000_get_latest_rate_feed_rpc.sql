-- Feed lookup indexes for latest completed request + ranked items
create index if not exists feed_requests_user_status_created_idx
	on public.feed_requests (user_id, status, created_at desc);

create index if not exists feed_items_request_rank_idx
	on public.feed_items (request_id, rank);

-- Eligible books for a completed feed request (excludes rated, bookmarked, not-interested)
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
		on fr.id::text = fi.request_id
	join public.books b
		on b.book_id::text = fi.book_id
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

comment on function public.get_eligible_feed_books(text, integer) is
	'Returns ranked eligible feed books for one completed feed request, excluding user reactions.';

revoke all on function public.get_eligible_feed_books(text, integer) from public;
grant execute on function public.get_eligible_feed_books(text, integer) to authenticated;

-- Latest completed feed request + eligible books in one round trip
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
	with latest as (
		select fr.id
		from public.feed_requests fr
		where auth.uid() is not null
			and fr.user_id = auth.uid()
			and fr.status = 'completed'
		order by fr.created_at desc nulls last
		limit 1
	)
	select
		latest.id as request_id,
		eligible.id,
		eligible.book_id,
		eligible.book_name,
		eligible.author,
		eligible.summary,
		eligible.year,
		eligible.genre1,
		eligible.genre2,
		eligible.genre3,
		eligible.genre4,
		eligible.genre5,
		eligible.genre6,
		eligible.genre7,
		eligible.type,
		eligible.rank
	from latest
	cross join lateral public.get_eligible_feed_books(latest.id::text, p_limit) as eligible;
$$;

comment on function public.get_latest_rate_feed(integer) is
	'Returns eligible books from the user''s latest completed feed request.';

revoke all on function public.get_latest_rate_feed(integer) from public;
grant execute on function public.get_latest_rate_feed(integer) to authenticated;
