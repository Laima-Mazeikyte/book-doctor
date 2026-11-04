-- Run the whole file in Supabase SQL Editor as postgres before installation.
-- Read-only metadata preflight: no book/user scan or schema/data changes.
-- Checks the current Dashboard package's admin-inheritance assumption, catalog
-- visibility, identity types, grants and indexes. It does not install anything.
begin read only;

do $preflight$
declare v_admin record; v_column text;
begin
  select rolsuper, rolcreaterole, rolinherit into v_admin
    from pg_catalog.pg_roles where rolname = current_user;
  if current_user <> 'postgres' then
    raise exception 'Choose the postgres role in Supabase SQL Editor';
  end if;
  if not (v_admin.rolsuper or v_admin.rolcreaterole) then
    raise exception 'The installer needs CREATEROLE';
  end if;
  if not (v_admin.rolsuper or v_admin.rolinherit) then
    raise exception 'Current package cannot reliably repeat setup under a NOINHERIT admin. Obtain the backend ownership fix before installing; do not change global role settings';
  end if;
  if not v_admin.rolsuper and exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.get_book_discovery(text)')
      and not pg_catalog.pg_has_role(current_user, p.proowner, 'USAGE')
  ) then
    raise exception 'Admin does not inherit ownership of the installed discovery RPC. Obtain the backend ownership fix before replacing it';
  end if;
  if pg_catalog.to_regclass('public.books') is null then
    raise exception 'Expected public.books';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')
    or not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    raise exception 'Expected Supabase anon/authenticated roles';
  end if;
  if not pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE WITH GRANT OPTION')
    or not pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE WITH GRANT OPTION') then
    raise exception 'Installer needs grantable public schema CREATE/USAGE';
  end if;
  foreach v_column in array array['id', 'book_id', 'slug', 'book_name', 'author'] loop
    if not exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.books'::regclass and a.attname = v_column
        and a.attnum > 0 and not a.attisdropped and a.attnotnull
        and a.atttypid = case when v_column = 'id' then 'uuid'::regtype else 'text'::regtype end
    ) then
      raise exception 'Expected NOT NULL public.books.% with the catalog identity type', v_column;
    end if;
    if not pg_catalog.has_column_privilege(current_user, 'public.books', v_column, 'SELECT WITH GRANT OPTION') then
      raise exception 'Installer needs grantable SELECT on public.books.%', v_column;
    end if;
  end loop;
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.books'::regclass)
    or not exists (
      select 1 from pg_catalog.pg_policy where polrelid = 'public.books'::regclass
        and polcmd in ('r', '*') and polpermissive and 0 = any(polroles)
        and pg_catalog.pg_get_expr(polqual, polrelid) = 'true'
    ) or exists (
      select 1 from pg_catalog.pg_policy where polrelid = 'public.books'::regclass
        and polcmd in ('r', '*') and not polpermissive
    ) then
    raise exception 'Catalog RLS differs from this package''s supported public-read policy; review before installation';
  end if;
  foreach v_column in array array['id', 'book_id'] loop
    if not exists (
      select 1 from pg_catalog.pg_index i
      join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
      where i.indrelid = 'public.books'::regclass and a.attname = v_column
        and i.indisunique and i.indisvalid and i.indisready and i.indnkeyatts = 1
        and i.indpred is null and i.indexprs is null
    ) then
      raise exception 'Expected usable unique index on public.books.%', v_column;
    end if;
  end loop;
end
$preflight$;

select 'ready' as preflight,
  current_database() as database_name,
  current_user as database_user,
  pg_catalog.to_regprocedure('public.get_book_discovery(text)') as existing_rpc,
  pg_catalog.to_regclass('book_discovery.incoming') is not null as staging_exists;

rollback;
