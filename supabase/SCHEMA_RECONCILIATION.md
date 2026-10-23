# Schema reconciliation review

Reviewed against the PostgreSQL 17.6 schema inventory exported on 2026-10-23. The raw inventory is stored locally at `temp/live-schema-export.json`, which is ignored by Git. This document contains no exported webhook header values.

## Evidence and current status

The inventory is valid JSON and every reported section count matches its captured objects. It contains 30 tables, 240 columns, 45 indexes, 84 constraints, 27 routines, 13 triggers, and 27 policies. Its uncommon-object follow-up list is empty; that is not a claim of exhaustive `pg_dump` coverage.

There are 23 active tables across `public` and `private`, plus seven legacy snapshot tables in `migration_archive`. No captured foreign key or exported application routine references `migration_archive`. That observation does not establish whether external tools or manual processes still use it.

All five checked catalog/library `book_id` columns are text, and the expected recommendation filter/lifecycle/evidence and catalog quality columns exist live. The remaining differences are broader than adding those columns.

The repository contains 40 migration files. In an isolated PostgreSQL 17 container, with Supabase roles and minimal Auth prerequisites supplied, the first 19 files apply successfully. The twentieth file, `20260603000000_ulid_books_excluding_ids_rpc.sql`, fails with `column b.popularity does not exist`. This is a reproduced migration-chain failure on a disposable database, not a full Supabase stack test and not a production write.

The separately supplied remote migration history ends at `20260325000000`. Later live objects must not be assumed absent merely because their versions are missing from that history.

## Definitions missing from the repository

Two active tables have no `CREATE TABLE` definition in the checked-in migrations:

- `public.feed_log`
- `public.feed_user_cluster_stats`

Six public routines have no `CREATE FUNCTION` definition there:

- `claim_recommendation_request`
- `complete_recommendation_request`
- `fail_recommendation_request`
- `increment_feed_user_cluster_stats`
- `purge_requests_and_logs_24h`
- `rls_auto_enable`

The first five include backend processing and maintenance contracts. Lack of frontend callers does not make them dead code. The RLS event-trigger helper needs classification against Supabase's environment setup before generating a new baseline.

Other missing transitions include the ULID catalog/library cutover, additional catalog fields, recommendation evidence fields, request lifecycle fields, and later constraints/indexes. This review does not claim to enumerate every such transition.

Three enabled application webhook triggers are present live but have no checked-in trigger definitions. They handle recommendation requests, feed requests, and Goodreads imports using `supabase_functions.http_request`. They share an environment-specific backend host and include `x-webhook-secret` header values. Capture their configuration using placeholders or environment setup; preserve the original values only in the ignored local export. Test restores must use local stubs or isolated endpoint configuration.

The inventory also includes Supabase-managed Storage triggers/functions and platform event triggers. Their presence in the inventory does not make them application migrations to replay.

## Local changes that are not present live

The current live schema must not replace all later local migrations indiscriminately:

- `20261017020000_correction_year_and_validation.sql` adds publication-year corrections. Live correction field constraints and `save_book_correction` do not accept `year`; the live catalog snapshot function also omits it.
- `20261017030000_description_categories.sql` accepts the `too_generic` description category and changes validation messages. The live save function still accepts only `factual`, `spoiler`, and `other`.

These are real contract differences. They may represent intentionally unreleased work; production UI deployment was not checked in this review. Preserve them as forward changes after the captured baseline rather than marking them already applied.

The `get_latest_rate_feed_state` function body also differs textually, but its inspected difference is formatting. The three private author-comparison function bodies match their latest checked-in definitions after normalizing line endings and outer whitespace.

## Remaining input

`pg_cron` is installed, and `cron.job` exists. The schema export deliberately omitted cron configuration rows. Read them with [export-live-schedules.sql](../scripts/diagnostics/export-live-schedules.sql), export the result as JSON, and save it to `temp/live-schedules-export.json`.

This determines whether and how the captured cleanup function is scheduled, and captures any other database jobs. The read-only query does not execute their commands. If the result reports active row security on `cron.job`, assess whether the exporting role can see every relevant job.

Dashboard/Auth/API settings, Storage bucket configuration/data, external backend deployment, and catalog/author datasets remain separate environment or seed inputs. A schema baseline alone does not populate a working catalog or author dataset.

## Preparation sequence

1. Complete the job-configuration inventory and classify application objects, platform-managed prerequisites, and legacy snapshots.
2. Generate a baseline from the verified active schema. Retain historical SQL outside the active migration chain and retain unapplied local correction changes as forward migrations. Document archived snapshots separately.
3. Recreate it in a disposable Supabase environment, compare schema definitions and effective privileges, then apply the retained forward migrations and exercise their contracts with synthetic data. Isolate outbound integrations during these tests.
4. Prepare an explicit production migration-history reconciliation based on the verified baseline and remaining forward changes. History entries are not proof that arbitrary later SQL may be replayed safely.
5. Version future schema changes and record their application consistently.

No active migration files, live tables, scheduled jobs, or production migration-history entries were changed during this review.
