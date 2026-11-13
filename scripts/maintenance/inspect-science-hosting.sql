-- Supabase Dashboard > SQL Editor > Database: postgres, role: postgres.
-- Paste/run this ENTIRE file. Returns one JSON cell: science_hosting_report.
-- Read-only SELECT: no migrations, cleanup, temporary objects or session settings.
-- Reads catalogs/statistics and Storage size metadata; never returns reader data,
-- object paths, tokens, reaction arrays, function bodies or application row contents.
-- Requires standard Supabase storage.buckets and storage.objects tables.
-- Size functions measure allocation (including reusable space), not backup size.
-- Sources:
-- https://supabase.com/docs/guides/platform/database-size
-- https://supabase.com/docs/guides/platform/manage-your-usage/storage-size
-- https://www.postgresql.org/docs/17/functions-admin.html
with
settings as (
  -- Planning inputs, NOT a live subscription lookup. Check Dashboard Usage.
  -- Decimal MB; raw bytes also returned so MB/MiB comparisons are unambiguous.
  select 500000000::numeric as planning_budget_bytes, 3::numeric as growth_factor
),
relations as materialized (
  select c.oid, n.nspname as schema_name, c.relname as table_name,
    c.relkind, c.relisshared as cluster_shared,
    greatest(c.reltuples, 0)::bigint as estimated_rows,
    c.reltuples < 0 as row_estimate_unavailable,
    pg_table_size(c.oid) as table_bytes_including_toast,
    pg_indexes_size(c.oid) as index_bytes,
    pg_total_relation_size(c.oid) as total_bytes,
    s.n_dead_tup as estimated_dead_rows,
    s.last_analyze, s.last_autoanalyze, s.last_autovacuum,
    s.seq_scan as sequential_scans, s.idx_scan as index_scans,
    case
      when n.nspname = 'migration_archive' then 'archive_review'
      when (n.nspname = 'book_connections' and c.relname in ('incoming', 'pending_release'))
        or (n.nspname = 'private' and c.relname = 'book_annotation_import_rows')
        then 'import_staging'
      when n.nspname = 'book_connections' then 'science_book_connections'
      when n.nspname = 'private' and c.relname in (
        'author_comparison_datasets', 'author_reaction_sets',
        'validated_author_comparisons', 'author_comparison_cache'
      ) then 'science_author_comparisons'
      when n.nspname = 'private' and c.relname in ('author_map_nodes', 'author_map_neighbors')
        then 'science_author_map'
      when n.nspname = 'public' and c.relname in ('books', 'book_series') then 'catalog'
      when n.nspname in ('public', 'private') then 'other_application_review'
      else 'platform_or_unclassified_review'
    end as data_group
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_stat_all_tables s on s.relid = c.oid
  where c.relkind in ('r', 'p', 'm')
    and n.nspname !~ '^pg_toast' and n.nspname !~ '^pg_temp_'
),
group_totals as materialized (
  select data_group, count(*) as table_count,
    sum(table_bytes_including_toast) as table_bytes_including_toast,
    sum(index_bytes) as index_bytes, sum(total_bytes) as total_bytes,
    pg_size_pretty(sum(total_bytes)) as total_size
  from relations where not cluster_shared group by data_group
),
sizes as materialized (
  select pg_database_size(current_database())::numeric as database_bytes,
    coalesce(sum(total_bytes) filter (where not cluster_shared), 0) as listed_relation_bytes,
    coalesce(sum(total_bytes) filter (where not cluster_shared and data_group = 'catalog'), 0)
      as catalog_bytes,
    coalesce(sum(total_bytes) filter (where not cluster_shared and data_group like 'science_%'), 0)
      as science_bytes,
    coalesce(sum(total_bytes) filter (where not cluster_shared and data_group = 'science_book_connections'), 0)
      as connections_bytes
  from relations
),
objects as materialized (
  select bucket_id,
    case when metadata->>'size' ~ '^[0-9]{1,30}$'
      then (metadata->>'size')::numeric else null end as file_bytes
  from storage.objects
),
buckets as materialized (
  select b.id as bucket, b.public as public_downloads,
    count(o.bucket_id) as object_count,
    count(o.bucket_id) filter (where o.file_bytes is null) as objects_with_unknown_size,
    coalesce(sum(o.file_bytes), 0) as known_file_bytes,
    pg_size_pretty(coalesce(sum(o.file_bytes), 0)) as known_file_size,
    max(o.file_bytes) as largest_known_file_bytes
  from storage.buckets b left join objects o on o.bucket_id = b.id
  group by b.id, b.public
),
scenarios as (
  select 'current_database' as scenario, database_bytes as estimated_bytes,
    'Measured current-database allocation; not the entire project disk or organization.' as assumption
  from sizes
  union all
  select 'catalog_and_connections_3x_replacement',
    database_bytes + (catalog_bytes + connections_bytes) * (growth_factor - 1),
    'Only catalog and connection allocation scale by the growth factor; all other data stays fixed.'
  from sizes cross join settings
  union all
  select 'catalog_and_all_science_3x_replacement',
    database_bytes + (catalog_bytes + science_bytes) * (growth_factor - 1),
    'Sensitivity only: catalog and all classified science allocation scale equally; not a pair-count forecast.'
  from sizes cross join settings
  union all
  select 'catalog_and_all_science_new_copy_alongside_current',
    database_bytes + (catalog_bytes + science_bytes) * growth_factor,
    'Illustrative coexistence allocation for a new copy. Excludes WAL, temp files, index build workspace and other growth.'
  from sizes cross join settings
),
table_details as materialized (
  select r.*, pg_size_pretty(total_bytes) as total_size,
    round(total_bytes * 100.0 / nullif(z.database_bytes, 0), 2) as percent_current_database,
    case data_group
      when 'science_author_comparisons' then
        'Private compute data: consider a separate science service/database, or precomputed safe pair results. Keep reader reaction sets server-private.'
      when 'science_book_connections' then
        'The current RPC reads these vectors and reader ratings in PostgreSQL. Moving vectors needs a serving API and preserved reader authorization, or a reviewed precomputed-neighbor design.'
      when 'science_author_map' then
        'Review whether consumers can use versioned map/neighborhood shards from object storage; verify active releases and backend consumers first.'
      when 'catalog' then 'Keep transactional catalog in PostgreSQL; review row width and indexes if this dominates.'
      when 'import_staging' then 'Inspect active imports and residual rows; staging allocation is not automatically safe to remove.'
      when 'archive_review' then 'Review retention and all consumers before retiring snapshots.'
      else 'Identify owners and read/write behavior before choosing another host.'
    end as hosting_review,
    (select coalesce(jsonb_agg(jsonb_build_object(
      'schema', pn.nspname, 'routine', p.proname,
      'arguments', pg_get_function_identity_arguments(p.oid)
    ) order by pn.nspname, p.proname, p.oid), '[]'::jsonb)
      from pg_proc p join pg_namespace pn on pn.oid = p.pronamespace
      where p.prokind in ('f', 'p') and pn.nspname !~ '^pg_'
        and pn.nspname <> 'information_schema'
        and position(lower(r.table_name) in lower(p.prosrc)) > 0
    ) as routine_text_reference_hints
  from relations r cross join sizes z
  where not r.cluster_shared and r.schema_name in ('public', 'private', 'book_connections', 'migration_archive')
),
indexes as materialized (
  select n.nspname as schema_name, t.relname as table_name, i.relname as index_name,
    pg_relation_size(i.oid) as bytes, pg_size_pretty(pg_relation_size(i.oid)) as size,
    x.indisunique as is_unique, x.indisprimary as is_primary,
    x.indisvalid as is_valid,
    exists (select 1 from pg_constraint c where c.conindid = i.oid) as supports_constraint,
    s.idx_scan as scans_since_statistics_reset
  from pg_index x join pg_class i on i.oid = x.indexrelid
  join pg_class t on t.oid = x.indrelid join pg_namespace n on n.oid = t.relnamespace
  left join pg_stat_all_indexes s on s.indexrelid = i.oid
  where n.nspname !~ '^pg_toast' and n.nspname !~ '^pg_temp_'
    and not i.relisshared
  order by pg_relation_size(i.oid) desc, i.oid limit 30
)
select jsonb_build_object(
  'captured_at', statement_timestamp(), 'database', current_database(), 'role', current_user,
  'summary', (select jsonb_build_object(
    'current_database_bytes', database_bytes, 'current_database_size', pg_size_pretty(database_bytes),
    'current_database_decimal_mb', round(database_bytes / 1000000, 2),
    'current_database_mib', round(database_bytes / 1048576, 2),
    'planning_budget_bytes', planning_budget_bytes,
    'planning_headroom_bytes', planning_budget_bytes - database_bytes,
    'percent_planning_budget', round(100 * database_bytes / planning_budget_bytes, 2),
    'catalog_bytes', catalog_bytes, 'classified_science_bytes', science_bytes,
    'listed_relation_bytes', listed_relation_bytes,
    'database_bytes_minus_listed_relations', database_bytes - listed_relation_bytes,
    'storage_known_payload_bytes_separate_quota', (select coalesce(sum(known_file_bytes), 0) from buckets),
    'statistics_reset_at', (select stats_reset from pg_stat_database where datname = current_database())
  ) from sizes cross join settings),
  'groups', (select jsonb_agg(to_jsonb(g) order by total_bytes desc, data_group) from group_totals g),
  'largest_tables_all_schemas', (select coalesce(jsonb_agg(to_jsonb(t) order by total_bytes desc, oid), '[]'::jsonb)
    from (select * from relations where not cluster_shared order by total_bytes desc, oid limit 30) t),
  'application_and_science_tables', (select coalesce(jsonb_agg(to_jsonb(t) order by total_bytes desc, oid), '[]'::jsonb) from table_details t),
  'largest_indexes', (select coalesce(jsonb_agg(to_jsonb(i) order by bytes desc, index_name), '[]'::jsonb) from indexes i),
  'storage_buckets_separate_quota', (select coalesce(jsonb_agg(to_jsonb(b) order by known_file_bytes desc, bucket), '[]'::jsonb) from buckets b),
  'v4_planning_scenarios', (select jsonb_agg(jsonb_build_object(
    'scenario', scenario, 'growth_factor', growth_factor, 'assumption', assumption,
    'estimated_database_bytes', estimated_bytes, 'estimated_size', pg_size_pretty(estimated_bytes),
    'headroom_against_planning_budget_bytes', planning_budget_bytes - estimated_bytes,
    'over_planning_budget', estimated_bytes > planning_budget_bytes
  ) order by estimated_bytes, scenario) from scenarios cross join settings),
  'interpretation', jsonb_build_array(
    'Groups use known repository table names. New science tables can appear under other_application_review or platform_or_unclassified_review; inspect all large tables.',
    'Static public manifests/rankings/shards can use object storage and a CDN. SQL cannot see artifacts already hosted outside this database or verify their consumers.',
    'Bucket payloads use a separate Storage quota; their metadata/indexes still occupy PostgreSQL. Relocating CSV files does not remove imported rows.',
    'Science table bytes are allocation, not guaranteed savings. A separate compute service must replace dependent SQL/RPC behavior before data moves.',
    'Routine text references are incomplete hints; dynamic SQL, views, foreign keys, triggers, jobs and external consumers need separate review.',
    'Estimated rows/dead rows and low scan counts do not prove bloat or disuse. No index or dataset is approved for removal by this report.',
    'Planning scenarios assume unchanged bytes per row/index and fixed unrelated data. Actual v4 vectors, pair counts, indexes and staging can differ.',
    'Budget is a user-editable planning input, not billing verification. Database allocation excludes WAL and temporary disk needs; compare Dashboard Usage.',
    'Storage totals use recorded metadata, omit unknown sizes and may differ from billed usage. Run as postgres for a complete project view.',
    'No application tables are scanned for exact counts. Only Storage metadata is aggregated; large buckets can take longer.'
  )
) as science_hosting_report;
