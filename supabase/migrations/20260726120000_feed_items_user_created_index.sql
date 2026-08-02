-- The map-server worker reads a user's feed history with
--   select book_id, created_at from feed_items where user_id = $1 order by created_at desc
-- and feed_items was indexed only on (id), (request_id) and (request_id, rank). With neither
-- user_id nor created_at indexed, every call read all ~111k rows and sorted them: 2190 calls at
-- 192ms mean, 421s total, ~243M of the 294M sequential tuple reads recorded on the table.
--
-- On a 0.5GB instance each of those scans pulls the whole table through shared buffers and
-- evicts everything else, which is why unrelated statements showed multi-second tails --
-- `select name from pg_timezone_names`, which touches no user data, averaged 512ms.
--
-- user_id serves the equality filter, created_at desc makes the rows come out pre-sorted, and
-- include (book_id) covers the only other projected column, so this is an index-only scan.
-- See scripts/diagnostics/README.md for the full measurement.
--
-- Applied to production on 2026-07-26 with CREATE INDEX CONCURRENTLY; recorded here without
-- CONCURRENTLY because migrations run inside a transaction. `if not exists` keeps this a no-op
-- against the environment where it already exists.
create index if not exists feed_items_user_created_idx
	on public.feed_items (user_id, created_at desc)
	include (book_id);

-- Autovacuum only auto-analyzes after ~10% of rows change, and reads never count, so both
-- tables were planning from stale statistics (books last analyzed 7 weeks earlier, feed_items
-- 3 weeks). The planner needs current row counts and distributions to choose the index above.
-- No-op on a fresh database; kept so this migration matches what was run in production.
analyze public.books;
analyze public.feed_items;
