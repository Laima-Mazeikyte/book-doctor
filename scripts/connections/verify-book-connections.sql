-- After successful dataset activation, run as postgres in SQL Editor or psql.
-- Metadata only; no book/vector scan or personalized history read.
select
  r.release_id,
  r.book_count,
  r.minimum_similarity,
  r.activated_at,
  r.manifest ->> 'validation_status' as validation_status,
  pg_size_pretty(pg_total_relation_size(
    format('book_connections.%I', r.table_name)::regclass
  )) as active_table_and_index_size,
  has_function_privilege('authenticated', 'public.get_book_connections(text,integer)', 'execute') as authenticated_rpc,
  has_function_privilege('anon', 'public.get_book_connections(text,integer)', 'execute') as anon_rpc,
  has_schema_privilege('authenticated', 'book_connections', 'usage') as authenticated_private_schema,
  has_schema_privilege('anon', 'book_connections', 'usage') as anon_private_schema,
  has_table_privilege('authenticated', format('book_connections.%I', r.table_name), 'select') as authenticated_vector_select,
  has_table_privilege('anon', format('book_connections.%I', r.table_name), 'select') as anon_vector_select,
  p.prosecdef as security_definer,
  p.provolatile = 'v' as volatile_rpc,
  p.proconfig as function_settings
from book_connections.release r
join pg_catalog.pg_proc p on p.oid = 'public.get_book_connections(text,integer)'::regprocedure
where r.singleton;
