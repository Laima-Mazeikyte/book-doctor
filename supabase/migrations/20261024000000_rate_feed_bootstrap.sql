-- Step 1C: install the consolidated feed read after the read-only comparisons.
-- Run this ENTIRE file once in the Supabase web SQL Editor as postgres.
-- Creates only public.get_rate_feed_bootstrap(integer) and its permissions.
-- Existing functions, tables, policies, data, and endpoint behavior remain intact.
-- CREATE FUNCTION deliberately fails if this signature already exists.

begin;
set local lock_timeout = '2s';
set local statement_timeout = '10s';

create function public.get_rate_feed_bootstrap(p_limit integer default 50)
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
    select b.id, b.book_id, b.book_name, b.author, b.summary, b.year::integer,
      b.genre1, b.genre2, b.genre3, b.genre4, b.genre5, b.genre6, b.genre7, b.type, fi.rank
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

comment on function public.get_rate_feed_bootstrap(integer) is
  'Read-only account-scoped rate-feed bootstrap: exact counts, request pointers/status, and eligible catalog rows in one RPC. SECURITY INVOKER preserves table RLS. Books are mapped by the application server.';

-- Signed-in anonymous Supabase users also use the authenticated database role.
-- Clear standard default execution grants before enabling the intended caller.
revoke all on function public.get_rate_feed_bootstrap(integer) from public, anon, authenticated, service_role;
grant execute on function public.get_rate_feed_bootstrap(integer) to authenticated;

do $permissions$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    where p.oid = 'public.get_rate_feed_bootstrap(integer)'::regprocedure
      and acl.privilege_type = 'EXECUTE'
      and acl.grantee not in (p.proowner, 'authenticated'::regrole::oid)
  ) then
    raise exception 'Unexpected default execution grant on get_rate_feed_bootstrap; installation rolled back.';
  end if;
end;
$permissions$;

-- https://docs.postgrest.org/en/stable/references/schema_cache.html
notify pgrst, 'reload schema';
commit;

select pg_catalog.jsonb_build_object(
  'function', p.oid::regprocedure::text,
  'arguments', pg_catalog.pg_get_function_arguments(p.oid),
  'result', pg_catalog.pg_get_function_result(p.oid),
  'security_definer', p.prosecdef,
  'volatility', p.provolatile,
  'settings', p.proconfig,
  'authenticated_can_execute', pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
  'anon_can_execute', pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
  'public_can_execute', exists (
    select 1 from pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  )
) as rate_feed_bootstrap_installation
from pg_catalog.pg_proc p
where p.oid = 'public.get_rate_feed_bootstrap(integer)'::regprocedure;
