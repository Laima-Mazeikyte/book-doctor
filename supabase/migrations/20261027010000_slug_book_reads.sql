-- Apply after public book slugs and annotated reads; adds the stored address to all feed payloads.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

create or replace function public.get_rate_feed_bootstrap_annotated(p_limit integer default 50)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with me as materialized (
    select auth.uid() as uid
  ), counts as materialized (
    select
      (select count(*) from public.user_ratings
        where user_id = (select uid from me)) as ratings_count,
      (select count(*) from public.user_bookmarks
        where user_id = (select uid from me)) as bookmarks_count,
      (select count(*) from public.user_not_interested
        where user_id = (select uid from me)) as dismissals_count
  ), latest_any as materialized (
    select id, status, error_message from public.feed_requests
    where user_id = (select uid from me)
    order by created_at desc nulls last limit 1
  ), latest_completed as materialized (
    select id, status from public.feed_requests
    where user_id = (select uid from me) and status = 'completed'
    order by created_at desc nulls last limit 1
  ), eligible_books as materialized (
    select b.id, b.book_id, b.slug, b.book_name, b.author, b.summary, b.year::integer,
      b.genre1, b.genre2, b.genre3, b.genre4, b.genre5, b.genre6, b.genre7, b.type, fi.rank,
      b.quality_band, b.book_ranking, b.author_ranking, b.pace_value, b.vocabulary_value, b.depth_value, b.originality_value, b.discussion_potential_value, b.violence_value, b.spice_value, b.atmosphere_value, b.entry_barrier_value, b.keyword1, b.keyword2, b.keyword3, b.keyword4, b.keyword5, b.keyword6, b.keyword7, b.keyword8, b.keyword9, b.keyword10
    from public.feed_items fi
    join public.books b on b.book_id = fi.book_id
    where (select uid from me) is not null
      and fi.request_id = (select id::text from latest_completed)
      and (select ratings_count + bookmarks_count + dismissals_count from counts) >= 1
      and not exists (select 1 from public.user_ratings ur
        where ur.user_id = (select uid from me) and ur.book_id = b.book_id)
      and not exists (select 1 from public.user_bookmarks ub
        where ub.user_id = (select uid from me) and ub.book_id = b.book_id)
      and not exists (select 1 from public.user_not_interested uni
        where uni.user_id = (select uid from me) and uni.book_id = b.book_id)
    order by fi.rank limit greatest($1, 1)
  ), context as (
    select
      c.ratings_count,
      c.ratings_count + c.bookmarks_count + c.dismissals_count as interaction_count,
      a.id::text as mode_request_id,
      nullif(btrim(a.status), '') as mode_request_status,
      a.id::text as latest_request_id,
      nullif(btrim(a.status), '') as latest_request_status,
      nullif(btrim(a.error_message), '') as latest_request_error_message,
      coalesce(lc.id::text, '') as request_id,
      coalesce(lc.status, 'none') as completed_status,
      (select coalesce(jsonb_agg(to_jsonb(b) order by b.rank), '[]'::jsonb)
        from eligible_books b) as books
    from counts c
    left join latest_any a on true
    left join latest_completed lc on true
  )
  select jsonb_build_object(
    'mode', case
      when interaction_count < 1 then 'below_threshold'
      when jsonb_array_length(books) > 0 then 'has_eligible_feed'
      when mode_request_id is not null
        and coalesce(mode_request_status, '') not in ('completed', 'failed', 'skipped')
        then 'feed_generation_pending'
      when mode_request_status in ('failed', 'skipped') then 'feed_error'
      when request_id <> '' then 'feed_exhausted'
      else 'no_feed_yet'
    end,
    'status', case when interaction_count < 1 then 'none' else completed_status end,
    'books', case when interaction_count < 1 then '[]'::jsonb else books end,
    'request_id', case when interaction_count < 1 then '' else request_id end,
    'error_message', null,
    'latest_request_id', latest_request_id,
    'latest_request_status', latest_request_status,
    'latest_request_error_message', latest_request_error_message,
    'ratings_count', ratings_count,
    'interaction_count', interaction_count,
    'eligible_for_feed', interaction_count >= 1
  ) from context;
