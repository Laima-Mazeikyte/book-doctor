-- Apply after 20261017010000_field_corrections.sql. Preserve existing proposals.
begin;
alter table public.book_corrections drop constraint book_corrections_field_check;
alter table public.book_corrections add constraint book_corrections_field_check
  check (field in ('title','author','year','description','coverUrl','genres'));
alter table public.book_correction_submissions drop constraint book_correction_submissions_field_check;
alter table public.book_correction_submissions add constraint book_correction_submissions_field_check
  check (field in ('title','author','year','description','coverUrl','genres'));

create or replace function public.book_correction_catalog_values(p_book_id text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'title', coalesce(b.book_name, ''), 'author', coalesce(b.author, ''),
    'summary', coalesce(b.summary, ''), 'year', coalesce(b.year::text, ''), 'coverBookId', b.book_id, 'coverUrl', '',
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
  if v_field not in ('title','author','year','description','coverUrl','genres') then
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
    if jsonb_typeof(v_value) <> 'string' then
      raise invalid_parameter_value using message = 'Please enter a valid correction for this field.';
    end if;
    v_text := btrim(v_value #>> '{}');
    if v_text = '' then
      raise invalid_parameter_value using message = case v_field
        when 'title' then 'Please enter the corrected title.'
        when 'author' then 'Please enter the corrected author name.'
        else 'Please provide a link to a different cover image.' end;
    end if;
    if char_length(v_text) > (case when v_field = 'coverUrl' then 512 else 200 end) then
      raise invalid_parameter_value using message = case v_field
        when 'coverUrl' then 'Please use an image link of 512 characters or fewer.'
        when 'author' then 'Please keep the author name to 200 characters or fewer.'
        else 'Please keep the title to 200 characters or fewer.' end;
    end if;
    if v_field = 'coverUrl' and v_text !~* '^https?://[^[:space:]/?#@]+([/?#][^[:space:]]*)?$' then
      raise invalid_parameter_value using message = 'Please enter a valid HTTP or HTTPS image link.';
    end if;
    if v_text <> btrim(coalesce(v_original->>v_field, '')) then
      v_clean := jsonb_build_object(v_field, v_text);
    end if;
  elsif v_field = 'year' then
    if jsonb_typeof(v_value) <> 'string' then
      raise invalid_parameter_value using message = 'Please enter a valid publication year, such as 1998 or -300 for 300 BCE.';
    end if;
    v_text := btrim(v_value #>> '{}');
    if v_text !~ '^-?[0-9]{1,4}$' then
      raise invalid_parameter_value using message = 'Please enter a valid publication year, such as 1998 or -300 for 300 BCE.';
    end if;
    if v_text::integer = 0 then
      raise invalid_parameter_value using message = 'Please enter a valid publication year, such as 1998 or -300 for 300 BCE.';
    end if;
    v_text := (v_text::integer)::text;
    if v_text <> coalesce(v_original->>'year', '') then v_clean := jsonb_build_object('year', v_text); end if;
  elsif v_field = 'description' then
    if jsonb_typeof(v_value) <> 'object' then
      raise invalid_parameter_value using message = 'Please provide a short description of the problem.';
    end if;
    if exists(select 1 from jsonb_object_keys(v_value) k where k not in ('category','explanation')) then
      raise invalid_parameter_value using message = 'Please select a problem type and describe the issue.';
    end if;
    if jsonb_typeof(v_value->'explanation') is distinct from 'string'
      or btrim(coalesce(v_value->>'explanation', '')) = '' then
      raise invalid_parameter_value using message = 'Please provide a short description of the problem.';
    end if;
    v_text := btrim(v_value->>'explanation');
    if char_length(v_text) > 600 then
      raise invalid_parameter_value using message = 'Please keep your problem description to 600 characters or fewer.';
    end if;
    if jsonb_typeof(v_value->'category') is distinct from 'string'
      or v_value->>'category' not in ('factual','spoiler','other') then
      raise invalid_parameter_value using message = 'Please select the type of problem.';
    end if;
    v_category := v_value->>'category';
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
  if v_clean = '{}'::jsonb then
    raise invalid_parameter_value using message = case v_field
      when 'title' then 'Please enter the corrected title.'
      when 'author' then 'Please enter the corrected author name.'
      when 'year' then 'Please enter the correct publication year.'
      when 'coverUrl' then 'Please provide a link to a different cover image.'
      when 'genres' then 'Please add or remove a genre.'
      else 'Please provide a short description of the problem.' end;
  end if;

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

commit;
