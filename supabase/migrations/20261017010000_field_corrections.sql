-- Apply after 20261017000000_book_corrections.sql.
-- Existing proposals were test runs: discard them and their old quota entries.
begin;
lock table public.book_corrections in access exclusive mode;
drop index public.book_corrections_one_pending_idx;
delete from public.book_corrections;
delete from public.book_correction_daily_books;
alter table public.book_corrections
  add column field text not null check (field in ('title','author','description','coverUrl','genres')),
  add constraint book_corrections_single_field_check check (
    jsonb_typeof(proposed_changes) = 'object' and proposed_changes ? field
    and proposed_changes - field = '{}'::jsonb
  );

create unique index book_corrections_one_pending_field_idx
  on public.book_corrections(user_id, book_id, field) where status = 'pending';

-- No proposal FK: withdrawal, review, or deletion must not refund a submission.
create table public.book_correction_submissions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null,
  field text not null check (field in ('title','author','description','coverUrl','genres')),
  submitted_at timestamptz not null
);
create index book_correction_submissions_user_time_idx
  on public.book_correction_submissions(user_id, submitted_at);
alter table public.book_correction_submissions enable row level security;
revoke all on public.book_correction_submissions from public, anon, authenticated;
grant select on public.book_correction_submissions to authenticated;
grant all on public.book_correction_submissions to service_role;
create policy "Registered users read their own correction submissions"
  on public.book_correction_submissions for select to authenticated
  using (user_id = auth.uid() and coalesce((auth.jwt()->>'is_anonymous')::boolean, true) = false);

create or replace function public.get_book_correction_context(p_book_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := statement_timestamp();
  v_catalog jsonb;
  v_pending jsonb;
  v_count integer;
  v_next timestamptz;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then
    raise sqlstate 'PT403' using message = 'A registered account is required.';
  end if;
  v_catalog := public.book_correction_catalog_values(p_book_id);
  if v_catalog is null then raise sqlstate 'PT404' using message = 'Book unavailable.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'field', c.field, 'original_values', c.original_values,
    'proposed_changes', c.proposed_changes,
    'submitted_at', c.submitted_at, 'review_due_at', c.review_due_at) order by c.field), '[]'::jsonb)
    into v_pending from public.book_corrections c
    where c.user_id = v_uid and c.book_id = p_book_id and c.status = 'pending';
  select count(*) into v_count from public.book_correction_submissions
    where user_id = v_uid and submitted_at > v_now - interval '24 hours';
  if v_count >= 20 then
    select submitted_at + interval '24 hours' into v_next
      from public.book_correction_submissions
      where user_id = v_uid and submitted_at > v_now - interval '24 hours'
      order by submitted_at offset greatest(0, v_count - 20) limit 1;
  end if;
  return jsonb_build_object('catalog', v_catalog, 'pending', v_pending,
    'remaining', greatest(0, 20 - v_count), 'resetsAt', v_next);
end;
$$;

