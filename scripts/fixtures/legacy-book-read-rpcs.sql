-- Test fixture: four legacy read RPCs used by test-book-annotations-db.mjs.
-- Loaded only into its disposable Docker database after synthetic tables/RLS setup.
-- Snapshot of the pre-annotation contracts; no live data, integrations, grants or secrets.
-- This is not a migration, full application baseline, or production installation script.
-- Keep this independent snapshot stable: the test verifies forward migrations preserve it.

CREATE OR REPLACE FUNCTION public.get_books_excluding_ids(p_exclude_ids text[], p_limit_count integer DEFAULT 60)
 RETURNS TABLE(id uuid, book_id text, book_name text, author text, summary text, year integer, genre1 text, genre2 text, genre3 text, genre4 text, genre5 text, genre6 text, genre7 text, type text, popularity double precision)
 LANGUAGE sql
 STABLE
AS $function$
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
  order by b.popularity desc nulls last, b.book_id
  limit greatest(p_limit_count, 1);
$function$;

CREATE OR REPLACE FUNCTION public.get_eligible_feed_books(p_request_id text, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, book_id text, book_name text, author text, summary text, year integer, genre1 text, genre2 text, genre3 text, genre4 text, genre5 text, genre6 text, genre7 text, type text, rank integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_eligible_top_100_books()
 RETURNS TABLE(genre text, display_order smallint, id uuid, book_id text, book_name text, author text, summary text, year integer, genre1 text, genre2 text, genre3 text, genre4 text, genre5 text, genre6 text, genre7 text, type text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_latest_rate_feed_state(p_limit integer DEFAULT 20)
 RETURNS TABLE(latest_request_id bigint, latest_request_status text, latest_completed_request_id bigint, id uuid, book_id text, book_name text, author text, summary text, year integer, genre1 text, genre2 text, genre3 text, genre4 text, genre5 text, genre6 text, genre7 text, type text, rank integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
	with latest_any as (
		select fr.id, fr.status from public.feed_requests fr
		where auth.uid() is not null and fr.user_id = auth.uid()
		order by fr.created_at desc nulls last limit 1
	),
	latest_completed as (
		select fr.id from public.feed_requests fr
		where auth.uid() is not null and fr.user_id = auth.uid() and fr.status = 'completed'
		order by fr.created_at desc nulls last limit 1
	)
	select
		la.id as latest_request_id, la.status as latest_request_status, lc.id as latest_completed_request_id,
		e.id, e.book_id, e.book_name, e.author, e.summary, e.year,
		e.genre1, e.genre2, e.genre3, e.genre4, e.genre5, e.genre6, e.genre7, e.type, e.rank
	from latest_any la
	left join latest_completed lc on true
	left join lateral public.get_eligible_feed_books(lc.id::text, p_limit) e on lc.id is not null;
$function$;
