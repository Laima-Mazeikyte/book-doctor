-- Database / postgres. Run AFTER the base series migration, before the v2 import.
-- Supports canonical series numbers above 100; preserves all stored values.
-- Safe to repeat. No book rows are rewritten and no published export is reapplied.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

alter table public.book_series_members
  drop constraint book_series_members_series_number_check;
alter table public.book_series_members
  add constraint book_series_members_series_number_check check (
    series_number >= 0.01 and series_number not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
  );

create or replace function private.valid_book_series_record(p_record jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p_record) is distinct from 'object'
    or not p_record ?& array['series_title', 'series_number'] then return false; end if;
  if p_record->'series_title' = 'null'::jsonb and p_record->'series_number' = 'null'::jsonb then
    return true;
  end if;
  if jsonb_typeof(p_record->'series_title') is distinct from 'string'
    or jsonb_typeof(p_record->'series_number') is distinct from 'number' then return false; end if;
  return p_record->>'series_title' = btrim(p_record->>'series_title')
    and p_record->>'series_title' <> ''
    and upper(p_record->>'series_title') not in ('NA', 'N/A')
    and (p_record->>'series_number')::numeric >= 0.01
    and (p_record->>'series_number')::numeric not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric);
end;
$$;

create or replace function private.apply_book_annotation_import(p_export_version text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_export private.book_annotation_exports%rowtype;
  v_count bigint;
  v_matched bigint;
  v_updated bigint;
  v_series_count bigint;
  v_summary jsonb;
begin
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

  if v_export.manifest->'schema_version' = '2'::jsonb then
    if exists (select 1 from private.book_annotation_import_rows s
      where s.export_version = p_export_version and not private.valid_book_series_record(s.record)) then
      raise exception 'Invalid series membership: supply canonical title and finite decimal >= 0.01, or null/null';
    end if;

    insert into public.book_series(series_title)
    select distinct s.record->>'series_title'
    from private.book_annotation_import_rows s join public.books b using (book_id)
    where s.export_version = p_export_version and s.record->>'series_title' is not null
    on conflict (series_title) do nothing;

    delete from public.book_series_members m using private.book_annotation_import_rows s
    where s.export_version = p_export_version and m.book_id = s.book_id;
    insert into public.book_series_members(book_id, series_id, series_number)
    select s.book_id, series.id, (s.record->>'series_number')::numeric
    from private.book_annotation_import_rows s
    join public.books b using (book_id)
    join public.book_series series on series.series_title = s.record->>'series_title'
    where s.export_version = p_export_version;
    get diagnostics v_series_count = row_count;
    delete from public.book_series series where not exists (
      select 1 from public.book_series_members m where m.series_id = series.id
    );
  end if;

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
  if v_series_count is not null then
    v_summary := v_summary || jsonb_build_object('series_memberships_written', v_series_count,
      'books_without_series_in_update', v_matched - v_series_count);
  end if;
  update private.book_annotation_exports set state = 'applied', applied_at = statement_timestamp(), summary = v_summary
    where export_version = p_export_version;
  delete from private.book_annotation_import_rows where export_version = p_export_version;
  return v_summary;
end;
$$;

revoke all on function private.valid_book_series_record(jsonb), private.apply_book_annotation_import(text)
  from public, anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;
