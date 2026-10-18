-- Proposals never write to books. All user mutations go through the RPCs below.
create table public.book_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null references public.books(book_id) on delete cascade,
  original_values jsonb not null,
  proposed_changes jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  review_due_at timestamptz not null default (now() + interval '24 hours'),
  reviewed_at timestamptz
);

create unique index book_corrections_one_pending_idx
  on public.book_corrections(user_id, book_id) where status = 'pending';
create index book_corrections_review_queue_idx
  on public.book_corrections(review_due_at) where status = 'pending';

-- This ledger survives withdrawal, review, and proposal deletion. Revisions do not
-- consume another slot, even when the original proposal was submitted yesterday.
create table public.book_correction_daily_books (
  user_id uuid not null references auth.users(id) on delete cascade,
  submission_day date not null,
  book_id text not null,
  primary key(user_id, submission_day, book_id)
);

alter table public.book_corrections enable row level security;
alter table public.book_correction_daily_books enable row level security;

revoke all on public.book_corrections, public.book_correction_daily_books from public, anon, authenticated;
grant select on public.book_corrections, public.book_correction_daily_books to authenticated;
grant all on public.book_corrections, public.book_correction_daily_books to service_role;

create policy "Registered users read their own correction proposals"
on public.book_corrections for select to authenticated
using (user_id = auth.uid() and coalesce((auth.jwt()->>'is_anonymous')::boolean, true) = false);
create policy "Registered users read their own correction allowance"
on public.book_correction_daily_books for select to authenticated
using (user_id = auth.uid() and coalesce((auth.jwt()->>'is_anonymous')::boolean, true) = false);

-- Canonical snapshot is constructed in the database, never supplied by the caller.
-- coverBookId identifies the derived cover; the endpoint resolves its display URL.
create function public.book_correction_catalog_values(p_book_id text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'title', coalesce(b.book_name, ''), 'author', coalesce(b.author, ''),
    'summary', coalesce(b.summary, ''), 'coverBookId', b.book_id, 'coverUrl', '',
    'genres', coalesce((
      select jsonb_agg(label order by first_slot) from (
        select btrim(g) as label, min(slot) as first_slot
        from unnest(array[b.genre1,b.genre2,b.genre3,b.genre4,b.genre5,b.genre6,b.genre7])
          with ordinality as genre(g,slot)
        where nullif(btrim(g), '') is not null group by btrim(g)
      ) labels
    ), '[]'::jsonb)
  ) from public.books b where b.book_id = p_book_id;
$$;
revoke all on function public.book_correction_catalog_values(text) from public, anon, authenticated;

