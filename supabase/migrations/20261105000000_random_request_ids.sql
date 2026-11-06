-- Public request references are random; internal keys and webhook contracts stay numeric.
begin;

create schema if not exists private;

create function private.random_request_id_candidate()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  value bigint;
  candidate text;
begin
  loop
    -- The first 48 UUID bits are random (before the version/variant bits).
    value := ('x' || substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 12))::bit(48)::bigint;
    -- Rejection sampling avoids modulo bias across all 62^8 possibilities.
    if value >= 218340105584896 then continue; end if;
    candidate := '';
    for i in 1..8 loop
      candidate := substr(alphabet, (value % 62)::integer + 1, 1) || candidate;
      value := value / 62;
    end loop;
    -- A letter distinguishes public IDs from every historical numeric link.
    if candidate ~ '[A-Za-z]' then return candidate; end if;
  end loop;
end;
$$;
revoke all on function private.random_request_id_candidate() from public, anon, authenticated;

alter table public.recommendation_requests add column public_id text collate "C";
alter table public.feed_requests add column public_id text collate "C";
create unique index recommendation_requests_public_id_key on public.recommendation_requests(public_id);
create unique index feed_requests_public_id_key on public.feed_requests(public_id);

create function public.assign_random_request_public_id()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
declare
  candidate text;
  already_used boolean;
begin
  if tg_table_schema <> 'public' or tg_table_name not in ('recommendation_requests', 'feed_requests') then
    raise exception 'Unsupported request table';
  end if;
  if tg_op = 'UPDATE' and old.public_id is not null then
    if new.public_id is distinct from old.public_id then
      raise exception 'Public request IDs cannot be changed' using errcode = '428C9';
    end if;
    return new;
  end if;
  if new.public_id is not null then
    raise exception 'Public request IDs are generated automatically' using errcode = '428C9';
  end if;
  loop
    candidate := private.random_request_id_candidate();
    if not pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtext(tg_table_schema || '.' || tg_table_name), pg_catalog.hashtext(candidate)
    ) then continue; end if;
    execute pg_catalog.format('select exists(select 1 from %I.%I where public_id = $1)', tg_table_schema, tg_table_name)
      into already_used using candidate;
    -- Includes other owners' rows despite RLS; occupied IDs are retried.
    if not already_used then
      new.public_id := candidate;
      return new;
    end if;
  end loop;
end;
$$;
revoke all on function public.assign_random_request_public_id() from public, anon, authenticated;

create trigger assign_random_request_public_id
before insert or update of public_id on public.recommendation_requests
for each row execute function public.assign_random_request_public_id();
create trigger assign_random_request_public_id
before insert or update of public_id on public.feed_requests
for each row execute function public.assign_random_request_public_id();

-- Historical rows get public aliases; their primary keys and result references stay intact.
update public.recommendation_requests set public_id = null;
update public.feed_requests set public_id = null;
alter table public.recommendation_requests alter column public_id set not null;
alter table public.feed_requests alter column public_id set not null;
alter table public.recommendation_requests add constraint recommendation_requests_public_id_format
  check (public_id ~ '^[A-Za-z0-9]{8}$' and public_id ~ '[A-Za-z]');
alter table public.feed_requests add constraint feed_requests_public_id_format
  check (public_id ~ '^[A-Za-z0-9]{8}$' and public_id ~ '[A-Za-z]');

-- Keep feed bootstrap at one round trip and keep existing/backend RPCs intact.
create function public.get_rate_feed_bootstrap_public(p_limit integer default 100)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with payload as materialized (
    select public.get_rate_feed_bootstrap_annotated(p_limit) as data
  )
  select data || jsonb_build_object(
    'request_id', coalesce((select public_id from public.feed_requests
      where id = nullif(data->>'request_id', '')::bigint), ''),
    'latest_request_id', (select public_id from public.feed_requests
      where id = nullif(data->>'latest_request_id', '')::bigint)
  ) from payload;
$$;
revoke all on function public.get_rate_feed_bootstrap_public(integer) from public, anon;
grant execute on function public.get_rate_feed_bootstrap_public(integer) to authenticated, service_role;

commit;
