-- Keyset pagination for the dismissal-ordered Not Interested catalog endpoint.
-- One descending index supports both newest-first and reverse (oldest-first) scans.
create index if not exists user_not_interested_user_created_book_idx
  on public.user_not_interested (user_id, created_at desc, book_id desc);
