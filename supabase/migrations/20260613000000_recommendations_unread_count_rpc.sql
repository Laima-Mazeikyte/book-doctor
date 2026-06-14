-- Indexes for recommendation count query paths
create index if not exists recommendation_items_user_book_id_idx
	on public.recommendation_items (user_id, book_id);

create index if not exists recommendation_items_user_request_id_idx
	on public.recommendation_items (user_id, request_id);

create index if not exists recommendation_log_user_request_id_idx
	on public.recommendation_log (user_id, request_id);

-- Single-query unread recommendation count (excludes rated + not-interested books)
create or replace function public.get_recommendations_unread_count()
returns integer
language sql
stable
security invoker
set search_path = public
as $$
	select count(distinct ri.book_id)::integer
	from public.recommendation_items ri
	where auth.uid() is not null
		and ri.user_id = auth.uid()
		and not exists (
			select 1
			from public.user_not_interested uni
			where uni.user_id = auth.uid()
				and uni.book_id::text = ri.book_id
		)
		and not exists (
			select 1
			from public.user_ratings ur
			where ur.user_id = auth.uid()
				and ur.book_id::text = ri.book_id
		);
$$;

comment on function public.get_recommendations_unread_count() is
	'Returns count of distinct recommended books for the current user, excluding rated and not-interested titles.';

revoke all on function public.get_recommendations_unread_count() from public;
grant execute on function public.get_recommendations_unread_count() to authenticated;
