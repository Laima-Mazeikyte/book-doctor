-- Apply before deploying /books/[slug]. No legacy URL redirects are installed.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '120s';

create schema if not exists private;
alter table public.books add column slug text;
create unique index books_slug_key on public.books (slug);
alter table public.books add constraint books_slug_format check (
  slug ~ '^[[:alnum:]]+(-[[:alnum:]]+)*$'
  and slug = lower(slug) and octet_length(slug) <= 2000
);

create function private.book_slug_words(p_text text)
returns text language sql immutable strict set search_path = '' as $fn$
  select btrim(regexp_replace(
    replace(replace(lower(regexp_replace(normalize(p_text, NFKD),
      U&'[\0300-\036f\1ab0-\1aff\1dc0-\1dff\20d0-\20ff\fe20-\fe2f]', '', 'g')), '''', ''), '’', ''),
    '[^[:alnum:]]+', '-', 'g'), '-');
$fn$;

create function private.book_slug_prefix(p_text text, p_limit integer)
returns text language sql immutable strict set search_path = '' as $fn$
  select case when length(p_text) <= p_limit then p_text
    when position('-' in left(p_text, p_limit + 1)) > 0
      then regexp_replace(left(p_text, p_limit + 1), '-[^-]*$', '')
    else left(p_text, p_limit) end;
$fn$;

create function private.book_slug_base(p_title text, p_author text)
returns text language plpgsql immutable set search_path = '' as $fn$
declare
  v_title text := private.book_slug_words(coalesce(p_title, ''));
  v_author text := private.book_slug_words(coalesce(p_author, ''));
  v_short text;
  v_qualifier text;
  v_match text[];
begin
  -- Approved institution labels. Ordinary published names stay intact.
  v_author := case v_author
    when 'the-church-of-jesus-christ-of-latter-day-saints'
      then 'church-of-jesus-christ-latter-day-saints'
    when 'national-commission-on-terrorist-attacks-upon-the-united-states'
      then '9-11-commission'
    else v_author end;
  if v_title = '' or v_author = '' then
    raise exception 'Public book URLs require a title and author';
  end if;
  v_short := private.book_slug_prefix(v_title, 60);
  if length(v_title) > 60 then
    -- A prefix must not erase the volume/part that identifies a distinct book.
    for v_match in select regexp_matches(v_title,
      '(?:^|-)((?:vol(?:ume)?|part|book|miracle)-[0-9]+)(?:-|$)', 'g') loop
      v_qualifier := regexp_replace(v_match[1], '^volume-', 'vol-');
    end loop;
    if v_qualifier is null and v_title ~ '-[0-9]+$' then
      v_qualifier := substring(v_title from '[0-9]+$');
    end if;
    if v_title ~ '-young-readers-edition$' then v_qualifier := 'young-readers-edition'; end if;
    if v_qualifier is not null
      and position('-' || v_qualifier || '-' in '-' || v_short || '-') = 0 then
      v_short := private.book_slug_prefix(v_title, greatest(1, 59 - length(v_qualifier)))
        || '-' || v_qualifier;
    end if;
  end if;
  return v_short || '-' || v_author;
end;
$fn$;

create function private.assign_book_slug()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare v_base text; v_candidate text; v_suffix integer := 1;
begin
  if tg_op = 'UPDATE' and old.slug is not null then
    if new.slug is distinct from old.slug then
      raise exception 'Public book slugs are permanent';
    end if;
    return new;
  end if;
  if new.slug is not null then return new; end if;
  v_base := private.book_slug_base(new.book_name, new.author);
  -- One catalog-allocation lock also supports large imports without consuming
  -- a separate transaction lock for every title. Existing metadata edits skip this.
  perform pg_advisory_xact_lock(20261027, 1);
  v_candidate := v_base;
  while exists (select 1 from public.books where slug = v_candidate) loop
    v_suffix := v_suffix + 1;
    v_candidate := v_base || '-' || v_suffix;
  end loop;
  new.slug := v_candidate;
  return new;
end;
$fn$;

revoke all on function private.book_slug_words(text) from public, anon, authenticated;
revoke all on function private.book_slug_prefix(text, integer) from public, anon, authenticated;
revoke all on function private.book_slug_base(text, text) from public, anon, authenticated;
revoke all on function private.assign_book_slug() from public, anon, authenticated;

create trigger assign_book_slug before insert or update of slug on public.books
  for each row execute function private.assign_book_slug();

-- Sorted assignment keeps suffix allocation reproducible on the initial catalog.
do $backfill$
declare v_book_id text;
begin
  for v_book_id in select book_id from public.books where slug is null order by book_id loop
    update public.books set slug = null where book_id = v_book_id;
  end loop;
end;
$backfill$;
alter table public.books alter column slug set not null;
comment on column public.books.slug is
  'Permanent unique /books/ address. Title label targets 60 characters; published author names are preserved.';

notify pgrst, 'reload schema';
commit;
