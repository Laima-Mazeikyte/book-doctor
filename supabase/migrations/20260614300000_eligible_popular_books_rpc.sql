-- Top 100 catalog rows excluding current-user reactions (server-authoritative eligibility).
create or replace function public.get_eligible_top_100_books()
returns table (
	genre text,
	display_order smallint,
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
	type text
)
language sql
stable
security invoker
set search_path = public
as $$
	select
		t.genre,
		t.display_order,
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
		b.type
	from public.top_100_books t
	join public.books b
		on b.book_id = t.book_id
	where auth.uid() is null
		or (
			not exists (
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
		)
	order by t.display_order asc;
$$;

comment on function public.get_eligible_top_100_books() is
	'Returns Top 100 catalog books excluding rated, bookmarked, and not-interested titles for the current user.';

revoke all on function public.get_eligible_top_100_books() from public;
grant execute on function public.get_eligible_top_100_books() to authenticated, anon;

-- Popular feed batch 6+ with reaction exclusions baked in.
create or replace function public.get_eligible_books_excluding_ids(
	p_exclude_ids text[],
	p_limit_count integer default 60
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
	popularity double precision
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
		b.popularity::double precision
	from public.books b
	where (
			p_exclude_ids is null
			or cardinality(p_exclude_ids) = 0
			or b.book_id::text <> all(p_exclude_ids)
		)
		and (
			auth.uid() is null
			or (
				not exists (
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
			)
		)
	order by b.popularity desc nulls last, b.book_id
	limit greatest(p_limit_count, 1);
$$;

comment on function public.get_eligible_books_excluding_ids(text[], integer) is
	'Returns popular-feed fallback books excluding ids and current-user reactions.';

revoke all on function public.get_eligible_books_excluding_ids(text[], integer) from public;
grant execute on function public.get_eligible_books_excluding_ids(text[], integer) to authenticated, anon;