create or replace function public.save_book_correction(p_book_id text, p_id uuid, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := statement_timestamp();
  v_existing public.book_corrections%rowtype;
  v_original jsonb;
  v_clean jsonb := '{}'::jsonb;
  v_field text;
  v_value jsonb;
  v_text text;
  v_category text;
  v_operation text;
  v_label text;
  v_add jsonb := '[]'::jsonb;
  v_remove jsonb := '[]'::jsonb;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, true) then
    raise sqlstate 'PT403' using message = 'A registered account is required.';
  end if;
  if p_id is null or p_changes is null or jsonb_typeof(p_changes) <> 'object'
     or octet_length(p_changes::text) > 100000 then
    raise invalid_parameter_value using message = 'Invalid proposed changes.';
  end if;
  if (select count(*) from jsonb_object_keys(p_changes)) <> 1 then
    raise invalid_parameter_value using message = 'Propose a change to one field at a time.';
  end if;
  select key, value into v_field, v_value from jsonb_each(p_changes);
  if v_field not in ('title','author','description','coverUrl','genres') then
    raise invalid_parameter_value using message = 'Unsupported correction field.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('book-corrections:' || v_uid::text, 0));
  select * into v_existing from public.book_corrections where id = p_id for update;
  if found then
    if v_existing.user_id <> v_uid or v_existing.book_id <> p_book_id
       or v_existing.field <> v_field or v_existing.status <> 'pending' then
      raise sqlstate 'PT409' using message = 'Proposal is no longer available for editing.';
    end if;
    v_original := v_existing.original_values;
  else
    if exists(select 1 from public.book_corrections where user_id = v_uid
      and book_id = p_book_id and field = v_field and status = 'pending') then
      raise sqlstate 'PT409' using message = 'A pending proposal already exists for this field.';
    end if;
    v_original := public.book_correction_catalog_values(p_book_id);
    if v_original is null then raise sqlstate 'PT404' using message = 'Book unavailable.'; end if;
  end if;

  if v_field in ('title','author','coverUrl') then
    if jsonb_typeof(v_value) <> 'string' then raise invalid_parameter_value using message = 'Invalid text field.'; end if;
    v_text := btrim(v_value #>> '{}');
    if v_text = '' or char_length(v_text) > (case when v_field = 'coverUrl' then 512 else 200 end) then
      raise invalid_parameter_value using message = 'Text field is empty or too long.';
    end if;
    if v_field = 'coverUrl' and v_text !~* '^https?://[^[:space:]/?#@]+([/?#][^[:space:]]*)?$' then
      raise invalid_parameter_value using message = 'Enter an HTTP or HTTPS cover image URL.';
    end if;
    if v_text <> btrim(coalesce(v_original->>v_field, '')) then
      v_clean := jsonb_build_object(v_field, v_text);
    end if;
  elsif v_field = 'description' then
    if jsonb_typeof(v_value) <> 'object' then
      raise invalid_parameter_value using message = 'Choose an issue category and explain the problem.';
    end if;
    if (select count(*) from jsonb_object_keys(v_value)) <> 2
       or not (v_value ?& array['category','explanation'])
       or jsonb_typeof(v_value->'category') <> 'string'
       or jsonb_typeof(v_value->'explanation') <> 'string' then
      raise invalid_parameter_value using message = 'Choose an issue category and explain the problem.';
    end if;
    v_category := v_value->>'category';
    v_text := btrim(v_value->>'explanation');
    if v_category not in ('factual','spoiler','other') or char_length(v_text) not between 1 and 600 then
      raise invalid_parameter_value using message = 'Choose an issue category and explain the problem in 1–600 characters.';
    end if;
    v_clean := jsonb_build_object('description', jsonb_build_object('category', v_category, 'explanation', v_text));
  else
    if jsonb_typeof(v_value) <> 'object' or not (v_value ?& array['add','remove']) then
      raise invalid_parameter_value using message = 'Invalid genre changes.';
    end if;
    if exists(select 1 from jsonb_object_keys(v_value) k where k not in ('add','remove')) then
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
        if v_label is null
           or (v_operation = 'add' and char_length(v_label) not between 3 and 40)
           or (v_operation = 'remove' and char_length(v_label) not between 1 and 80) then
          raise invalid_parameter_value using message = case when v_operation = 'add'
            then 'New genres must contain 3–40 characters.' else 'Invalid genre removal.' end;
        end if;
        if exists(select 1 from jsonb_array_elements_text(v_add || v_remove) g where lower(g) = lower(v_label)) then
          raise invalid_parameter_value using message = 'Duplicate or conflicting genre changes.';
        end if;
        if (v_operation = 'add') = exists(select 1 from jsonb_array_elements_text(v_original->'genres') g
          where lower(btrim(regexp_replace(g, '[[:space:]]+', ' ', 'g'))) = lower(v_label)) then
          raise invalid_parameter_value using message = 'Genre change does not match the original book.';
        end if;
        if v_operation = 'add' then v_add := v_add || jsonb_build_array(v_label);
        else v_remove := v_remove || jsonb_build_array(v_label); end if;
      end loop;
    end loop;
    if jsonb_array_length(v_original->'genres') + jsonb_array_length(v_add) - jsonb_array_length(v_remove) > 10 then
      raise invalid_parameter_value using message = 'Choose up to 10 genres.';
    end if;
    if jsonb_array_length(v_add) + jsonb_array_length(v_remove) > 0 then
      v_clean := jsonb_build_object('genres', jsonb_build_object('add', v_add, 'remove', v_remove));
    end if;
  end if;
  if v_clean = '{}'::jsonb then raise invalid_parameter_value using message = 'Make at least one change before submitting.'; end if;

  if v_existing.id is null then
    if (select count(*) from public.book_correction_submissions
      where user_id = v_uid and submitted_at > v_now - interval '24 hours') >= 20 then
      raise sqlstate 'PT429' using message = 'Limit of 20 corrections in 24 hours reached.';
    end if;
    insert into public.book_correction_submissions(id, user_id, book_id, field, submitted_at)
      values(p_id, v_uid, p_book_id, v_field, v_now);
    insert into public.book_corrections(id, user_id, book_id, field, original_values,
      proposed_changes, submitted_at, updated_at, review_due_at)
      values(p_id, v_uid, p_book_id, v_field, v_original, v_clean, v_now, v_now, v_now + interval '24 hours');
  else
    update public.book_corrections set proposed_changes = v_clean, updated_at = v_now where id = p_id;
  end if;
  return public.get_book_correction_context(p_book_id);
end;
$$;

comment on table public.book_corrections is 'Independent private corrections per book field. Description proposals contain an issue category and explanation.';
comment on table public.book_correction_submissions is 'Immutable user submission ledger for a rolling limit of 20 field corrections per 24 hours. Revisions are free; withdrawal does not refund slots.';
comment on table public.book_correction_daily_books is 'Retired daily book allowance ledger. Cleared when test proposals were discarded; no longer used for correction limits.';
commit;
