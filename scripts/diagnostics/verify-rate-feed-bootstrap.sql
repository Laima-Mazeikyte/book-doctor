-- Step 1D: verify the INSTALLED RPC before switching the endpoint.
-- Run this ENTIRE file in the Supabase web SQL Editor as postgres after Step 1C.
-- Return the final rate_feed_rpc_verification JSON result.
--
-- Read-only repeatable-read validation of the actual installed function, its
-- permissions, registered/anonymous authenticated claim contexts, no-identity
-- behavior, and denial to the unauthenticated anon database role.
-- Includes the previous limit/user comparisons, now calling the real new RPC.
-- No functions, application records, requests, or permanent settings are changed.
-- Temporary role/claim settings are restored, and the report setting is cleared.
-- SQL timings do not include HTTP/API/network latency or JWT signature checks.

begin isolation level repeatable read read only;
set local statement_timeout = '20s';
set local lock_timeout = '2s';
set local row_security = on;

do $validation$
declare
  -- Leave NULL to select the newest completed-feed user with interactions.
  -- Alternatively, replace NULL with 'your-user-uuid'::uuid.
  v_primary uuid := null;
  v_other uuid;
  v_empty uuid;
  v_foreign_request text;
  v_original_role text := current_user;
  v_rpc_oid oid;
  v_rpc_metadata jsonb;
  v_access_checks jsonb;
  v_default_payload jsonb;
  v_anon_denied boolean := false;
  v_subject record;
  v_context record;
  v_limit integer;
  v_round integer;
  v_limits integer[];
  v_old jsonb;
  v_new jsonb;
  v_started timestamptz;
  v_old_ms numeric;
  v_new_ms numeric;
  v_old_plan jsonb;
  v_new_plan jsonb;
  v_plans jsonb := '{}'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_differences jsonb;
  v_foreign_books bigint;
  v_ties bigint;
  v_projection text := $projection$
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
    ) from context
  $projection$;
  v_legacy text := $legacy$
    with counts as materialized (
      select
        (select count(*) from public.user_ratings) as ratings_count,
        (select count(*) from public.user_bookmarks) as bookmarks_count,
        (select count(*) from public.user_not_interested) as dismissals_count
    ), latest_any as materialized (
      select id, status, error_message from public.feed_requests
      order by created_at desc nulls last limit 1
    ), latest_completed as materialized (
      select id, status from public.feed_requests where status = 'completed'
      order by created_at desc nulls last limit 1
    ), legacy_rows as materialized (
      select case
        when (select ratings_count + bookmarks_count + dismissals_count from counts) >= 1
        then (
          select coalesce(jsonb_agg(to_jsonb(s) order by s.rank), '[]'::jsonb)
          from public.get_latest_rate_feed_state($1) s
        ) else '[]'::jsonb end as rows
    ), context as (
      select
        c.ratings_count,
        c.ratings_count + c.bookmarks_count + c.dismissals_count as interaction_count,
        a.id::text as mode_request_id,
        nullif(btrim(a.status), '') as mode_request_status,
        coalesce(r.rows->0->>'latest_request_id', a.id::text) as latest_request_id,
        coalesce(nullif(btrim(r.rows->0->>'latest_request_status'), ''),
          nullif(btrim(a.status), '')) as latest_request_status,
        nullif(btrim(a.error_message), '') as latest_request_error_message,
        coalesce(r.rows->0->>'latest_completed_request_id', lc.id::text, '') as request_id,
        coalesce(lc.status,
          case when coalesce(r.rows->0->>'latest_completed_request_id', lc.id::text) is not null
            then 'completed' else 'none' end) as completed_status,
        (
          select coalesce(jsonb_agg(
            e.row - 'latest_request_id' - 'latest_request_status' - 'latest_completed_request_id'
            order by e.position
          ), '[]'::jsonb)
          from jsonb_array_elements(r.rows) with ordinality e(row, position)
          where e.row->>'id' is not null
        ) as books
      from counts c cross join legacy_rows r
      left join latest_any a on true
      left join latest_completed lc on true
    )
  $legacy$;
  v_candidate text := 'select public.get_rate_feed_bootstrap($1)';