$function$;

create or replace function public.get_eligible_feed_books_annotated(p_request_id text, p_limit integer default 100)
returns jsonb language sql stable security invoker set search_path = '' as $function$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.rank), '[]'::jsonb) from (
    select b.id, b.book_id, b.slug, b.book_name, b.author, b.summary, b.year::integer, b.genre1, b.genre2, b.genre3, b.genre4, b.genre5, b.genre6, b.genre7, b.type, fi.rank, b.quality_band, b.book_ranking, b.author_ranking, b.pace_value, b.vocabulary_value, b.depth_value, b.originality_value, b.discussion_potential_value, b.violence_value, b.spice_value, b.atmosphere_value, b.entry_barrier_value, b.keyword1, b.keyword2, b.keyword3, b.keyword4, b.keyword5, b.keyword6, b.keyword7, b.keyword8, b.keyword9, b.keyword10
    from public.feed_items fi
    join public.feed_requests fr on fr.id::text = fi.request_id
    join public.books b on b.book_id = fi.book_id
    where (select auth.uid()) is not null and fr.user_id = (select auth.uid())
      and fr.status = 'completed' and fi.request_id = p_request_id
      and not exists (select 1 from public.user_ratings x0 where x0.user_id = (select auth.uid()) and x0.book_id = b.book_id)
    and not exists (select 1 from public.user_bookmarks x1 where x1.user_id = (select auth.uid()) and x1.book_id = b.book_id)
    and not exists (select 1 from public.user_not_interested x2 where x2.user_id = (select auth.uid()) and x2.book_id = b.book_id)
    order by fi.rank limit greatest(p_limit, 1)
  ) r;
$function$;

create or replace function public.get_eligible_top_100_books_annotated()
returns jsonb language sql stable security invoker set search_path = '' as $function$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.display_order), '[]'::jsonb) from (
    select t.genre, t.display_order, b.id, b.book_id, b.slug, b.book_name, b.author, b.summary, b.year::integer, b.genre1, b.genre2, b.genre3, b.genre4, b.genre5, b.genre6, b.genre7, b.type, b.quality_band, b.book_ranking, b.author_ranking, b.pace_value, b.vocabulary_value, b.depth_value, b.originality_value, b.discussion_potential_value, b.violence_value, b.spice_value, b.atmosphere_value, b.entry_barrier_value, b.keyword1, b.keyword2, b.keyword3, b.keyword4, b.keyword5, b.keyword6, b.keyword7, b.keyword8, b.keyword9, b.keyword10
    from public.top_100_books t join public.books b on b.book_id = t.book_id
    where (select auth.uid()) is not null
    and not exists (select 1 from public.user_ratings x0 where x0.user_id = (select auth.uid()) and x0.book_id = b.book_id)
    and not exists (select 1 from public.user_bookmarks x1 where x1.user_id = (select auth.uid()) and x1.book_id = b.book_id)
    and not exists (select 1 from public.user_not_interested x2 where x2.user_id = (select auth.uid()) and x2.book_id = b.book_id)
    order by t.display_order
  ) r;
$function$;

revoke all on function public.get_rate_feed_bootstrap_annotated(integer) from public, anon, authenticated, service_role;
grant execute on function public.get_rate_feed_bootstrap_annotated(integer) to authenticated;
revoke all on function public.get_eligible_feed_books_annotated(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.get_eligible_feed_books_annotated(text, integer) to authenticated;
revoke all on function public.get_eligible_top_100_books_annotated() from public, anon, authenticated, service_role;
grant execute on function public.get_eligible_top_100_books_annotated() to authenticated;

notify pgrst, 'reload schema';
commit;
