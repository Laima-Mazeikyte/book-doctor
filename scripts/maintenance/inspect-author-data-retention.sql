-- Review private author datasets/map releases before deleting any of their contents.
-- SQL Editor: Database, postgres. One read-only SELECT, no functions invoked.
-- Exact grouped counts scan ID/version columns only. Reader arrays, names, individual
-- author IDs, pair records, routine bodies and scheduled-job commands are not returned.
-- This does not prove whether external backend/manual consumers need these datasets.
-- The latest storage inventory confirmed these six tables and cron.job exist.
with targets as materialized (
  select c.oid, c.relname as table_name
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private' and c.relname in (
    'author_comparison_datasets', 'author_reaction_sets', 'validated_author_comparisons',
    'author_comparison_cache', 'author_map_nodes', 'author_map_neighbors'
  ) and c.relkind in ('r', 'p')
), reactions as materialized (
  select dataset_version, count(*) as reaction_rows from private.author_reaction_sets group by dataset_version
), comparisons as materialized (
  select dataset_version, count(*) as validated_pair_rows from private.validated_author_comparisons group by dataset_version
), cached as materialized (
  select dataset_version, count(*) as cached_pair_rows from private.author_comparison_cache group by dataset_version
), nodes as materialized (
  select release_id, count(*) as node_rows from private.author_map_nodes group by release_id
), neighbors as materialized (
  select release_id, count(*) as neighbor_rows from private.author_map_neighbors group by release_id
)
select jsonb_build_object(
  'captured_at_utc', statement_timestamp() at time zone 'UTC',
  'comparison_datasets', (select coalesce(jsonb_agg(to_jsonb(d) order by is_active desc, dataset_version), '[]'::jsonb) from (
    select d.dataset_version, d.is_active, d.complete_corpus, d.loaded_at, d.method_version,
      d.source_author_graph_version, d.source_handoff_version, d.author_count,
      coalesce(r.reaction_rows, 0) as reaction_rows,
      coalesce(c.validated_pair_rows, 0) as validated_pair_rows,
      coalesce(ca.cached_pair_rows, 0) as cached_pair_rows
    from private.author_comparison_datasets d
    left join reactions r using (dataset_version)
    left join comparisons c using (dataset_version)
    left join cached ca using (dataset_version)
  ) d),
  'map_releases', (select coalesce(jsonb_agg(to_jsonb(r) order by release_id), '[]'::jsonb) from (
    select coalesce(n.release_id, e.release_id) as release_id,
      coalesce(n.node_rows, 0) as node_rows, coalesce(e.neighbor_rows, 0) as neighbor_rows
    from nodes n full join neighbors e using (release_id)
  ) r),
  'table_dependencies', (select coalesce(jsonb_agg(jsonb_build_object(
    'table', t.table_name,
    'total_bytes', pg_catalog.pg_total_relation_size(t.oid),
    'foreign_keys_touching_table', (select coalesce(jsonb_agg(jsonb_build_object(
      'name', c.conname, 'from_table', c.conrelid::regclass::text, 'to_table', c.confrelid::regclass::text,
      'definition', pg_catalog.pg_get_constraintdef(c.oid)
    ) order by c.conname), '[]'::jsonb) from pg_catalog.pg_constraint c
      where c.contype = 'f' and (c.conrelid = t.oid or c.confrelid = t.oid)),
    'routine_reference_hints', (select coalesce(jsonb_agg(to_jsonb(f) order by f.schema, f.name, f.arguments), '[]'::jsonb)
      from (select distinct n.nspname as schema, p.proname as name,
        pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
        position(lower(t.table_name) in lower(p.prosrc)) > 0 as text_reference,
        exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_proc'::regclass
          and d.objid = p.oid and d.refclassid = 'pg_catalog.pg_class'::regclass and d.refobjid = t.oid) as catalog_dependency
        from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where p.prokind in ('f', 'p') and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
          and (position(lower(t.table_name) in lower(p.prosrc)) > 0
            or exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_proc'::regclass
              and d.objid = p.oid and d.refclassid = 'pg_catalog.pg_class'::regclass and d.refobjid = t.oid))) f),
    'dependent_views', (select coalesce(jsonb_agg(to_jsonb(v) order by v.schema, v.name), '[]'::jsonb)
      from (select distinct vn.nspname as schema, vc.relname as name
        from pg_catalog.pg_depend d
        join pg_catalog.pg_rewrite rw on d.classid = 'pg_catalog.pg_rewrite'::regclass and rw.oid = d.objid
        join pg_catalog.pg_class vc on vc.oid = rw.ev_class
        join pg_catalog.pg_namespace vn on vn.oid = vc.relnamespace
        where d.refclassid = 'pg_catalog.pg_class'::regclass and d.refobjid = t.oid
          and vc.relkind in ('v', 'm') and vc.oid <> t.oid) v),
    'cron_text_reference_hints', (select coalesce(jsonb_agg(jsonb_build_object(
      'job_id', j.jobid, 'name', j.jobname, 'active', j.active, 'schedule', j.schedule
    ) order by j.jobid), '[]'::jsonb) from cron.job j
      where position(lower(t.table_name) in lower(j.command)) > 0)
  ) order by t.table_name), '[]'::jsonb) from targets t),
  'limits', jsonb_build_array(
    'Inactive is not synonymous with obsolete: the comparison endpoint can request a pinned dataset version.',
    'Map tables have no active-release flag here; compare release IDs with the intended backend export.',
    'No deletion is performed. Database dependencies cannot inventory external consumers.'
  )
) as author_data_retention_review;