begin
  v_rpc_oid := to_regprocedure('public.get_rate_feed_bootstrap(integer)');
  if v_rpc_oid is null then
    raise exception 'Install the get_rate_feed_bootstrap migration before running this verification.';
  end if;
  select jsonb_build_object(
    'function', p.oid::regprocedure::text,
    'arguments', pg_get_function_arguments(p.oid),
    'result', pg_get_function_result(p.oid),
    'security_definer', p.prosecdef,
    'volatility', p.provolatile,
    'settings', p.proconfig,
    'authenticated_can_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    'anon_can_execute', has_function_privilege('anon', p.oid, 'EXECUTE')
  ) into v_rpc_metadata
  from pg_catalog.pg_proc p where p.oid = v_rpc_oid;
  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
    where p.oid = v_rpc_oid and not p.prosecdef and p.provolatile = 's'
      and l.lanname = 'sql' and p.prorettype = 'jsonb'::regtype
      and not p.proretset and p.proargnames = array['p_limit']::text[]
      and p.pronargdefaults = 1 and pg_get_expr(p.proargdefaults, 0) = '50'
      and p.proconfig = array['search_path=""']::text[]
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not exists (
        select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee not in (p.proowner, 'authenticated'::regrole::oid)
      )
  ) then
    raise exception 'Installed RPC security/type settings do not match the reviewed definition: %', v_rpc_metadata;
  end if;

  if v_primary is null then
    select fr.user_id into v_primary
    from public.feed_requests fr
    where fr.status = 'completed' and (
      exists (select 1 from public.user_ratings r where r.user_id = fr.user_id)
      or exists (select 1 from public.user_bookmarks b where b.user_id = fr.user_id)
      or exists (select 1 from public.user_not_interested n where n.user_id = fr.user_id)
    )
    order by fr.created_at desc nulls last limit 1;
  end if;
  if v_primary is null then
    raise exception 'No completed-feed user with interactions found. Set v_primary to an existing user UUID.';
  end if;

  select fr.user_id, fr.id::text into v_other, v_foreign_request
  from public.feed_requests fr
  where fr.user_id <> v_primary and fr.status = 'completed'
  order by fr.created_at desc nulls last limit 1;

  -- A distinct UUID absent from all relevant ownership columns, not a new user.
  loop
    v_empty := pg_catalog.gen_random_uuid();
    exit when not exists (select 1 from public.feed_requests where user_id = v_empty)
      and not exists (select 1 from public.feed_items where user_id = v_empty)
      and not exists (select 1 from public.user_ratings where user_id = v_empty)
      and not exists (select 1 from public.user_bookmarks where user_id = v_empty)
      and not exists (select 1 from public.user_not_interested where user_id = v_empty);
  end loop;

  v_legacy := v_legacy || v_projection;

  for v_subject in
    select * from (values
      ('primary'::text, v_primary), ('other_existing_user', v_other), ('empty_identity', v_empty)
    ) subjects(label, uid) where uid is not null
  loop
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', v_subject.uid, 'role', 'authenticated', 'is_anonymous', false
    )::text, true);
    perform set_config('request.jwt.claim.sub', v_subject.uid::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';

    -- Dynamic statements are planned AFTER changing role so RLS is applied.
    execute 'select current_user as role, auth.uid() as uid, rolbypassrls, rolsuper
      from pg_catalog.pg_roles where rolname = current_user' into v_context;
    if v_context.role <> 'authenticated' or v_context.uid is distinct from v_subject.uid
      or v_context.rolbypassrls or v_context.rolsuper then
      raise exception 'Authenticated RLS context was not established.';
    end if;

    execute 'select count(*) from (
      select created_at from public.feed_requests group by created_at having count(*) > 1
    ) ties' into v_ties;

    if v_subject.label = 'primary' and v_foreign_request is not null then
      execute 'select count(*) from public.get_eligible_feed_books($1, 50)'
        into v_foreign_books using v_foreign_request;
      if v_foreign_books <> 0 then
        raise exception 'Existing feed helper returned another account''s books.';
      end if;
    end if;

    v_limits := case when v_subject.label = 'primary' then array[1, 50, 100] else array[50] end;
    foreach v_limit in array v_limits loop
      for v_round in 1..2 loop
        if v_round = 1 then
          v_started := clock_timestamp();
          execute v_legacy into v_old using v_limit;
          v_old_ms := extract(epoch from clock_timestamp() - v_started) * 1000;
          v_started := clock_timestamp();
          execute v_candidate into v_new using v_limit;
          v_new_ms := extract(epoch from clock_timestamp() - v_started) * 1000;
        else
          v_started := clock_timestamp();
          execute v_candidate into v_new using v_limit;
          v_new_ms := extract(epoch from clock_timestamp() - v_started) * 1000;
          v_started := clock_timestamp();
          execute v_legacy into v_old using v_limit;
          v_old_ms := extract(epoch from clock_timestamp() - v_started) * 1000;
        end if;

        select coalesce(jsonb_agg(k order by k), '[]'::jsonb) into v_differences
        from jsonb_object_keys(v_old || v_new) k
        where (v_old->k) is distinct from (v_new->k);

        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'subject', v_subject.label,
          'user_id', case when v_subject.label <> 'empty_identity' then v_subject.uid else null end,
          'role', v_context.role,
          'limit', v_limit,
          'pass', v_round,
          'execution_order', case when v_round = 1 then 'legacy_then_candidate' else 'candidate_then_legacy' end,
          'equal', v_old = v_new,
          'different_fields', v_differences,
          'mode', v_old->'mode',
          'ratings_count', v_old->'ratings_count',
          'interaction_count', v_old->'interaction_count',
          'legacy_book_count', jsonb_array_length(v_old->'books'),
          'candidate_book_count', jsonb_array_length(v_new->'books'),
          'legacy_sql_ms', round(v_old_ms, 3),
          'candidate_sql_ms', round(v_new_ms, 3),
          'request_timestamp_tie_groups', v_ties
        ));
      end loop;
      if v_subject.label = 'primary' and v_limit = 50 then
        execute 'explain (analyze, buffers, format json) ' || v_legacy
          into v_old_plan using v_limit;
        execute 'explain (analyze, buffers, format json) ' || v_candidate
          into v_new_plan using v_limit;
        v_plans := jsonb_build_object('legacy', v_old_plan, 'candidate', v_new_plan);
      end if;
    end loop;
    execute format('set local role %I', v_original_role);
  end loop;

  -- An authenticated role with no identity must receive no user-specific data.
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  execute v_candidate into v_new using 50;
  if v_new->>'mode' is distinct from 'below_threshold'
    or v_new->'books' is distinct from '[]'::jsonb
    or v_new->>'interaction_count' is distinct from '0'
    or v_new->>'latest_request_id' is not null
    or v_new->>'request_id' is distinct from '' then
    raise exception 'RPC returned unexpected data without an authenticated identity.';
  end if;

  -- Signed-in anonymous users retain the authenticated role and their own identity.
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_primary, 'role', 'authenticated', 'is_anonymous', true
  )::text, true);
  perform set_config('request.jwt.claim.sub', v_primary::text, true);
  execute v_legacy into v_old using 50;
  execute v_candidate into v_new using 50;
  if v_old is distinct from v_new then
    raise exception 'Anonymous-user JWT claim context changed feed behavior.';
  end if;
  execute 'select public.get_rate_feed_bootstrap()' into v_default_payload;
  if v_default_payload is distinct from v_new then
    raise exception 'The default RPC limit did not match an explicit limit of 50.';
  end if;

  -- The unauthenticated anon database role must not execute the new RPC.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  execute 'set local role anon';
  begin
    execute v_candidate into v_new using 50;
  exception when insufficient_privilege then
    v_anon_denied := true;
  end;
  if not v_anon_denied then
    raise exception 'The unauthenticated anon role could execute the new RPC.';
  end if;
  execute format('set local role %I', v_original_role);
  v_access_checks := jsonb_build_object(
    'default_limit_matches_50', true,
    'missing_identity_returns_no_user_data', true,
    'anonymous_authenticated_context_matches_legacy', true,
    'anon_role_execution_denied', v_anon_denied
  );

  perform set_config('book_doctor_diagnostics.rate_feed_rpc_report', jsonb_build_object(
    'captured_at', statement_timestamp(),
    'rpc_metadata', v_rpc_metadata,
    'access_checks', v_access_checks,
    'read_only', current_setting('transaction_read_only'),
    'isolation', current_setting('transaction_isolation'),
    'all_comparisons_equal', not exists (
      select 1 from jsonb_array_elements(v_results) e where e->'equal' <> 'true'::jsonb
    ),
    'cross_account_existing_helper_check', case
      when v_foreign_request is null then 'not_available_no_second_completed_feed_user'
      when v_foreign_books = 0 then 'passed' else 'failed' end,
    'comparisons', v_results,
    'plans_for_primary_limit_50', v_plans,
    'scope', 'Installed RPC equivalence and access checks under simulated JWT claims/RLS; excludes HTTP/API latency and real JWT signature validation.'
  )::text, false);
end;
$validation$;

-- This commits a READ ONLY transaction; only the temporary report setting survives.
commit;

with captured as materialized (
  select nullif(current_setting('book_doctor_diagnostics.rate_feed_rpc_report', true), '')::jsonb as report
)
select report as rate_feed_rpc_verification
from captured
where set_config('book_doctor_diagnostics.rate_feed_rpc_report', '', false) = '';
