-- Inventory and validate stored book annotations before changing shared Supabase data.
-- Run this ENTIRE file in the web SQL Editor: source Database, role postgres.
-- Return the final one-row book_annotation_inventory JSON for review.
--
-- READ ONLY, REPEATABLE READ. Catalog metadata plus one aggregate scan of public.books.
-- No application-function execution, schema/data changes, role impersonation, statistics
-- resets, Storage downloads, or user/session/library-row reads. No titles or author names
-- are returned. Function bodies, trigger arguments, and secrets are not exported.
-- A temporary report setting is cleared by the final SELECT, following COMMIT.
--
-- The embedded reference is generated from public book-lab artifacts at their default
-- weights. Count + sorted-ID fingerprints compare whole band memberships, including
-- inherited series volumes. They do NOT prove who publishes the fields or that future
-- releases will update them correctly. Null/unranked rows are reported separately.
-- Display tiers are Top 0.1%, 1%, 5%, 10%. Additional stored bands are also compared.
-- The reference release/time are returned; a later source release requires regeneration.
-- See build-book-annotation-reference.mjs. The user need only run this SQL file.

begin isolation level repeatable read read only;
set local statement_timeout = '20s';
set local lock_timeout = '2s';
set local timezone = 'UTC';

do $inventory$
declare
  -- BEGIN BOOK ANNOTATION REFERENCE
  v_reference jsonb := $reference$
{
  "version": "v9",
  "population_items": 64674,
  "series_items": 9087,
  "mapped_catalog_ids": 100821,
  "ambiguous_ids_excluded": 0,
  "features": [
    "regard",
    "reach",
    "recognition"
  ],
  "default_weights": [
    0.4,
    0.3,
    0.3
  ],
  "band_rule": "1-based default composite rank <= combined population * band share; all mapped series volumes inherit the item band",
  "fingerprint_rule": "md5 of UTF-8 catalog IDs sorted bytewise, joined with LF, without trailing LF; accidental-difference check, not a security signature",
  "bands": [
    {
      "band": "top_0_1_percent",
      "book_count": 75,
      "ids_md5": "442a10ba78efcfa7cfaaea7040830c0e"
    },
    {
      "band": "top_1_percent",
      "book_count": 658,
      "ids_md5": "31b6fe1581e85a3dd960e633d0f8a519"
    },
    {
      "band": "top_5_percent",
      "book_count": 3185,
      "ids_md5": "4c408edc30a5928b5eee03e741323468"
    },
    {
      "band": "top_10_percent",
      "book_count": 4918,
      "ids_md5": "74db6a852fc1237ca85543e413d49fff"
    },
    {
      "band": "top_25_percent",
      "book_count": 15518,
      "ids_md5": "de40183e60fa5890c502e91bec27cc2a"
    },
    {
      "band": "below_top_25",
      "book_count": 76467,
      "ids_md5": "92b24b9fd5628f5c95dab78b3055d012"
    }
  ],
  "captured_at_utc": "2026-10-26T03:53:21.899Z",
  "artifact_base": "https://obkbdcbvxyenfecdbvsz.supabase.co/storage/v1/object/public/lab-book-search",
  "web_root": "versions/v9/web",
  "payload_sha256": "df4afbce0949014f9ac21018f39643688dd0bad0dc8c8eb7332bce51f6a3c531"
}
$reference$::jsonb;
  -- END BOOK ANNOTATION REFERENCE
  v_metadata jsonb;
  v_profile jsonb := jsonb_build_object('available', false, 'reason', 'public.books is absent or is not an ordinary/partitioned table');
  v_books oid;
  v_band_present boolean;
  v_percentile_numeric boolean;
  v_id_present boolean;
  v_band_sql text;
  v_percentile_sql text;
  v_fingerprint_sql text;
  v_group_columns text := '';
  v_dimensions_sql text := '';
  v_column_present boolean;
  v_column_numeric boolean;
  v_dimension record;
  v_position integer := 0;
