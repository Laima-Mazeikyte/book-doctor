-- Recovery for uploaded rows whose staging table lacks the migration's constraints.
-- FIRST run the delivery's 00-begin.sql to register its manifest and fingerprint.
-- Then run this ENTIRE file in Supabase SQL Editor: Database, postgres.
-- Preserves all staged rows. Does not publish or modify public.books.
-- Restores staging keys, identity checks, RLS and restricted grants in one transaction.
-- An existing different primary key is retained; a unique import key is added.
-- Invalid/duplicate rows or unregistered exports cause rollback; no rows are deleted.
-- Do not rerun the original migrations over the existing schema.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

lock table private.book_annotation_import_rows in access exclusive mode;

do $repair$
declare
  v_keys smallint[];
  v_expected_keys smallint[];
begin
  if current_user <> 'postgres' then
    raise exception 'Run staging recovery as postgres in the SQL Editor';
  end if;
  if (select count(*) from pg_catalog.pg_attribute
      where attrelid = 'private.book_annotation_import_rows'::regclass
        and attnum > 0 and not attisdropped
        and ((attname in ('export_version', 'book_id') and atttypid = 'text'::regtype)
          or (attname = 'record' and atttypid = 'jsonb'::regtype))) <> 3 then
    raise exception 'Unexpected staging column types; recovery rolled back';
  end if;

  alter table private.book_annotation_import_rows
    alter column export_version set not null,
    alter column book_id set not null,
    alter column record set not null;

  select array_agg(a.attnum order by k.position) into v_expected_keys
  from (values ('export_version', 1), ('book_id', 2)) k(name, position)
  join pg_catalog.pg_attribute a on a.attname = k.name
    and a.attrelid = 'private.book_annotation_import_rows'::regclass;
  select conkey into v_keys from pg_catalog.pg_constraint
  where conrelid = 'private.book_annotation_import_rows'::regclass and contype = 'p';
  if v_keys is null then
    alter table private.book_annotation_import_rows add primary key (export_version, book_id);
  elsif v_keys is distinct from v_expected_keys then
    -- A dashboard-created table may already have its own primary key (e.g. id).
    -- Keep it and enforce the importer's composite uniqueness independently.
    if not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'private.book_annotation_import_rows'::regclass
        and contype in ('p', 'u') and conkey = v_expected_keys and not condeferrable
    ) then
      alter table private.book_annotation_import_rows
        add constraint book_annotation_recovery_import_key unique (export_version, book_id);
    end if;
  end if;

  -- Replace only recovery-owned constraints so repeated recovery is safe.
  -- The original migration's constraints, if present, are retained.
  alter table private.book_annotation_import_rows
    drop constraint if exists book_annotation_recovery_export_fk,
    drop constraint if exists book_annotation_recovery_book_id,
    drop constraint if exists book_annotation_recovery_record_identity;
  alter table private.book_annotation_import_rows
    add constraint book_annotation_recovery_export_fk
      foreign key (export_version) references private.book_annotation_exports(export_version),
    add constraint book_annotation_recovery_book_id
      check (book_id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
    add constraint book_annotation_recovery_record_identity check ((
      jsonb_typeof(record) = 'object'
      and record ?& array['book_id', 'book_ranking', 'author_ranking', 'awards']
      and record->>'book_id' = book_id
    ) is true);

  alter table private.book_annotation_import_rows enable row level security;
  revoke all on private.book_annotation_import_rows from public, anon, authenticated, service_role;

  if exists (
    select 1 from (values ('anon'), ('authenticated'), ('service_role')) roles(name)
    where has_table_privilege(roles.name, 'private.book_annotation_import_rows',
      'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  ) then
    raise exception 'An application role retains inherited staging privileges; recovery rolled back';
  end if;
end;
$repair$;
commit;

select jsonb_build_object(
  'staged_books', (select count(*) from private.book_annotation_import_rows),
  'primary_key', (select pg_catalog.pg_get_constraintdef(oid) from pg_catalog.pg_constraint
    where conrelid = 'private.book_annotation_import_rows'::regclass and contype = 'p'),
  'import_key_unique', exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'private.book_annotation_import_rows'::regclass
      and c.contype in ('p', 'u') and not c.condeferrable
      and c.conkey = (select array_agg(a.attnum order by k.position)
        from (values ('export_version', 1), ('book_id', 2)) k(name, position)
        join pg_catalog.pg_attribute a on a.attname = k.name and a.attrelid = c.conrelid)
  ),
  'rls_enabled', (select relrowsecurity from pg_catalog.pg_class
    where oid = 'private.book_annotation_import_rows'::regclass),
  'validated_recovery_constraints', (select count(*) from pg_catalog.pg_constraint
    where conrelid = 'private.book_annotation_import_rows'::regclass and convalidated
      and conname in ('book_annotation_recovery_export_fk', 'book_annotation_recovery_book_id',
        'book_annotation_recovery_record_identity')),
  'authenticated_can_select', has_table_privilege('authenticated', 'private.book_annotation_import_rows', 'SELECT'),
  'anon_can_select', has_table_privilege('anon', 'private.book_annotation_import_rows', 'SELECT'),
  'service_role_can_select', has_table_privilege('service_role', 'private.book_annotation_import_rows', 'SELECT')
) as book_annotation_staging_recovery;
