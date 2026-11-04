-- Run the ENTIRE file in Supabase SQL Editor as postgres after activation.
-- Reads feature/catalog data and checks privileges; no schema or data changes.
-- Uses a known supported book (The Hunger Games) and local PL/pgSQL variables.
-- No session-setting dependency, cross-transaction state or JWT credentials.

do $verify$
declare
  v_book_id constant text := '01KR2ADTFG9DJ85AS30MZFHJG6';
  v_anon jsonb;
  v_authenticated jsonb;
  v_role text;
  v_relation record;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if not pg_catalog.has_function_privilege(v_role, 'public.get_book_discovery(text)', 'EXECUTE') then
      raise exception 'Discovery RPC is not executable by %', v_role;
    end if;
    if pg_catalog.has_schema_privilege(v_role, 'book_discovery', 'USAGE') then
      raise exception 'Private schema exposed to %', v_role;
    end if;
    for v_relation in
      select c.oid from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'book_discovery' and c.relkind in ('r', 'v')
    loop
      if pg_catalog.has_table_privilege(v_role, v_relation.oid, 'SELECT') then
        raise exception 'Private discovery relation readable by %', v_role;
      end if;
    end loop;
  end loop;

  execute 'SET LOCAL ROLE anon';
  select public.get_book_discovery(v_book_id) into v_anon;
  execute 'RESET ROLE';
  execute 'SET LOCAL ROLE authenticated';
  select public.get_book_discovery(v_book_id) into v_authenticated;
  execute 'RESET ROLE';

  if v_anon is distinct from v_authenticated then
    raise exception 'Anonymous/authenticated results differ for %', v_book_id;
  end if;
  if v_anon->>'book_id' is distinct from v_book_id
    or nullif(v_anon->>'release_id', '') is null
    or pg_catalog.jsonb_typeof(v_anon->'similar_experience') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_anon->'different_direction') is distinct from 'array' then
    raise exception 'Discovery response is missing the expected identity, release or arrays';
  end if;
  if pg_catalog.jsonb_array_length(v_anon->'similar_experience') = 0
    or pg_catalog.jsonb_array_length(v_anon->'different_direction') = 0 then
    raise exception 'Known supported book returned an empty section; inspect catalog mapping and visibility';
  end if;
end
$verify$;

with representative as materialized (
  select public.get_book_discovery('01KR2ADTFG9DJ85AS30MZFHJG6') as result
)
select r.release_id, r.activated_at,
  r.manifest->'catalog_resolution' as catalog_resolution,
  pg_catalog.jsonb_array_length(p.result->'similar_experience') as similar_count,
  pg_catalog.jsonb_array_length(p.result->'different_direction') as different_count,
  p.result as representative_lookup,
  public.get_book_discovery('00000000000000000000000000') as unknown_book_empty
from book_discovery.release r cross join representative p;
