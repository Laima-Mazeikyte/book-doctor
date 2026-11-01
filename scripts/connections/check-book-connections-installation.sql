-- Read-only preflight. Run as postgres before the backend psql installer.
-- No catalog scan, table changes, import, or activation.
do $preflight$
begin
  if to_regprocedure('auth.uid()') is null then
    raise exception 'Expected Supabase auth.uid()';
  end if;
  if to_regclass('public.user_ratings') is null then
    raise exception 'Expected public.user_ratings';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_ratings'
      and column_name = 'user_id' and udt_name = 'uuid'
  ) then
    raise exception 'user_ratings.user_id must be uuid';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_ratings'
      and column_name = 'book_id' and udt_name in ('text', 'varchar', 'bpchar')
  ) then
    raise exception 'user_ratings.book_id must store canonical ULID text; do not run against the historical integer schema';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_ratings'
      and column_name = 'book_rating'
      and udt_name in ('int2', 'int4', 'int8', 'float4', 'float8', 'numeric')
  ) then
    raise exception 'user_ratings.book_rating must be numeric';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_index i
    join pg_catalog.pg_attribute a on a.attrelid = i.indrelid
      and a.attnum = i.indkey[0]
    where i.indrelid = 'public.user_ratings'::regclass
      and a.attname = 'user_id' and i.indisvalid and i.indisready
      and i.indpred is null
  ) then
    raise exception 'Expected a valid nonpartial user_ratings index beginning with user_id';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'book_connections' and table_name = 'embeddings'
      and column_name = 'book_id' and udt_name <> 'uuid'
  ) then
    raise exception 'Installed v1 book_connections schema needs a backend migration; this installer is v2';
  end if;
end
$preflight$;

select 'ready' as preflight,
  current_database() as database_name,
  current_user as database_user,
  to_regprocedure('public.get_book_connections(text,integer)') as existing_rpc;
