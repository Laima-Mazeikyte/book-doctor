-- Generated v2 delivery preview. Database / postgres. One read-only SELECT.
-- Requires 20261028000000_book_series.sql. Does not publish data.
with parameters(export_version) as (
  values ('book-annotations-test-001'::text)
), target as materialized (
  select e.* from private.book_annotation_exports e join parameters p using (export_version)
), candidates as materialized (
  select b.book_id is not null as matches_catalog,
    b.book_id is not null and (
      nullif(btrim(b.book_name), '') is null or nullif(btrim(b.author), '') is null
    ) as invalid_core_identity,
    private.valid_book_series_record(s.record) as valid_series,
    s.record->>'series_title' as series_title,
    case when nullif(s.record->'book_ranking', 'null'::jsonb) is null then null else
      s.record->'book_ranking' || jsonb_build_object(
        'population_count', e.manifest#>'{ranking_sources,book,population_count}',
        'version', e.manifest#>'{ranking_sources,book,version}') end as book_ranking,
    case when nullif(s.record->'author_ranking', 'null'::jsonb) is null then null else
      s.record->'author_ranking' || jsonb_build_object(
        'population_count', e.manifest#>'{ranking_sources,author,population_count}',
        'version', e.manifest#>'{ranking_sources,author,version}') end as author_ranking,
    nullif(s.record->'awards', 'null'::jsonb) as awards
  from private.book_annotation_import_rows s join target e using (export_version)
  left join public.books b using (book_id)
), counts as (
  select count(*) as staged_books,
    count(*) filter (where matches_catalog) as matching_books,
    count(*) filter (where not matches_catalog) as unmatched_export_ids,
    count(*) filter (where invalid_core_identity) as invalid_core_identities,
    count(*) filter (where not coalesce(valid_series, false)) as invalid_series_rows,
    count(*) filter (where matches_catalog and series_title is not null) as series_memberships_in_update,
    count(distinct series_title) filter (where matches_catalog) as series_in_update,
    count(*) filter (where not coalesce(
      private.valid_book_annotation_ranking(book_ranking)
      and private.valid_book_annotation_ranking(author_ranking)
      and private.valid_book_annotation_awards(awards), false
    )) as invalid_annotation_rows
  from candidates
)
select jsonb_build_object(
  'export_version', (select export_version from parameters),
  'export_found', exists (select 1 from target),
  'state', (select state from target),
  'schema_version', (select manifest->'schema_version' from target),
  'expected_books', (select (manifest->>'record_count')::bigint from target),
  'staged_books', c.staged_books, 'matching_books', c.matching_books,
  'unmatched_export_ids', c.unmatched_export_ids,
  'invalid_core_identities', c.invalid_core_identities,
  'invalid_annotation_rows', c.invalid_annotation_rows,
  'invalid_series_rows', c.invalid_series_rows,
  'series_memberships_in_update', c.series_memberships_in_update,
  'series_in_update', c.series_in_update,
  'ready_to_apply', coalesce(
    (select state = 'staging' and manifest->'schema_version' = '2'::jsonb
      and (manifest->>'record_count')::bigint = c.staged_books from target)
    and c.matching_books > 0 and c.invalid_core_identities = 0
    and c.invalid_annotation_rows = 0 and c.invalid_series_rows = 0, false
  )
) as book_annotation_import_preview from counts c;
