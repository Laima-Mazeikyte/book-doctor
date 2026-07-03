-- Migration: cap the size/shape of goodreads_import_jobs.items at the DB level.
--
-- RLS only restricts WHICH rows a user may insert (own user_id), not how big
-- `items` is. A crafted direct insert could hand the map-server a giant or
-- malformed array. This CHECK can't be bypassed: it enforces that items is a
-- JSON array of at most MAX_IMPORT_ITEMS (kept in sync with the frontend const
-- in src/lib/goodreads/parseGoodreadsCsv.ts).

alter table public.goodreads_import_jobs
  add constraint goodreads_import_jobs_items_bounded
  check (
    jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) <= 5000
  );