begin
  with schemas as (
    select n.* from pg_catalog.pg_namespace n
    where n.nspname !~ '^pg_' and n.nspname not in (
      'information_schema', 'auth', 'storage', 'realtime', '_realtime',
      'supabase_functions', 'supabase_migrations', 'extensions', 'vault', 'net', 'cron',
      'graphql', 'graphql_public', 'pgbouncer', 'pgsodium', 'pgsodium_masks',
      '_analytics', '_supavisor', 'migration_archive'
    ) and not exists (
      select 1 from pg_catalog.pg_depend d
      where d.classid = 'pg_catalog.pg_namespace'::regclass and d.objid = n.oid and d.deptype = 'e'
    )
  ), relations as (
    select c.*, n.nspname as schema_name from pg_catalog.pg_class c
    join schemas n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'v', 'm', 'f') and not exists (
      select 1 from pg_catalog.pg_depend d
      where d.classid = 'pg_catalog.pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
    )
  ), columns as (
    select a.*, t.typcategory from pg_catalog.pg_attribute a
    join relations r on r.oid = a.attrelid
    join pg_catalog.pg_type t on t.oid = a.atttypid
    where a.attnum > 0 and not a.attisdropped
  ), candidates as (
    select r.* from relations r where
      (r.schema_name = 'public' and r.relname = 'books')
      or r.relname ~* '(author|series|ranking|quality|prominence|distinction|badge|catalog|release|dataset|book.*(metadata|feature|character|tag|annotation))'
      or exists (
        select 1 from columns a where a.attrelid = r.oid
          and a.attname ~* '(quality|percentile|prominence|distinction|badge|series|regard|recognition|release|dataset|pace_value|atmosphere_value|entry_barrier_value)'
      )
  ), routines as (
    select p.*, n.nspname as schema_name from pg_catalog.pg_proc p
    join schemas n on n.oid = p.pronamespace
    where p.prokind in ('f', 'p') and (
      p.proname ~* '(book|author|series|rank|quality|prominence|distinction|badge|catalog|release|dataset|feed)'
      or p.prosrc ~* '(quality_band|quality_percentile|entry_barrier_value|atmosphere_value)'
    ) and not exists (
      select 1 from pg_catalog.pg_depend d
      where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    )
  )
  select jsonb_build_object(
    'schemas_scanned', (select coalesce(jsonb_agg(nspname order by nspname), '[]'::jsonb) from schemas),
    'candidate_relations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'schema', r.schema_name, 'name', r.relname, 'kind', r.relkind,
        'owner', pg_catalog.pg_get_userbyid(r.relowner),
        'estimated_rows', r.reltuples::bigint,
        'rls_enabled', r.relrowsecurity, 'rls_forced', r.relforcerowsecurity,
        'authenticated_can_select', pg_catalog.has_table_privilege('authenticated', r.oid, 'SELECT'),
        'anon_can_select', pg_catalog.has_table_privilege('anon', r.oid, 'SELECT'),
        'columns', (select jsonb_agg(jsonb_build_object(
          'name', a.attname, 'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
          'not_null', a.attnotnull,
          'comment', left(pg_catalog.col_description(a.attrelid, a.attnum), 500)
        ) order by a.attnum) from columns a where a.attrelid = r.oid)
      ) order by r.schema_name, r.relname), '[]'::jsonb) from candidates r
    ),
    'indexes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'schema', r.schema_name, 'table', r.relname,
        'definition', pg_catalog.pg_get_indexdef(i.indexrelid),
        'valid', i.indisvalid, 'unique', i.indisunique
      ) order by r.schema_name, r.relname, i.indexrelid), '[]'::jsonb)
      from candidates r join pg_catalog.pg_index i on i.indrelid = r.oid
    ),
    'constraints', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'schema', r.schema_name, 'table', r.relname, 'name', c.conname,
        'type', c.contype, 'validated', c.convalidated,
        'definition', pg_catalog.pg_get_constraintdef(c.oid)
      ) order by r.schema_name, r.relname, c.conname), '[]'::jsonb)
      from candidates r join pg_catalog.pg_constraint c on c.conrelid = r.oid
      where c.contype in ('p', 'u', 'f', 'c')
    ),
    'read_policies', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'schema', p.schemaname, 'table', p.tablename, 'name', p.policyname,
        'command', p.cmd, 'roles', p.roles, 'permissive', p.permissive, 'using', p.qual
      ) order by p.schemaname, p.tablename, p.policyname), '[]'::jsonb)
      from pg_catalog.pg_policies p join candidates r
        on r.schema_name = p.schemaname and r.relname = p.tablename
      where p.cmd in ('SELECT', 'ALL')
    ),
    'routine_metadata_without_bodies', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'schema', r.schema_name, 'name', r.proname,
        'identity_arguments', pg_catalog.pg_get_function_identity_arguments(r.oid),
        'result', case when r.prokind = 'f' then pg_catalog.pg_get_function_result(r.oid) end,
        'security_definer', r.prosecdef,
        'authenticated_can_execute', pg_catalog.has_function_privilege('authenticated', r.oid, 'EXECUTE'),
        'anon_can_execute', pg_catalog.has_function_privilege('anon', r.oid, 'EXECUTE'),
        'mentions_quality_fields', r.prosrc ~* '(quality_band|quality_percentile)',
        'mentions_tag_scores', r.prosrc ~* '(pace_value|atmosphere_value|entry_barrier_value)',
        'mentions_series', r.prosrc ~* '(series|constituent)',
        'mentions_ranking_components', r.prosrc ~* '(regard|reach|recognition)'
      ) order by r.schema_name, r.proname, r.oid), '[]'::jsonb) from routines r
    ),
    'triggers_without_arguments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'schema', r.schema_name, 'table', r.relname, 'name', t.tgname,
        'enabled', t.tgenabled, 'function_schema', n.nspname, 'function', p.proname
      ) order by r.schema_name, r.relname, t.tgname), '[]'::jsonb)
      from candidates r join pg_catalog.pg_trigger t on t.tgrelid = r.oid
      join pg_catalog.pg_proc p on p.oid = t.tgfoid
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where not t.tgisinternal
    )
  ) into v_metadata;

  select c.oid into v_books from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'books' and c.relkind in ('r', 'p');

  if v_books is not null then
    select
      exists (select 1 from pg_catalog.pg_attribute where attrelid = v_books and attname = 'quality_band' and attnum > 0 and not attisdropped),
      exists (select 1 from pg_catalog.pg_attribute where attrelid = v_books and attname = 'book_id' and attnum > 0 and not attisdropped),
      exists (select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_type t on t.oid = a.atttypid
        where a.attrelid = v_books and a.attname = 'quality_percentile' and a.attnum > 0 and not a.attisdropped and t.typcategory = 'N')
    into v_band_present, v_id_present, v_percentile_numeric;
    v_band_sql := case when v_band_present then 'b.quality_band::text' else 'null::text' end;
    v_percentile_sql := case when v_percentile_numeric then 'b.quality_percentile' else 'null::numeric' end;
    v_fingerprint_sql := case when v_id_present then
      'md5(coalesce(string_agg(b.book_id::text, E''\n'' order by b.book_id::text collate "C"), ''''))'
      else 'null::text' end;

    for v_dimension in select * from (values
      ('pace_value', 'Fast-paced', 'Introspective'),
      ('vocabulary_value', 'Accessible', 'Demanding'),
      ('depth_value', 'Light', 'Deep'),
      ('originality_value', null, 'Unconventional'),
      ('discussion_potential_value', null, 'Thought-provoking'),
      ('violence_value', null, 'Graphic'),
      ('spice_value', null, 'Explicit'),
      ('atmosphere_value', 'Cozy', null),
      ('entry_barrier_value', null, 'Specialized'),
      ('granularity_value', null, null), ('emotion_value', null, null),
      ('intended_age_value', null, null), ('period_value', null, null),
      ('political_value', null, null), ('narrative_value', null, null),
      ('hierarchy_focus_value', null, null), ('factual_value', null, null)
    ) d(column_name, low_tag, high_tag) loop
      v_position := v_position + 1;
      select count(*) > 0, coalesce(bool_and(t.typcategory = 'N'), false)
        into v_column_present, v_column_numeric
      from pg_catalog.pg_attribute a join pg_catalog.pg_type t on t.oid = a.atttypid
      where a.attrelid = v_books and a.attname = v_dimension.column_name and a.attnum > 0 and not a.attisdropped;
      if v_dimensions_sql <> '' then v_dimensions_sql := v_dimensions_sql || ', '; end if;
      if v_column_present and v_column_numeric then
        v_group_columns := v_group_columns || format($columns$,
          count(b.%1$I) as d%2$s_present,
          count(*) filter (where b.%1$I between 0 and 1) as d%2$s_valid,
          count(*) filter (where b.%1$I between 0 and 0.2) as d%2$s_low,
          count(*) filter (where b.%1$I between 0.8 and 1) as d%2$s_high,
          min(b.%1$I) as d%2$s_min, max(b.%1$I) as d%2$s_max
        $columns$, v_dimension.column_name, v_position);
        v_dimensions_sql := v_dimensions_sql || format($dimension$
          %1$L, jsonb_build_object(
            'present', true, 'numeric', true,
            'low_tag', %3$L, 'high_tag', %4$L,
            'non_null', coalesce(sum(d%2$s_present), 0),
            'missing', coalesce(sum(row_count - d%2$s_present), 0),
            'valid_0_to_1', coalesce(sum(d%2$s_valid), 0),
            'invalid', coalesce(sum(d%2$s_present - d%2$s_valid), 0),
            'at_or_below_0_2', coalesce(sum(d%2$s_low), 0),
            'at_or_above_0_8', coalesce(sum(d%2$s_high), 0),
            'min', min(d%2$s_min), 'max', max(d%2$s_max)
          )
        $dimension$, v_dimension.column_name, v_position, v_dimension.low_tag, v_dimension.high_tag);
      else
        v_dimensions_sql := v_dimensions_sql || format(
          '%L, jsonb_build_object(''present'', %L::boolean, ''numeric'', %L::boolean, ''low_tag'', %L, ''high_tag'', %L)',
          v_dimension.column_name, v_column_present, v_column_numeric, v_dimension.low_tag, v_dimension.high_tag);
      end if;
    end loop;

    execute format($profile$
      with band_stats as materialized (
        select %1$s as band, count(*) as row_count,
          count(%2$s) as percentile_non_null,
          count(*) filter (where %2$s not between 0 and 100) as percentile_invalid,
          count(*) filter (where (%1$s is null) <> (%2$s is null)) as quality_null_pair_mismatches,
          min(%2$s) as percentile_min, max(%2$s) as percentile_max,
          %3$s as ids_md5 %4$s
        from public.books b group by %1$s
      ), expected as (
        select * from jsonb_to_recordset($1->'bands') e(band text, book_count bigint, ids_md5 text)
      ), compared as (
        select coalesce(a.band, e.band) as band, e.book_count as expected_count,
          coalesce(a.row_count, 0) as stored_count, e.ids_md5 as expected_ids_md5,
          coalesce(a.ids_md5, md5('')) as stored_ids_md5,
          coalesce(e.book_count = coalesce(a.row_count, 0)
            and e.ids_md5 = coalesce(a.ids_md5, md5('')), false) as matches
        from band_stats a full join expected e on e.band = a.band
        where coalesce(a.band, e.band) is not null
      )
      select jsonb_build_object(
        'available', true,
        'total_catalog_rows', coalesce(sum(row_count), 0),
        'book_id_present', %6$L::boolean,
        'quality_band_present', %7$L::boolean,
        'quality_percentile_numeric', %8$L::boolean,
        'without_quality_band', coalesce(sum(row_count) filter (where band is null), 0),
        'quality_null_pair_mismatches', coalesce(sum(quality_null_pair_mismatches), 0),
        'invalid_numeric_percentiles', coalesce(sum(percentile_invalid), 0),
        'band_distribution', (select coalesce(jsonb_agg(to_jsonb(s) order by row_count desc, band), '[]'::jsonb)
          from (select band, row_count, percentile_non_null, percentile_min, percentile_max
            from band_stats order by row_count desc, band limit 20) s),
        'stored_tag_score_coverage', jsonb_build_object(%5$s),
        'default_lab_band_comparison', jsonb_build_object(
          'reference', $1 - 'bands',
          'reference_bands', (select count(*) from expected),
          'all_display_band_memberships_match', %6$L::boolean and %7$L::boolean
            and (select count(*) from expected) = 6
            and coalesce((select bool_and(matches) from compared where band in
              ('top_0_1_percent', 'top_1_percent', 'top_5_percent', 'top_10_percent')), false),
          'all_nonnull_band_memberships_match', %6$L::boolean and %7$L::boolean
            and (select count(*) from expected) = 6
            and coalesce((select bool_and(matches) from compared), false),
          'comparisons', (select coalesce(jsonb_agg(to_jsonb(c) order by band), '[]'::jsonb)
            from (select * from compared order by band limit 20) c)
        )
      ) from band_stats
    $profile$, v_band_sql, v_percentile_sql, v_fingerprint_sql, v_group_columns,
      v_dimensions_sql, v_id_present, v_band_present, v_percentile_numeric)
    into v_profile using v_reference;
  end if;

  perform set_config('book_doctor_diagnostics.book_annotation_inventory', jsonb_build_object(
    'environment', jsonb_build_object(
      'captured_at_utc', statement_timestamp(), 'role', current_user,
      'postgres_version', current_setting('server_version'),
      'read_only', current_setting('transaction_read_only'),
      'isolation', current_setting('transaction_isolation')
    ),
    'scope', jsonb_build_array(
      'Only public.books catalog rows are aggregated. Other candidate relations are metadata-only.',
      'Names/column matches discover candidates; author connections are not automatically author prominence.',
      'Stored book band membership is compared against the embedded default-ranking reference, including series inheritance.',
      'These checks do not establish quality_percentile direction/formula or an external publication process.',
      'A matching release reference proves current membership agreement, not automatic future synchronization.',
      'SQL does not download Storage JSON or inspect external backend code.',
      'Privileges/policies are inventoried; postgres aggregate timing/visibility is not an app RLS/API performance test.',
      'Threshold counts are descriptive. Missing scores do not mean a measured middle score.'
    ),
    'metadata', v_metadata,
    'books_profile', v_profile
  )::text, false);
end;
$inventory$;

commit;

with captured as materialized (
  select nullif(current_setting('book_doctor_diagnostics.book_annotation_inventory', true), '')::jsonb as report
)
select report as book_annotation_inventory
from captured
where set_config('book_doctor_diagnostics.book_annotation_inventory', '', false) = '';
