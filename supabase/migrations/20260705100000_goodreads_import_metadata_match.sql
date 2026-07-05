-- Migration: document the expanded goodreads_import_jobs contract for metadata matching.
--
-- The frontend now sends title/author/year (plus a row index) alongside the
-- optional goodreads_id, so the map-server can fall back to a metadata match for
-- catalog books that have no goodreads_id (e.g. sourced from other databases).
-- The map-server writes `unmatched` as the ROW INDICES it could not resolve,
-- not goodreads_ids. Item shape and unmatched contents are validated/produced by
-- the service-role map-server; only the array-length CHECK is enforced in the DB.

comment on column public.goodreads_import_jobs.items is
  'One entry per rated row: { index, goodreads_id (nullable), rating, title, author, year (nullable) }.';

comment on column public.goodreads_import_jobs.unmatched is
  'Row indices (into items) the map-server could not resolve.';
