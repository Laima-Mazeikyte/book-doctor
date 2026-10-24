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

## Scheduled-job inventory and baseline preparation

The separate schedule export, collected on 2026-10-23, contains two active jobs and reports that cron row security is inactive for the exporting `postgres` role. The ignored local copy is `temp/live-schedules-export.json`.

- `purge_requests_and_logs_24h` calls `public.purge_requests_and_logs_24h()` with cron expression `15 3 * * *`.
- `delete-expired-feed-items` has cron expression `0 0 * * *`. Its command is a bare procedural block without `DO` or a function wrapper. The exported command fails at `IF` on isolated PostgreSQL 17. A single schema-qualified `DELETE` was tested as the proposed correction. Production run history has not been queried and the live job has not been changed.

A [baseline candidate](baseline/README.md) now reconstructs the active schema outside the current migration chain. Restored table/column/constraint/index/function/policy definitions and effective privileges match the captured application objects in PostgreSQL-level tests with Auth/role stubs. Pending local correction migrations also apply and pass their synthetic-data contract checks.

The supplemental export collected at 13:42:56 GMT on 2026-10-23 resolved the original JSON rounding issue. All six identity sequences have exact bigint bounds `1` through `9223372036854775807`, and the candidate now states them explicitly. Every captured executor-role flag matches the rebuilt role, and the configured cron timezone is `GMT`. No further live metadata is needed for this candidate.

An additional check passed against actual local Supabase PostgreSQL 17.11/Auth/PostgREST/Kong services with `pg_net` and `pg_cron`, using CLI 2.122.0. The baseline applied with the non-superuser `postgres` role, metadata and privileges matched, two authenticated accounts exercised library and recommendation APIs, and the retained correction changes worked through real JWT/RPC calls. All three webhooks reached a local mock backend with the expected payloads and headers. Scheduled jobs were installed and disabled before commit to prevent execution during testing. All disposable services were stopped afterward.

The integration check does not deploy or test the external production backend, production catalog/author datasets, Storage, or Realtime. [PROMOTION.md](baseline/PROMOTION.md) describes the remaining repository migration-chain changes, production history reconciliation, and explicit cron correction. Those rollout steps have not been executed.

Dashboard/Auth/API settings, Storage bucket configuration/data, external backend deployment, and catalog/author datasets remain separate environment or seed inputs. A schema baseline alone does not populate a working catalog or author dataset.

## Preparation sequence

1. Complete the job-configuration inventory and classify application objects, platform-managed prerequisites, and legacy snapshots.
2. Generate a baseline from the verified active schema. Retain historical SQL outside the active migration chain and retain unapplied local correction changes as forward migrations. Document archived snapshots separately.
3. Recreate it in a disposable Supabase environment, compare schema definitions and effective privileges, then apply the retained forward migrations and exercise their contracts with synthetic data. Isolate outbound integrations during these tests.
4. Prepare an explicit production migration-history reconciliation based on the verified baseline and remaining forward changes. History entries are not proof that arbitrary later SQL may be replayed safely.
5. Version future schema changes and record their application consistently.

No active migration files, live tables, scheduled jobs, or production migration-history entries were changed during this review.
