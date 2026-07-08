-- Popular-feed spillover (browse past the Top 100) was removed from the app: the rate feed now
-- caps zero-interaction users at the Top 100 and routes anyone with an interaction to the
-- personalized feed, so nothing calls this fallback RPC anymore. Its sibling
-- get_eligible_top_100_books() is still used and is intentionally left in place.
drop function if exists public.get_eligible_books_excluding_ids(text[], integer);