create function public.get_book_correction_context(p_book_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_day date := (statement_timestamp() at time zone 'UTC')::date;
  v_catalog jsonb;
  v_pending jsonb;
  v_count integer;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then
    raise sqlstate 'PT403' using message = 'A registered account is required.';
  end if;
  v_catalog := public.book_correction_catalog_values(p_book_id);
  if v_catalog is null then raise sqlstate 'PT404' using message = 'Book unavailable.'; end if;
  select jsonb_build_object('id', c.id, 'original_values', c.original_values,
    'proposed_changes', c.proposed_changes, 'submitted_at', c.submitted_at, 'review_due_at', c.review_due_at)
    into v_pending from public.book_corrections c
    where c.user_id = v_uid and c.book_id = p_book_id and c.status = 'pending';
  select count(*) into v_count from public.book_correction_daily_books
    where user_id = v_uid and submission_day = v_day;
  return jsonb_build_object('catalog', v_catalog, 'pending', v_pending,
    'remaining', greatest(0, 10 - v_count),
    'resetsAt', ((v_day + 1)::timestamp at time zone 'UTC'),
    'bookCountedToday', exists(select 1 from public.book_correction_daily_books
      where user_id = v_uid and submission_day = v_day and book_id = p_book_id));
end;
$$;

create function public.save_book_correction(p_book_id text, p_id uuid, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_day date := (statement_timestamp() at time zone 'UTC')::date;
  v_existing public.book_corrections%rowtype;
  v_original jsonb;
  v_clean jsonb := '{}'::jsonb;
  v_key text;
  v_value jsonb;
  v_text text;
  v_limit integer;
  v_operation text;
  v_label text;
  v_add jsonb := '[]'::jsonb;
  v_remove jsonb := '[]'::jsonb;
  v_result_count integer;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then
    raise sqlstate 'PT403' using message = 'A registered account is required.';
  end if;
  if p_id is null or p_changes is null or jsonb_typeof(p_changes) <> 'object'
     or octet_length(p_changes::text) > 100000 then
    raise invalid_parameter_value using message = 'Invalid proposed changes.';
  end if;

  -- Serializes every mutation for this user, including requests for different books.
  perform pg_advisory_xact_lock(hashtextextended('book-corrections:' || v_uid::text, 0));
  select * into v_existing from public.book_corrections where id = p_id for update;
  if found then
    if v_existing.user_id <> v_uid or v_existing.book_id <> p_book_id or v_existing.status <> 'pending' then
      raise sqlstate 'PT409' using message = 'Proposal is no longer available for editing.';
    end if;
    v_original := v_existing.original_values;
  else
    if exists(select 1 from public.book_corrections where user_id = v_uid and book_id = p_book_id and status = 'pending') then
      raise sqlstate 'PT409' using message = 'A pending proposal already exists.';
    end if;
    v_original := public.book_correction_catalog_values(p_book_id);
    if v_original is null then raise sqlstate 'PT404' using message = 'Book unavailable.'; end if;
  end if;

  for v_key, v_value in select * from jsonb_each(p_changes) loop
    if v_key in ('title', 'author', 'summary', 'coverUrl') then
      if jsonb_typeof(v_value) <> 'string' then raise invalid_parameter_value using message = 'Invalid text field.'; end if;
      v_text := btrim(v_value #>> '{}');
      v_limit := case when v_key = 'summary' then 600 when v_key = 'coverUrl' then 512 else 200 end;
      if char_length(v_text) > v_limit or (v_key in ('title','author') and v_text = '') then
        raise invalid_parameter_value using message = 'Text field is empty or too long.';
      end if;
      if v_key = 'coverUrl' and (v_text !~* '^https?://[^[:space:]/?#@]+([/?#][^[:space:]]*)?$') then
        raise invalid_parameter_value using message = 'Enter an HTTP or HTTPS cover image URL.';
      end if;
      if v_text <> btrim(coalesce(v_original->>v_key, '')) then
        v_clean := v_clean || jsonb_build_object(v_key, v_text);
      end if;
    elsif v_key = 'genres' then
      if jsonb_typeof(v_value) <> 'object' or not (v_value ?& array['add','remove'])
         or exists(select 1 from jsonb_object_keys(v_value) k where k not in ('add','remove')) then
        raise invalid_parameter_value using message = 'Invalid genre changes.';
      end if;
      foreach v_operation in array array['add','remove'] loop
        if jsonb_typeof(v_value->v_operation) <> 'array' then
          raise invalid_parameter_value using message = 'Invalid genre list.';
        end if;
        if jsonb_array_length(v_value->v_operation) > 10 then
          raise invalid_parameter_value using message = 'Choose up to 10 genres.';
        end if;
        for v_label in select case when jsonb_typeof(g) = 'string' then
          btrim(regexp_replace(g #>> '{}', '[[:space:]]+', ' ', 'g')) else null end
          from jsonb_array_elements(v_value->v_operation) g loop
          -- The tighter bounds apply to new labels. Legacy labels like "YA"
          -- must still be removable from the existing catalog.
          if v_label is null
             or (v_operation = 'add' and char_length(v_label) not between 3 and 40)
             or (v_operation = 'remove' and char_length(v_label) not between 1 and 80) then
            raise invalid_parameter_value using message = case when v_operation = 'add'
              then 'New genres must contain 3–40 characters.' else 'Invalid genre removal.' end;
          end if;
          if exists(select 1 from jsonb_array_elements_text(v_add || v_remove) g where lower(g) = lower(v_label)) then
            raise invalid_parameter_value using message = 'Duplicate or conflicting genre changes.';
          end if;
          if (v_operation = 'add') = exists(select 1 from jsonb_array_elements_text(v_original->'genres') g where lower(btrim(regexp_replace(g, '[[:space:]]+', ' ', 'g'))) = lower(v_label)) then
            raise invalid_parameter_value using message = 'Genre change does not match the original book.';
          end if;
          if v_operation = 'add' then v_add := v_add || jsonb_build_array(v_label);
          else v_remove := v_remove || jsonb_build_array(v_label); end if;
        end loop;
      end loop;
      v_result_count := jsonb_array_length(v_original->'genres') + jsonb_array_length(v_add) - jsonb_array_length(v_remove);
      if v_result_count > 10 then raise invalid_parameter_value using message = 'Choose up to 10 genres.'; end if;
      if jsonb_array_length(v_add) + jsonb_array_length(v_remove) > 0 then
        v_clean := v_clean || jsonb_build_object('genres', jsonb_build_object('add', v_add, 'remove', v_remove));
      end if;
    else raise invalid_parameter_value using message = 'Unsupported correction field.';
    end if;
  end loop;
  if v_clean = '{}'::jsonb then raise invalid_parameter_value using message = 'Make at least one change before submitting.'; end if;

  if v_existing.id is null then
    if not exists(select 1 from public.book_correction_daily_books where user_id = v_uid and submission_day = v_day and book_id = p_book_id) then
      if (select count(*) from public.book_correction_daily_books where user_id = v_uid and submission_day = v_day) >= 10 then
        raise sqlstate 'PT429' using message = 'Daily limit reached.';
      end if;
      insert into public.book_correction_daily_books(user_id, submission_day, book_id) values(v_uid, v_day, p_book_id);
    end if;
    insert into public.book_corrections(id, user_id, book_id, original_values, proposed_changes)
      values(p_id, v_uid, p_book_id, v_original, v_clean);
  else
    update public.book_corrections set proposed_changes = v_clean, updated_at = now() where id = p_id;
  end if;
  return public.get_book_correction_context(p_book_id);
end;
$$;

create function public.withdraw_book_correction(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then
    raise sqlstate 'PT403' using message = 'A registered account is required.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('book-corrections:' || v_uid::text, 0));
  update public.book_corrections set status = 'withdrawn', updated_at = now()
    where id = p_id and user_id = v_uid and status = 'pending';
  if not found then raise sqlstate 'PT409' using message = 'Pending proposal unavailable.'; end if;
end;
$$;

revoke all on function public.get_book_correction_context(text) from public, anon, authenticated;
revoke all on function public.save_book_correction(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.withdraw_book_correction(uuid) from public, anon, authenticated;
grant execute on function public.get_book_correction_context(text) to authenticated;
grant execute on function public.save_book_correction(text, uuid, jsonb) to authenticated;
grant execute on function public.withdraw_book_correction(uuid) to authenticated;

comment on table public.book_corrections is 'Private book correction proposals; approval and catalog integration are handled separately. Genre changes are add/remove operations, including new labels. No relevance scores.';
