-- Run this entire migration in the Supabase web SQL Editor as postgres.
-- Additive storage only; existing production columns and RPCs are unchanged.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

create schema if not exists private;

create function private.book_annotation_band(p_rank numeric, p_population numeric)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_rank <= p_population * 0.001 then 'top_0_1_percent'
    when p_rank <= p_population * 0.01 then 'top_1_percent'
    when p_rank <= p_population * 0.05 then 'top_5_percent'
    when p_rank <= p_population * 0.1 then 'top_10_percent'
    else null end;
$$;

create function private.valid_book_annotation_ranking(p_value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_rank numeric; v_population numeric;
begin
  if p_value is null then return true; end if;
  if jsonb_typeof(p_value) <> 'object'
    or not p_value ?& array['rank', 'band', 'population_count', 'version']
    or jsonb_typeof(p_value->'rank') <> 'number'
    or jsonb_typeof(p_value->'population_count') <> 'number'
    or jsonb_typeof(p_value->'version') <> 'string'
    or nullif(btrim(p_value->>'version'), '') is null
    or length(p_value->>'version') > 200 then return false; end if;
  v_rank := (p_value->>'rank')::numeric;
  v_population := (p_value->>'population_count')::numeric;
  return v_rank between 1 and 2147483647 and v_rank = trunc(v_rank)
    and v_population between v_rank and 2147483647 and v_population = trunc(v_population)
    and (p_value->>'band') is not distinct from private.book_annotation_band(v_rank, v_population)
    and (not p_value ? 'series_title' or jsonb_typeof(p_value->'series_title') in ('string', 'null'));
end;
$$;

create function private.valid_book_annotation_awards(p_value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_entry jsonb; v_year numeric;
begin
  if p_value is null then return true; end if;
  if jsonb_typeof(p_value) <> 'array' then return false; end if;
  for v_entry in select value from jsonb_array_elements(p_value) loop
    if jsonb_typeof(v_entry) <> 'object'
      or not v_entry ?& array['tier', 'name', 'status', 'year']
      or jsonb_typeof(v_entry->'tier') <> 'number'
      or jsonb_typeof(v_entry->'name') <> 'string'
      or nullif(btrim(v_entry->>'name'), '') is null
      or coalesce(v_entry->>'status', '') not in ('winner', 'nominee') then return false; end if;
    if (v_entry->>'tier')::numeric not in (1, 2, 3, 4, 5) then return false; end if;
    if jsonb_typeof(v_entry->'year') = 'number' then
      v_year := (v_entry->>'year')::numeric;
      if v_year <> trunc(v_year) or v_year not between -2147483648 and 2147483647 then return false; end if;
    elsif jsonb_typeof(v_entry->'year') <> 'null' then return false;
    end if;
  end loop;
  return true;
end;
$$;

create table private.book_annotation_exports (
  export_version text primary key,
  manifest jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'staging' check (state in ('staging', 'applied')),
  created_at timestamptz not null default statement_timestamp(),
  applied_at timestamptz,
  summary jsonb,
  constraint book_annotation_manifest_object check (
    jsonb_typeof(manifest) = 'object' and manifest->>'export_version' = export_version
    and manifest->>'schema_version' = '1'
  )
);
create table private.book_annotation_import_rows (
  export_version text not null references private.book_annotation_exports(export_version),
  book_id text not null check (book_id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  record jsonb not null,
  primary key (export_version, book_id),
  constraint book_annotation_record_identity check ((
    jsonb_typeof(record) = 'object'
    and record ?& array['book_id', 'book_ranking', 'author_ranking', 'awards']
    and record->>'book_id' = book_id
  ) is true)
);

alter table private.book_annotation_exports enable row level security;
alter table private.book_annotation_import_rows enable row level security;

alter table public.books
  add column book_ranking jsonb,
  add column author_ranking jsonb,
  add column awards jsonb,
  add column annotation_export_version text references private.book_annotation_exports(export_version),
  add column annotations_updated_at timestamptz,
  add constraint books_book_ranking_valid check (private.valid_book_annotation_ranking(book_ranking)),
  add constraint books_author_ranking_valid check (private.valid_book_annotation_ranking(author_ranking)),
  add constraint books_awards_valid check (private.valid_book_annotation_awards(awards));

comment on column public.books.book_ranking is 'Published default composite standing in the combined book/series population. Separate from legacy quality_band.';
comment on column public.books.author_ranking is 'Published default composite standing of the exact matched author.';
comment on column public.books.awards is 'Final backend-assigned awards, including series inheritance: tier 1-5, name, winner/nominee status, nullable year. NULL unknown; [] none.';

create function private.apply_book_annotation_import(p_export_version text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_export private.book_annotation_exports%rowtype;
  v_count bigint;
  v_matched bigint;
  v_updated bigint;
  v_summary jsonb;
begin
  -- Serialize publications; ordinary book reads continue under MVCC.
  perform pg_catalog.pg_advisory_xact_lock(19730101, 20261025);
  select * into v_export from private.book_annotation_exports
    where export_version = p_export_version for update;
  if not found then raise exception 'Annotation export is not staged'; end if;
  if v_export.state = 'applied' then return v_export.summary; end if;
  select count(*) into v_count from private.book_annotation_import_rows where export_version = p_export_version;
  if v_count is distinct from (v_export.manifest->>'record_count')::bigint then
    raise exception 'Incomplete annotation staging: expected %, received %', v_export.manifest->>'record_count', v_count;
  end if;
  if exists (
    select 1 from private.book_annotation_import_rows s join public.books b using (book_id)
    where s.export_version = p_export_version
      and (nullif(btrim(b.book_name), '') is null or nullif(btrim(b.author), '') is null)
  ) then raise exception 'Invalid catalog identity: title and author are required'; end if;

  select count(*) into v_matched from private.book_annotation_import_rows s
    join public.books b using (book_id) where s.export_version = p_export_version;

  update public.books b set
    book_ranking = case when nullif(s.record->'book_ranking', 'null'::jsonb) is null then null else
      s.record->'book_ranking' || jsonb_build_object(
        'population_count', v_export.manifest#>'{ranking_sources,book,population_count}',
        'version', v_export.manifest#>'{ranking_sources,book,version}') end,
    author_ranking = case when nullif(s.record->'author_ranking', 'null'::jsonb) is null then null else
      s.record->'author_ranking' || jsonb_build_object(
        'population_count', v_export.manifest#>'{ranking_sources,author,population_count}',
        'version', v_export.manifest#>'{ranking_sources,author,version}') end,
    awards = nullif(s.record->'awards', 'null'::jsonb),
    annotation_export_version = p_export_version,
    annotations_updated_at = statement_timestamp()
  from private.book_annotation_import_rows s
  where s.export_version = p_export_version and b.book_id = s.book_id;
  get diagnostics v_updated = row_count;
  v_summary := jsonb_build_object('export_version', p_export_version, 'exported_books', v_count,
    'matched_books', v_matched, 'updated_books', v_updated, 'unmatched_export_ids', v_count - v_matched);
  update private.book_annotation_exports set state = 'applied', applied_at = statement_timestamp(), summary = v_summary
    where export_version = p_export_version;
  delete from private.book_annotation_import_rows where export_version = p_export_version;
  return v_summary;
end;
$$;

-- No new HTTP write endpoint or reader access to import staging/audit records.
revoke all on private.book_annotation_exports, private.book_annotation_import_rows from public, anon, authenticated, service_role;
revoke all on function private.book_annotation_band(numeric, numeric),
  private.valid_book_annotation_ranking(jsonb), private.valid_book_annotation_awards(jsonb),
  private.apply_book_annotation_import(text) from public, anon, authenticated, service_role;
-- Existing trusted service-role catalog updates still evaluate the new CHECKs.
grant usage on schema private to service_role;
grant execute on function private.book_annotation_band(numeric, numeric),
  private.valid_book_annotation_ranking(jsonb), private.valid_book_annotation_awards(jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
