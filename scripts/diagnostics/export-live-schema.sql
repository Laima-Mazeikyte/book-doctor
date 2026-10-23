-- Run this entire file in the Supabase SQL Editor, then export the result as JSON.
-- A SINGLE SELECT: no DDL, writes, application-function calls, or application-row reads.
-- Tested on PostgreSQL 17 inside a READ ONLY transaction.
-- This is a schema inventory for review, NOT an executable pg_dump/restore script.
-- Function bodies and trigger arguments can contain embedded credentials. Keep the
-- exported result in the ignored temp/ directory until it has been reviewed.
-- Cron job commands, Vault rows, table contents, and Dashboard settings are not exported.
-- References: https://www.postgresql.org/docs/17/functions-info.html

with
schema_inventory as (
  select n.*,
    n.nspname not in (
      'auth', 'storage', 'realtime', '_realtime', 'supabase_functions',
      'supabase_migrations', 'extensions', 'vault', 'net', 'cron',
      'graphql', 'graphql_public', 'pgbouncer', 'pgsodium', 'pgsodium_masks',
      '_analytics', '_supavisor'
    ) and not exists (
      select 1 from pg_catalog.pg_depend d
      where d.classid = 'pg_catalog.pg_namespace'::regclass
        and d.objid = n.oid and d.deptype = 'e'
    ) as in_application_scope
  from pg_catalog.pg_namespace n
  where n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
),
extension_members as (
  select classid, objid from pg_catalog.pg_depend where deptype = 'e'
),
relations as (
  select c.*, n.nspname as schema_name
  from pg_catalog.pg_class c
  join schema_inventory n on n.oid = c.relnamespace and n.in_application_scope
  where not exists (
    select 1 from extension_members e
    where e.classid = 'pg_catalog.pg_class'::regclass and e.objid = c.oid
  )
),
trigger_inventory as (
  select t.*, c.relname as table_name, n.nspname as schema_name,
    n.in_application_scope
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join schema_inventory n on n.oid = c.relnamespace
  where not t.tgisinternal
    and (n.in_application_scope or n.nspname in ('auth', 'storage'))
    and not exists (
      select 1 from extension_members e
      where e.classid = 'pg_catalog.pg_trigger'::regclass and e.objid = t.oid
    )
),
routines as (
  select p.*, n.nspname as schema_name, n.in_application_scope
  from pg_catalog.pg_proc p
  join schema_inventory n on n.oid = p.pronamespace
  where (
    n.in_application_scope or exists (
      select 1 from trigger_inventory t where t.tgfoid = p.oid
    )
  ) and not exists (
    select 1 from extension_members e
    where e.classid = 'pg_catalog.pg_proc'::regclass and e.objid = p.oid
  )
),
user_types as (
  select t.*, n.nspname as schema_name
  from pg_catalog.pg_type t
  join schema_inventory n on n.oid = t.typnamespace and n.in_application_scope
  where t.typtype in ('e', 'd', 'c', 'r', 'm')
    and (t.typtype <> 'c' or exists (
      select 1 from pg_catalog.pg_class c where c.oid = t.typrelid and c.relkind = 'c'
    ))
    and not exists (
      select 1 from extension_members e
      where e.classid = 'pg_catalog.pg_type'::regclass and e.objid = t.oid
    )
),
acl_objects as (
  select 'schema' as object_kind, n.nspname::text as schema_name,
    n.nspname::text as object_name, n.nspowner as owner_id,
    n.nspacl as explicit_acl,
    coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner)) as effective_acl
  from schema_inventory n where n.in_application_scope
  union all
  select 'relation', r.schema_name, r.relname::text, r.relowner, r.relacl,
    coalesce(r.relacl, pg_catalog.acldefault(
      case when r.relkind = 'S' then 's'::"char" else 'r'::"char" end, r.relowner
    ))
  from relations r where r.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
  union all
  select 'routine', p.schema_name,
    p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
    p.proowner, p.proacl, coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
  from routines p
  union all
  select 'type', t.schema_name, t.typname::text, t.typowner, t.typacl,
    coalesce(t.typacl, pg_catalog.acldefault('T', t.typowner))
  from user_types t
),
sections(section_name, payload) as (
  select 'schemas', coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'owner', pg_catalog.pg_get_userbyid(n.nspowner),
    'in_application_scope', n.in_application_scope,
    'comment', pg_catalog.obj_description(n.oid, 'pg_namespace')
  ) order by n.nspname), '[]'::jsonb)
  from schema_inventory n

  union all
  select 'extensions', coalesce(jsonb_agg(jsonb_build_object(
    'name', e.extname, 'version', e.extversion, 'schema', n.nspname,
    'relocatable', e.extrelocatable
  ) order by e.extname), '[]'::jsonb)
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace

  union all
  select 'tables', coalesce(jsonb_agg(jsonb_build_object(
    'schema', r.schema_name, 'name', r.relname, 'kind', r.relkind,
    'owner', pg_catalog.pg_get_userbyid(r.relowner),
    'persistence', r.relpersistence, 'row_security', r.relrowsecurity,
    'force_row_security', r.relforcerowsecurity, 'replica_identity', r.relreplident,
    'options', r.reloptions, 'access_method', am.amname, 'tablespace', ts.spcname,
    'partition_key', case when r.relkind = 'p' then pg_catalog.pg_get_partkeydef(r.oid) end,
    'partition_bound', pg_catalog.pg_get_expr(r.relpartbound, r.oid),
    'parents', (select coalesce(jsonb_agg(format('%I.%I', pn.nspname, pc.relname)
      order by i.inhseqno), '[]'::jsonb)
      from pg_catalog.pg_inherits i
      join pg_catalog.pg_class pc on pc.oid = i.inhparent
      join pg_catalog.pg_namespace pn on pn.oid = pc.relnamespace
      where i.inhrelid = r.oid),
    'comment', pg_catalog.obj_description(r.oid, 'pg_class')
  ) order by r.schema_name, r.relname), '[]'::jsonb)
  from relations r
  left join pg_catalog.pg_am am on am.oid = r.relam
  left join pg_catalog.pg_tablespace ts on ts.oid = r.reltablespace
  where r.relkind in ('r', 'p')

  union all
  select 'columns', coalesce(jsonb_agg(jsonb_build_object(
    'schema', r.schema_name, 'relation', r.relname, 'position', a.attnum,
    'name', a.attname, 'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
    'type_schema', tn.nspname, 'type_name', typ.typname,
    'not_null', a.attnotnull, 'identity', a.attidentity, 'generated', a.attgenerated,
    'default_or_generation_expression', pg_catalog.pg_get_expr(d.adbin, d.adrelid),
    'collation_schema', cn.nspname, 'collation', co.collname,
    'is_local', a.attislocal, 'inheritance_count', a.attinhcount,
    'storage', a.attstorage, 'compression', a.attcompression,
    'options', a.attoptions, 'explicit_acl', a.attacl::text[],
    'comment', pg_catalog.col_description(r.oid, a.attnum)
  ) order by r.schema_name, r.relname, a.attnum), '[]'::jsonb)
  from relations r
  join pg_catalog.pg_attribute a on a.attrelid = r.oid
    and a.attnum > 0 and not a.attisdropped
  join pg_catalog.pg_type typ on typ.oid = a.atttypid
  join pg_catalog.pg_namespace tn on tn.oid = typ.typnamespace
  left join pg_catalog.pg_attrdef d on d.adrelid = r.oid and d.adnum = a.attnum
  left join pg_catalog.pg_collation co on co.oid = a.attcollation
  left join pg_catalog.pg_namespace cn on cn.oid = co.collnamespace
  where r.relkind in ('r', 'p', 'v', 'm', 'f')

  union all
  select 'constraints', coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'name', c.conname, 'kind', c.contype,
    'relation', r.relname, 'domain', typ.typname,
    'definition', pg_catalog.pg_get_constraintdef(c.oid, false),
    'validated', c.convalidated, 'is_local', c.conislocal,
    'referenced_schema', fn.nspname, 'referenced_relation', fr.relname,
    'comment', pg_catalog.obj_description(c.oid, 'pg_constraint')
  ) order by n.nspname, r.relname, typ.typname, c.conname), '[]'::jsonb)
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  left join relations r on r.oid = c.conrelid
  left join user_types typ on typ.oid = c.contypid
  left join pg_catalog.pg_class fr on fr.oid = c.confrelid
  left join pg_catalog.pg_namespace fn on fn.oid = fr.relnamespace
  where r.oid is not null or typ.oid is not null

  union all
  select 'indexes', coalesce(jsonb_agg(jsonb_build_object(
    'schema', r.schema_name, 'relation', r.relname, 'name', ic.relname,
    'definition', pg_catalog.pg_get_indexdef(i.indexrelid),
    'primary', i.indisprimary, 'unique', i.indisunique,
    'valid', i.indisvalid, 'ready', i.indisready, 'clustered', i.indisclustered,
    'replica_identity', i.indisreplident,
    'constraint_backed', exists (select 1 from pg_catalog.pg_constraint c
      where c.conindid = i.indexrelid and c.contype in ('p', 'u', 'x')),
    'comment', pg_catalog.obj_description(i.indexrelid, 'pg_class')
  ) order by r.schema_name, r.relname, ic.relname), '[]'::jsonb)
  from pg_catalog.pg_index i
  join relations r on r.oid = i.indrelid
  join pg_catalog.pg_class ic on ic.oid = i.indexrelid

  union all
  select 'routines', coalesce(jsonb_agg(jsonb_build_object(
    'schema', p.schema_name, 'name', p.proname, 'kind', p.prokind,
    'identity_arguments', pg_catalog.pg_get_function_identity_arguments(p.oid),
    'owner', pg_catalog.pg_get_userbyid(p.proowner),
    'in_application_scope', p.in_application_scope,
    'definition', pg_catalog.pg_get_functiondef(p.oid),
    'comment', pg_catalog.obj_description(p.oid, 'pg_proc')
  ) order by p.schema_name, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
  from routines p where p.prokind in ('f', 'p', 'w')

  union all
  select 'triggers', coalesce(jsonb_agg(jsonb_build_object(
    'schema', t.schema_name, 'relation', t.table_name, 'name', t.tgname,
    'enabled', t.tgenabled, 'in_application_scope', t.in_application_scope,
    'function_schema', n.nspname, 'function_name', p.proname,
    'function_arguments', pg_catalog.pg_get_function_identity_arguments(p.oid),
    'definition', pg_catalog.pg_get_triggerdef(t.oid, false),
    'comment', pg_catalog.obj_description(t.oid, 'pg_trigger')
  ) order by t.schema_name, t.table_name, t.tgname), '[]'::jsonb)
  from trigger_inventory t
  join pg_catalog.pg_proc p on p.oid = t.tgfoid
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace

  union all
  select 'policies', coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'relation', c.relname, 'name', p.polname,
    'in_application_scope', n.in_application_scope,
    'row_security', c.relrowsecurity, 'force_row_security', c.relforcerowsecurity,
    'permissive', p.polpermissive, 'command', p.polcmd,
    'roles', (select jsonb_agg(case when role_id = 0 then 'PUBLIC'
      else pg_catalog.pg_get_userbyid(role_id)::text end order by role_id)
      from unnest(p.polroles) as role_list(role_id)),
    'using_expression', pg_catalog.pg_get_expr(p.polqual, p.polrelid),
    'check_expression', pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid),
    'comment', pg_catalog.obj_description(p.oid, 'pg_policy')
  ) order by n.nspname, c.relname, p.polname), '[]'::jsonb)
  from pg_catalog.pg_policy p
  join pg_catalog.pg_class c on c.oid = p.polrelid
  join schema_inventory n on n.oid = c.relnamespace
  where n.in_application_scope or n.nspname in ('auth', 'storage')

  union all
  select 'views', coalesce(jsonb_agg(jsonb_build_object(
    'schema', r.schema_name, 'name', r.relname, 'kind', r.relkind,
    'owner', pg_catalog.pg_get_userbyid(r.relowner), 'options', r.reloptions,
    'definition', pg_catalog.pg_get_viewdef(r.oid, false),
    'comment', pg_catalog.obj_description(r.oid, 'pg_class')
  ) order by r.schema_name, r.relname), '[]'::jsonb)
  from relations r where r.relkind in ('v', 'm')

  union all
  select 'sequences', coalesce(jsonb_agg(jsonb_build_object(
    'schema', r.schema_name, 'name', r.relname,
    'owner', pg_catalog.pg_get_userbyid(r.relowner),
    'type', pg_catalog.format_type(s.seqtypid, null), 'start', s.seqstart,
    'increment', s.seqincrement, 'minimum', s.seqmin, 'maximum', s.seqmax,
    'cache', s.seqcache, 'cycle', s.seqcycle,
    'owned_by', (select jsonb_agg(jsonb_build_object(
      'schema', pn.nspname, 'relation', pc.relname, 'column', a.attname,
      'dependency_kind', d.deptype
    )) from pg_catalog.pg_depend d
      join pg_catalog.pg_class pc on pc.oid = d.refobjid
      join pg_catalog.pg_namespace pn on pn.oid = pc.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = pc.oid and a.attnum = d.refobjsubid
      where d.classid = 'pg_catalog.pg_class'::regclass and d.objid = r.oid
        and d.refclassid = 'pg_catalog.pg_class'::regclass and d.deptype in ('a', 'i')),
    'comment', pg_catalog.obj_description(r.oid, 'pg_class')
  ) order by r.schema_name, r.relname), '[]'::jsonb)
  from pg_catalog.pg_sequence s join relations r on r.oid = s.seqrelid

  union all
  select 'types', coalesce(jsonb_agg(jsonb_build_object(
    'schema', t.schema_name, 'name', t.typname, 'kind', t.typtype,
    'owner', pg_catalog.pg_get_userbyid(t.typowner),
    'domain_base_type', case when t.typtype = 'd'
      then pg_catalog.format_type(t.typbasetype, t.typtypmod) end,
    'domain_not_null', t.typnotnull, 'domain_default', t.typdefault,
    'enum_labels', (select jsonb_agg(e.enumlabel order by e.enumsortorder)
      from pg_catalog.pg_enum e where e.enumtypid = t.oid),
    'composite_attributes', (select jsonb_agg(jsonb_build_object(
      'name', a.attname, 'position', a.attnum,
      'type', pg_catalog.format_type(a.atttypid, a.atttypmod)
    ) order by a.attnum) from pg_catalog.pg_attribute a
      where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped),
    'comment', pg_catalog.obj_description(t.oid, 'pg_type')
  ) order by t.schema_name, t.typname), '[]'::jsonb)
  from user_types t

  union all
  select 'privileges', coalesce(jsonb_agg(jsonb_build_object(
    'kind', a.object_kind, 'schema', a.schema_name, 'object', a.object_name,
    'owner', pg_catalog.pg_get_userbyid(a.owner_id),
    'explicit_acl', a.explicit_acl::text[],
    'effective_grants', (select jsonb_agg(jsonb_build_object(
      'grantor', pg_catalog.pg_get_userbyid(x.grantor),
      'grantee', case when x.grantee = 0 then 'PUBLIC'
        else pg_catalog.pg_get_userbyid(x.grantee)::text end,
      'privilege', x.privilege_type, 'grantable', x.is_grantable
    ) order by x.grantee, x.privilege_type) from pg_catalog.aclexplode(a.effective_acl) x)
  ) order by a.object_kind, a.schema_name, a.object_name), '[]'::jsonb)
  from acl_objects a

  union all
  select 'default_privileges', coalesce(jsonb_agg(jsonb_build_object(
    'owner', pg_catalog.pg_get_userbyid(d.defaclrole), 'schema', n.nspname,
    'object_kind', d.defaclobjtype, 'acl', d.defaclacl::text[]
  ) order by d.defaclrole, n.nspname, d.defaclobjtype), '[]'::jsonb)
  from pg_catalog.pg_default_acl d
  left join schema_inventory n on n.oid = d.defaclnamespace
  where d.defaclnamespace = 0 or n.in_application_scope

  union all
  select 'rules', coalesce(jsonb_agg(jsonb_build_object(
    'schema', r.schema_name, 'relation', r.relname, 'name', rw.rulename,
    'enabled', rw.ev_enabled, 'definition', pg_catalog.pg_get_ruledef(rw.oid, false)
  ) order by r.schema_name, r.relname, rw.rulename), '[]'::jsonb)
  from pg_catalog.pg_rewrite rw join relations r on r.oid = rw.ev_class
  where rw.rulename <> '_RETURN'

  union all
  select 'statistics_definitions', coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'name', s.stxname,
    'owner', pg_catalog.pg_get_userbyid(s.stxowner),
    'definition', pg_catalog.pg_get_statisticsobjdef(s.oid)
  ) order by n.nspname, s.stxname), '[]'::jsonb)
  from pg_catalog.pg_statistic_ext s
  join relations r on r.oid = s.stxrelid
  join pg_catalog.pg_namespace n on n.oid = s.stxnamespace

  union all
  select 'publications', coalesce(jsonb_agg(jsonb_build_object(
    'name', p.pubname, 'owner', pg_catalog.pg_get_userbyid(p.pubowner),
    'all_tables', p.puballtables, 'insert', p.pubinsert, 'update', p.pubupdate,
    'delete', p.pubdelete, 'truncate', p.pubtruncate, 'via_partition_root', p.pubviaroot,
    'tables', (select jsonb_agg(jsonb_build_object(
      'schema', pt.schemaname, 'relation', pt.tablename,
      'columns', pt.attnames, 'row_filter', pt.rowfilter
    ) order by pt.schemaname, pt.tablename)
      from pg_catalog.pg_publication_tables pt where pt.pubname = p.pubname),
    'schemas', (select jsonb_agg(n.nspname order by n.nspname)
      from pg_catalog.pg_publication_namespace pn
      join pg_catalog.pg_namespace n on n.oid = pn.pnnspid where pn.pnpubid = p.oid)
  ) order by p.pubname), '[]'::jsonb)
  from pg_catalog.pg_publication p

  union all
  select 'event_triggers', coalesce(jsonb_agg(jsonb_build_object(
    'name', e.evtname, 'event', e.evtevent, 'enabled', e.evtenabled,
    'owner', pg_catalog.pg_get_userbyid(e.evtowner), 'tags', e.evttags,
    'function_schema', n.nspname, 'function_name', p.proname,
    'function_arguments', pg_catalog.pg_get_function_identity_arguments(p.oid)
  ) order by e.evtname), '[]'::jsonb)
  from pg_catalog.pg_event_trigger e
  join pg_catalog.pg_proc p on p.oid = e.evtfoid
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace

  union all
  select 'objects_needing_separate_definition', coalesce(jsonb_agg(x.object
    order by x.object::text), '[]'::jsonb)
  from (
    select jsonb_build_object('kind', 'foreign_table', 'schema', r.schema_name,
      'name', r.relname) as object from relations r where r.relkind = 'f'
    union all
    select jsonb_build_object('kind', 'aggregate', 'schema', p.schema_name,
      'name', p.proname, 'arguments', pg_catalog.pg_get_function_identity_arguments(p.oid))
      from routines p where p.prokind = 'a'
    union all
    select jsonb_build_object('kind', 'range_type', 'schema', t.schema_name,
      'name', t.typname) from user_types t where t.typtype in ('r', 'm')
    union all
    select jsonb_build_object('kind', 'operator', 'schema', n.nspname, 'name', o.oprname)
      from pg_catalog.pg_operator o
      join schema_inventory n on n.oid = o.oprnamespace and n.in_application_scope
      where not exists (select 1 from extension_members e
        where e.classid = 'pg_catalog.pg_operator'::regclass and e.objid = o.oid)
    union all
    select jsonb_build_object('kind', 'collation', 'schema', n.nspname, 'name', c.collname)
      from pg_catalog.pg_collation c
      join schema_inventory n on n.oid = c.collnamespace and n.in_application_scope
      where not exists (select 1 from extension_members e
        where e.classid = 'pg_catalog.pg_collation'::regclass and e.objid = c.oid)
    union all
    select jsonb_build_object('kind', 'text_search_configuration', 'schema', n.nspname,
      'name', c.cfgname) from pg_catalog.pg_ts_config c
      join schema_inventory n on n.oid = c.cfgnamespace and n.in_application_scope
      where not exists (select 1 from extension_members e
        where e.classid = 'pg_catalog.pg_ts_config'::regclass and e.objid = c.oid)
  ) x
)
select jsonb_build_object(
  'format', 'book-doctor-schema-inventory-v1',
  'metadata', jsonb_build_object(
    'exported_at', statement_timestamp(), 'database', current_database(),
    'server_version', current_setting('server_version'), 'exported_by', current_user,
    'data_included', false,
    'application_schemas', (select jsonb_agg(nspname order by nspname)
      from schema_inventory where in_application_scope),
    'managed_schema_attachments', jsonb_build_array('auth', 'storage'),
    'cron_job_table_present', to_regclass('cron.job') is not null,
    'migration_history_present', to_regclass('supabase_migrations.schema_migrations') is not null,
    'not_included', jsonb_build_array(
      'Application rows, auth users, Vault secret rows, and current sequence values',
      'Cron job rows/commands, migration-history rows, and storage bucket rows',
      'Supabase Dashboard/Auth/API settings, Edge Function source, and environment variables',
      'Extension-owned definitions and managed schemas, except listed triggers/policies',
      'Exhaustive dependency ordering and uncommon objects requiring pg_dump or follow-up queries'
    )
  ),
  'counts', (select jsonb_object_agg(section_name, jsonb_array_length(payload)) from sections),
  'objects', (select jsonb_object_agg(section_name, payload) from sections)
) as schema_export;
