-- Investigate the 500 MB PostgreSQL allowance before removing outdated objects.
-- Supabase web SQL Editor: Database, postgres. Run this ENTIRE file.
-- READ ONLY. Catalogs, allocated relation sizes, statistics, optional cron metadata.
-- No application/user/book/Storage-object rows, function bodies or job commands returned.
-- No DELETE, TRUNCATE, DROP, VACUUM, ANALYZE, index changes or statistics resets.
-- Table sizes include their indexes and TOAST; TOAST relations are not counted twice.
-- Cluster-shared catalogs are reported separately from current-database table totals.
-- Row/dead-row counts are estimates, not reclaimable bytes. Zero scans do not prove disuse.
-- Physical sizes/statistics can change during capture. Other databases are size-only.
-- Storage bucket file contents and WAL are outside pg_database_size and not measured here.
-- Archive dependency hints do not establish whether external/manual consumers still use it.
begin read only;
set local statement_timeout = '20s';
set local lock_timeout = '2s';

do $inventory$
declare
  v_report jsonb;
  v_cron jsonb := jsonb_build_object('available', false);
begin
  if to_regclass('cron.job') is not null then
    begin
      execute $cron$
        select jsonb_build_object('available', true, 'jobs', coalesce(jsonb_agg(jsonb_build_object(
          'job_id', j.jobid, 'name', j.jobname, 'active', j.active, 'schedule', j.schedule,
          'database', j.database,
          'archive_text_reference_hint', position('migration_archive' in lower(j.command)) > 0
            or exists (select 1 from pg_catalog.pg_class c
              join pg_catalog.pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'migration_archive' and c.relkind in ('r', 'p', 'm')
                and position(lower(c.relname) in lower(j.command)) > 0),
          'bare_if_command_hint', j.command ~* '^\s*if\M'
        ) order by j.jobid), '[]'::jsonb)) from cron.job j
      $cron$ into v_cron;
    exception when insufficient_privilege then
      v_cron := jsonb_build_object('available', false, 'reason', 'No cron metadata permission');
    end;
  end if;

  with relations as materialized (
    select c.oid, n.nspname as schema_name, c.relname as table_name,
      c.relkind, c.reltuples::bigint as estimated_rows, c.relowner, c.relisshared as is_shared,
      pg_catalog.pg_relation_size(c.oid) as heap_main_bytes,
      pg_catalog.pg_table_size(c.oid) as table_bytes,
      pg_catalog.pg_indexes_size(c.oid) as index_bytes,
      pg_catalog.pg_total_relation_size(c.oid) as total_bytes,
      s.n_live_tup, s.n_dead_tup, s.last_autovacuum, s.last_autoanalyze,
      s.seq_scan, s.idx_scan
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    left join pg_catalog.pg_stat_all_tables s on s.relid = c.oid
    where c.relkind in ('r', 'p', 'm')
      and n.nspname !~ '^pg_toast' and n.nspname !~ '^pg_temp_'
  ), table_payloads as materialized (
    select r.*, jsonb_build_object(
      'schema', schema_name, 'table', table_name, 'kind', relkind,
      'cluster_shared', is_shared,
      'owner', pg_catalog.pg_get_userbyid(relowner),
      'total_bytes', total_bytes, 'total_size', pg_catalog.pg_size_pretty(total_bytes),
      'heap_main_bytes', heap_main_bytes, 'table_bytes_including_toast', table_bytes,
      'auxiliary_and_toast_bytes', table_bytes - heap_main_bytes, 'index_bytes', index_bytes,
      'estimated_rows', estimated_rows, 'live_rows_estimate', n_live_tup,
      'dead_rows_estimate', n_dead_tup, 'last_autovacuum', last_autovacuum,
      'last_autoanalyze', last_autoanalyze,
      'seq_scans_cumulative', seq_scan, 'index_scans_cumulative', idx_scan,
      'review_group', case
        when schema_name = 'migration_archive' then 'legacy_snapshot_candidate'
        when schema_name = 'private' and table_name = 'book_annotation_import_rows' then 'staging_allocation_check'
        when schema_name = 'public' and table_name in ('feed_log', 'recommendation_log') then 'application_log_retention_review'
        when schema_name in ('public', 'private') then 'application_data_preserve_until_review'
        else 'platform_or_extension_data_preserve_until_review' end
    ) as payload from relations r
  ), archives as materialized (
    select * from table_payloads where schema_name = 'migration_archive'
  ), database_sizes as materialized (
    select datname as database, datistemplate as is_template,
      pg_catalog.pg_database_size(oid) as bytes
    from pg_catalog.pg_database
  )
  select jsonb_build_object(
    'captured_at_utc', statement_timestamp() at time zone 'UTC',
    'role', current_user, 'database', current_database(),
    'transaction_read_only', current_setting('transaction_read_only'),
    'current_database_bytes', pg_catalog.pg_database_size(current_database()),
    'current_database_size', pg_catalog.pg_size_pretty(pg_catalog.pg_database_size(current_database())),
    'database_sizes', (select jsonb_agg(to_jsonb(d) order by bytes desc) from database_sizes d),
    'all_database_bytes_including_templates', (select sum(bytes) from database_sizes),
    'listed_tables_total_bytes', (select sum(total_bytes) from relations where not is_shared),
    'cluster_shared_tables_total_bytes', (select coalesce(sum(total_bytes), 0) from relations where is_shared),
    'cluster_shared_tables', (select coalesce(jsonb_agg(payload order by total_bytes desc, oid), '[]'::jsonb)
      from table_payloads where is_shared),
    'database_bytes_minus_listed_tables', pg_catalog.pg_database_size(current_database())
      - coalesce((select sum(total_bytes) from relations where not is_shared), 0),
    'statistics_reset_at', (select stats_reset from pg_catalog.pg_stat_database where datname = current_database()),
    'schema_totals', (select jsonb_agg(to_jsonb(s) order by total_bytes desc) from (
      select schema_name as schema, count(*) as table_count, sum(table_bytes) as table_bytes_including_toast,
        sum(index_bytes) as index_bytes, sum(total_bytes) as total_bytes,
        pg_catalog.pg_size_pretty(sum(total_bytes)) as total_size
      from relations where not is_shared group by schema_name
    ) s),
    'largest_tables', (select coalesce(jsonb_agg(payload order by total_bytes desc, oid), '[]'::jsonb)
      from (select * from table_payloads where not is_shared order by total_bytes desc, oid limit 25) t),
    'annotation_staging', (select payload from table_payloads
      where schema_name = 'private' and table_name = 'book_annotation_import_rows'),
    'archive_total_bytes', (select coalesce(sum(total_bytes), 0) from archives),
    'archive_tables', (select coalesce(jsonb_agg(a.payload || jsonb_build_object(
      'foreign_keys_touching_table', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', conname, 'from_table', conrelid::regclass::text, 'to_table', confrelid::regclass::text,
        'definition', pg_catalog.pg_get_constraintdef(oid)
      ) order by conname), '[]'::jsonb) from pg_catalog.pg_constraint
        where contype = 'f' and (conrelid = a.oid or confrelid = a.oid)),
      'dependent_views', (select coalesce(jsonb_agg(to_jsonb(v) order by v.schema, v.name), '[]'::jsonb)
        from (select distinct vn.nspname as schema, vc.relname as name
          from pg_catalog.pg_depend d
          join pg_catalog.pg_rewrite rw on d.classid = 'pg_catalog.pg_rewrite'::regclass and rw.oid = d.objid
          join pg_catalog.pg_class vc on vc.oid = rw.ev_class
          join pg_catalog.pg_namespace vn on vn.oid = vc.relnamespace
          where d.refclassid = 'pg_catalog.pg_class'::regclass and d.refobjid = a.oid
            and vc.relkind in ('v', 'm') and vc.oid <> a.oid) v),
      'routine_text_reference_hints', (select coalesce(jsonb_agg(to_jsonb(f) order by f.schema, f.name, f.arguments), '[]'::jsonb)
        from (select pn.nspname as schema, p.proname as name,
          pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments
          from pg_catalog.pg_proc p join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
          where p.prokind in ('f', 'p') and pn.nspname !~ '^pg_' and pn.nspname <> 'information_schema'
            and position(lower(a.table_name) in lower(p.prosrc)) > 0) f)
    ) order by a.total_bytes desc, a.table_name), '[]'::jsonb) from archives a),
    'largest_indexes', (select coalesce(jsonb_agg(to_jsonb(i) order by bytes desc, schema, name), '[]'::jsonb) from (
      select tn.nspname as schema, tc.relname as table, ic.relname as name,
        pg_catalog.pg_relation_size(ic.oid) as bytes,
        ic.relisshared as cluster_shared,
        ix.indisvalid as valid, ix.indisready as ready, ix.indisunique as unique,
        exists (select 1 from pg_catalog.pg_constraint c where c.conindid = ic.oid) as supports_constraint,
        si.idx_scan as scans_cumulative, pg_catalog.pg_get_indexdef(ic.oid) as definition
      from pg_catalog.pg_index ix
      join pg_catalog.pg_class ic on ic.oid = ix.indexrelid
      join pg_catalog.pg_class tc on tc.oid = ix.indrelid
      join pg_catalog.pg_namespace tn on tn.oid = tc.relnamespace
      left join pg_catalog.pg_stat_all_indexes si on si.indexrelid = ic.oid
      where tn.nspname !~ '^pg_toast' and tn.nspname !~ '^pg_temp_'
      order by pg_catalog.pg_relation_size(ic.oid) desc, ic.oid limit 20
    ) i),
    'cron_metadata_without_commands', v_cron,
    'limits', jsonb_build_array(
      'Inventory only: no object is approved for deletion by its name, age or scan count.',
      'Archived views/FKs/routine/job text hints are incomplete dependency evidence; external consumers are not visible.',
      'Dead rows are estimates, not a measured bloat size. Empty live rows do not establish an empty table.',
      'Allocated table/index space can include reusable free space; this report does not measure exact reclaimable bytes.',
      'Old application RPCs/quality fields and backend-only tables remain production dependencies until separately reviewed.',
      'Supabase Storage file payloads have a separate quota; deleting lab artifacts does not reclaim the PostgreSQL allowance.',
      'This is one project cluster, not an organization-wide quota audit. Dashboard metrics can lag current sizes.'
    )
  ) into v_report;

  perform set_config('book_doctor_diagnostics.storage_inventory', v_report::text, false);
end;
$inventory$;
commit;

with captured as materialized (
  select nullif(current_setting('book_doctor_diagnostics.storage_inventory', true), '')::jsonb as report
)
select report as supabase_storage_inventory
from captured
where set_config('book_doctor_diagnostics.storage_inventory', '', false) = '';
