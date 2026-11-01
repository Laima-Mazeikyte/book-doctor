-- Optional cleanup of regenerable map exports unused by the current frontend.
-- SQL Editor: Database, postgres. Run this ENTIRE file after reviewing the scope.
-- The user confirmed Supabase data has no consumers outside the frontend.
-- Current frontend computes neighborhoods from published Storage coordinates.
-- Clears ONLY private.author_map_neighbors and private.author_map_nodes contents.
-- Preserves tables/keys/grants and all comparison datasets/reaction sets/validated pairs.
-- Refuses unexpected live dependencies. No CASCADE, DROP, role or policy changes.
-- Static text/dependency checks cannot detect arbitrarily constructed dynamic SQL.
-- SQL source review plus the user's consumer inventory supplies that remaining context.
begin;
set local statement_timeout = '20s';
set local lock_timeout = '2s';

do $reclaim$
declare
  v_targets oid[];
  v_conflicts jsonb;
  v_before bigint;
  v_after bigint;
  v_nodes bigint;
  v_neighbors bigint;
begin
  if current_user <> 'postgres' then
    raise exception 'Run map-export cleanup as postgres in the SQL Editor';
  end if;
  select array_agg(c.oid) into v_targets from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private' and c.relname in ('author_map_nodes', 'author_map_neighbors')
    and c.relkind = 'r';
  if coalesce(array_length(v_targets, 1), 0) <> 2 then
    raise exception 'Expected two ordinary private map tables; cleanup skipped';
  end if;
  lock table private.author_map_neighbors, private.author_map_nodes in access exclusive mode;

  select jsonb_agg(jsonb_build_object('name', c.conname, 'from_table', c.conrelid::regclass::text))
  into v_conflicts from pg_catalog.pg_constraint c
  where c.contype = 'f' and c.confrelid = any(v_targets) and not c.conrelid = any(v_targets);
  if v_conflicts is not null then
    raise exception 'Other tables reference the map data; cleanup skipped: %', v_conflicts;
  end if;

  select jsonb_agg(jsonb_build_object('schema', n.nspname, 'name', p.proname,
    'arguments', pg_catalog.pg_get_function_identity_arguments(p.oid))) into v_conflicts
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where p.prokind in ('f', 'p') and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
    and (position('author_map_nodes' in lower(p.prosrc)) > 0
      or position('author_map_neighbors' in lower(p.prosrc)) > 0
      or exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_proc'::regclass
        and d.objid = p.oid and (
          (d.refclassid = 'pg_catalog.pg_class'::regclass and d.refobjid = any(v_targets))
          or (d.refclassid = 'pg_catalog.pg_type'::regclass and d.refobjid in (
            select c.reltype from pg_catalog.pg_class c where c.oid = any(v_targets)
            union all select t.typarray from pg_catalog.pg_type t join pg_catalog.pg_class c
              on c.reltype = t.oid where c.oid = any(v_targets)
          )))));
  if v_conflicts is not null then
    raise exception 'Stored routines reference the map tables; cleanup skipped: %', v_conflicts;
  end if;

  select jsonb_agg(jsonb_build_object('schema', v.schema_name, 'view', v.view_name)) into v_conflicts
  from (select distinct n.nspname as schema_name, c.relname as view_name
    from pg_catalog.pg_depend d
    join pg_catalog.pg_rewrite rw on d.classid = 'pg_catalog.pg_rewrite'::regclass and rw.oid = d.objid
    join pg_catalog.pg_class c on c.oid = rw.ev_class
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where d.refclassid = 'pg_catalog.pg_class'::regclass and d.refobjid = any(v_targets)
      and c.relkind in ('v', 'm')) v;
  if v_conflicts is not null then
    raise exception 'Views reference the map data; cleanup skipped: %', v_conflicts;
  end if;

  select jsonb_agg(jsonb_build_object('table', tr.tgrelid::regclass::text, 'trigger', tr.tgname))
  into v_conflicts from pg_catalog.pg_trigger tr
  where tr.tgrelid = any(v_targets) and not tr.tgisinternal;
  if v_conflicts is not null then
    raise exception 'Custom map-table triggers need review; cleanup skipped: %', v_conflicts;
  end if;

  if to_regclass('cron.job') is not null then
    execute $jobs$
      select jsonb_agg(jsonb_build_object('job_id', jobid, 'name', jobname, 'active', active))
      from cron.job where position('author_map_nodes' in lower(command)) > 0
        or position('author_map_neighbors' in lower(command)) > 0
    $jobs$ into v_conflicts;
    if v_conflicts is not null then
      raise exception 'Cron commands reference map tables; cleanup skipped: %', v_conflicts;
    end if;
  end if;

  select count(*) into v_nodes from private.author_map_nodes;
  select count(*) into v_neighbors from private.author_map_neighbors;
  select sum(pg_catalog.pg_total_relation_size(t)) into v_before from unnest(v_targets) t;
  truncate table only private.author_map_neighbors, only private.author_map_nodes continue identity restrict;
  select sum(pg_catalog.pg_total_relation_size(t)) into v_after from unnest(v_targets) t;

  perform set_config('book_doctor_diagnostics.author_map_reclaim', jsonb_build_object(
    'removed_node_rows', v_nodes, 'removed_neighbor_rows', v_neighbors,
    'bytes_before', v_before, 'bytes_after', v_after,
    'bytes_reclaimed', greatest(v_before - v_after, 0),
    'space_reclaimed', pg_catalog.pg_size_pretty(greatest(v_before - v_after, 0))
  )::text, false);
end;
$reclaim$;
commit;

with captured as materialized (
  select nullif(current_setting('book_doctor_diagnostics.author_map_reclaim', true), '')::jsonb as report
)
select report as author_map_data_reclamation
from captured
where set_config('book_doctor_diagnostics.author_map_reclaim', '', false) = '';
