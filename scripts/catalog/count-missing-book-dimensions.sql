-- Count distinct books with missing dimensions after the annotation inventory.
-- Run this ENTIRE file in Supabase web SQL Editor: source Database, role postgres.
-- Return the one-row book_dimension_completeness JSON result.
--
-- One read-only SELECT; one aggregate scan of public.books, no changes.
-- No book IDs, titles, authors, or user/library rows are returned.
-- Missing means SQL NULL. Zero is a present score; a middle score can be present
-- without producing a visible tag. The prior inventory separately checked ranges.
-- NULL does not by itself mean an error: political_value is intentionally absent
-- on books with no applicable political score. This query counts absent values;
-- it does not classify them as missing source data or prescribe a backfill.

with coverage as materialized (
  select
    17 - num_nonnulls(
      spice_value, vocabulary_value, granularity_value, emotion_value,
      violence_value, intended_age_value, period_value, political_value,
      entry_barrier_value, pace_value, narrative_value, atmosphere_value,
      originality_value, depth_value, discussion_potential_value,
      hierarchy_focus_value, factual_value
    ) as missing_dimensions,
    9 - num_nonnulls(
      pace_value, vocabulary_value, depth_value, originality_value,
      discussion_potential_value, violence_value, spice_value,
      atmosphere_value, entry_barrier_value
    ) as missing_tag_dimensions,
    count(*) as book_count
  from public.books
  group by 1, 2
)
select jsonb_build_object(
  'captured_at_utc', statement_timestamp() at time zone 'UTC',
  'total_books', coalesce(sum(book_count), 0),
  'all_17_dimensions', jsonb_build_object(
    'complete_books', coalesce(sum(book_count) filter (where missing_dimensions = 0), 0),
    'books_missing_at_least_one', coalesce(sum(book_count) filter (where missing_dimensions > 0), 0),
    'percent_missing_at_least_one', round(
      100.0 * coalesce(sum(book_count) filter (where missing_dimensions > 0), 0)
        / nullif(sum(book_count), 0), 1
    ),
    'books_missing_every_dimension', coalesce(sum(book_count) filter (where missing_dimensions = 17), 0),
    'distribution', (
      select coalesce(jsonb_agg(to_jsonb(d) order by missing_dimensions), '[]'::jsonb)
      from (
        select missing_dimensions, sum(book_count) as book_count
        from coverage group by missing_dimensions
      ) d
    )
  ),
  'nine_dimensions_used_for_visible_tags', jsonb_build_object(
    'complete_books', coalesce(sum(book_count) filter (where missing_tag_dimensions = 0), 0),
    'books_missing_at_least_one', coalesce(sum(book_count) filter (where missing_tag_dimensions > 0), 0),
    'percent_missing_at_least_one', round(
      100.0 * coalesce(sum(book_count) filter (where missing_tag_dimensions > 0), 0)
        / nullif(sum(book_count), 0), 1
    ),
    'books_missing_every_tag_dimension', coalesce(sum(book_count) filter (where missing_tag_dimensions = 9), 0),
    'distribution', (
      select coalesce(jsonb_agg(to_jsonb(d) order by missing_tag_dimensions), '[]'::jsonb)
      from (
        select missing_tag_dimensions, sum(book_count) as book_count
        from coverage group by missing_tag_dimensions
      ) d
    )
  ),
  'books_with_all_tag_dimensions_but_missing_other_dimensions', coalesce(
    sum(book_count) filter (where missing_tag_dimensions = 0 and missing_dimensions > 0), 0
  )
) as book_dimension_completeness
from coverage;
