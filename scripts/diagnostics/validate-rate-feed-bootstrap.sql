-- Step 1A: inspect the live contract before consolidating /api/feed/latest.
-- Copy this entire file into the Supabase web SQL Editor and run as postgres.
-- Return the one-row rate_feed_validation JSON result for review.
--
-- One catalog-only SELECT. No schema/data changes, application-row reads,
-- feed-function execution, token changes, or request/generation inserts.
-- Row estimates are catalog estimates, not exact COUNT(*) queries.
--
-- After this result is reviewed, the next validation will measure the existing
-- reads and compare candidate SQL under an authenticated user's RLS context.
-- SQL Editor's postgres role alone is not a representative app query context.

with
target_names(table_name) as (
  values
    ('books'),
    ('feed_requests'),
    ('feed_items'),
    ('user_ratings'),
    ('user_bookmarks'),
    ('user_not_interested')
),
relations as (
  select c.*
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join target_names t on t.table_name = c.relname
  where n.nspname = 'public' and c.relkind in ('r', 'p')
),
routines as (
  select p.*, l.lanname as language_name
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.proname in (
      'get_latest_rate_feed_state',
      'get_eligible_feed_books',
      'get_rate_feed_bootstrap'
    )
)
select pg_catalog.jsonb_build_object(
  'environment', pg_catalog.jsonb_build_object(
    'captured_at', statement_timestamp(),
    'postgres_version', current_setting('server_version'),
    'current_role', current_user,
    'proposed_rpc_name_in_use', exists (
      select 1 from routines where proname = 'get_rate_feed_bootstrap'
    )
  ),
  'missing_tables', (
    select coalesce(pg_catalog.jsonb_agg(t.table_name order by t.table_name), '[]'::jsonb)
    from target_names t
    where not exists (select 1 from relations r where r.relname = t.table_name)
  ),
  'roles', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'name', rolname,
      'superuser', rolsuper,
      'bypasses_rls', rolbypassrls
    ) order by rolname), '[]'::jsonb)
    from pg_catalog.pg_roles
    where rolname in ('postgres', 'authenticated', 'anon')
  ),
  'tables', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'name', r.relname,
      'owner', pg_catalog.pg_get_userbyid(r.relowner),
      'rls_enabled', r.relrowsecurity,
      'rls_forced', r.relforcerowsecurity,
      'estimated_rows', r.reltuples::bigint,
      'total_bytes_including_indexes', pg_catalog.pg_total_relation_size(r.oid),
      'authenticated_can_select', pg_catalog.has_table_privilege('authenticated', r.oid, 'SELECT'),
      'anon_can_select', pg_catalog.has_table_privilege('anon', r.oid, 'SELECT')
    ) order by r.relname), '[]'::jsonb)
    from relations r
  ),
  'columns', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'table', r.relname,
      'column', a.attname,
      'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
      'not_null', a.attnotnull
    ) order by r.relname, a.attnum), '[]'::jsonb)
    from relations r
    join pg_catalog.pg_attribute a on a.attrelid = r.oid
    where a.attnum > 0 and not a.attisdropped
      and a.attname in (
        'id', 'book_id', 'user_id', 'request_id', 'rank', 'book_rating',
        'created_at', 'updated_at', 'status', 'error_message',
        'book_name', 'author', 'summary', 'year',
        'genre1', 'genre2', 'genre3', 'genre4', 'genre5', 'genre6', 'genre7', 'type'
      )
  ),
  'indexes', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'table', r.relname,
      'name', ic.relname,
      'valid', i.indisvalid,
      'ready', i.indisready,
      'unique', i.indisunique,
      'definition', pg_catalog.pg_get_indexdef(i.indexrelid)
    ) order by r.relname, ic.relname), '[]'::jsonb)
    from relations r
    join pg_catalog.pg_index i on i.indrelid = r.oid
    join pg_catalog.pg_class ic on ic.oid = i.indexrelid
  ),
  'constraints', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'table', r.relname,
      'name', c.conname,
      'type', c.contype,
      'validated', c.convalidated,
      'definition', pg_catalog.pg_get_constraintdef(c.oid)
    ) order by r.relname, c.conname), '[]'::jsonb)
    from relations r
    join pg_catalog.pg_constraint c on c.conrelid = r.oid
    where c.contype in ('p', 'u', 'f', 'c')
  ),
  'read_policies', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'table', p.tablename,
      'name', p.policyname,
      'command', p.cmd,
      'roles', p.roles,
      'permissive', p.permissive,
      'using', p.qual
    ) order by p.tablename, p.policyname), '[]'::jsonb)
    from pg_catalog.pg_policies p
    join target_names t on t.table_name = p.tablename
    where p.schemaname = 'public' and p.cmd in ('SELECT', 'ALL')
  ),
  'functions', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'name', r.proname,
      'identity_arguments', pg_catalog.pg_get_function_identity_arguments(r.oid),
      'arguments_with_defaults', pg_catalog.pg_get_function_arguments(r.oid),
      'result', pg_catalog.pg_get_function_result(r.oid),
      'language', r.language_name,
      'owner', pg_catalog.pg_get_userbyid(r.proowner),
      'security_definer', r.prosecdef,
      'volatility', r.provolatile,
      'settings', r.proconfig,
      'authenticated_can_execute', pg_catalog.has_function_privilege('authenticated', r.oid, 'EXECUTE'),
      'anon_can_execute', pg_catalog.has_function_privilege('anon', r.oid, 'EXECUTE'),
      'public_can_execute', exists (
        select 1
        from pg_catalog.aclexplode(
          coalesce(r.proacl, pg_catalog.acldefault('f', r.proowner))
        ) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      ),
      'definition', pg_catalog.pg_get_functiondef(r.oid)
    ) order by r.proname, r.oid), '[]'::jsonb)
    from routines r
  )
) as rate_feed_validation;
