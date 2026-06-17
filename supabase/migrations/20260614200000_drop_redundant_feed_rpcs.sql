-- get_latest_rate_feed_state supersedes these (metadata + eligible books in one query).
drop function if exists public.get_feed_request_snapshot();
drop function if exists public.get_latest_rate_feed(integer);
