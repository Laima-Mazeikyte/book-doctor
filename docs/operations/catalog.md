# Catalog publication: annotations, series and public URLs

## Existing shared database

Do not reset or replay completed backfills for local testing. User-supplied verification:

- The 118,097-book slug backfill completed October 28, 2026 at 14:05:55 UTC.
- Annotation test-002 updated all 116,528 exported books; 63,463 memberships span
  22,869 series, with zero invalid/orphan series or invalid core identities.
- Series detail and slug-enabled annotated reads were installed and verified.
- October 30 post-compaction verification confirmed all 118,097 unique nonempty
  slugs, no initial collision suffixes and intact annotations/series/reader permissions.
- Connections v2 was separately installed October 31; see [connections](connections.md).

The old deployed application and development app share a database. Preserve old read
functions/production contracts until the release explicitly replaces them. Live installs
were reported by the user, not performed by the local tests. An empty history table is
not authorization to replay a manually applied migration; reconcile migration history
separately before promotion. Any material under supabase/baseline/ is an excluded,
local-only review candidate, not part of a fresh checkout or a test prerequisite.
See [schema inventory and baseline promotion](database-maintenance.md#schema-inventory-and-baseline-promotion).

## Fresh-project migration order

The following are forward migrations, not a complete empty-project installation.
A new project first needs a separately reviewed application schema/feed setup;
production baseline promotion remains deferred. The synthetic test fixture must
not be used as that production setup. Once those prerequisites exist, review/apply
these versioned migrations in order (not again on the installed shared project):

1. 20261025000000_book_annotations.sql: additive book/author rankings, awards, audit/import.
2. 20261025010000_annotated_book_reads.sql: annotated feed/catalog RPCs.
3. 20261027000000_public_book_slugs.sql: permanent slug allocator and initial backfill.
4. 20261027010000_slug_book_reads.sql: slugs on the annotated feed RPCs.
5. 20261028000000_book_series.sql: shared series names/memberships and v2 import.
6. 20261028010000_series_number_range.sql: finite positions >=0.01 without an upper cap.
7. 20261028020000_series_book_detail.sql: get_book_detail_with_series(p_slug text).
8. 20261101000000_book_connections.sql: dataset-independent connection schema/RPC.

Files are under supabase/migrations/. Series storage/import is independent of slugs;
the detail function requires slugs and should be installed afterward. A foreground
slug backfill can exceed the Dashboard request budget. Its tested background generator
and observer are under scripts/catalog/; they are alternatives to foreground replay,
not additional steps on this installed database.

## Prepare and publish v4 annotations/series

The [backend contract](../backend/book-annotations.md) defines manifest.json and
books.jsonl, schema v2, a new export_version and existing public ULID identities.
Do not regenerate public IDs or assigned slugs when uploading a new catalog.

Run from book-doctor:

    pnpm run prepare:annotations -- C:/path/to/manifest.json C:/path/to/empty-output-directory

This validates locally and generates CSV plus short SQL Editor commands. It does not
connect to the database. Retain the manifest and prepared delivery outside Git.

1. Run generated 00-begin.sql in SQL Editor, Database / postgres. An older v1-only
   manifest constraint means the series import migration needs installation first;
   do not downgrade the export or remove its constraints.
2. Import 01-staging.csv into the existing private.book_annotation_import_rows table,
   preserving export_version, book_id and record. Do not recreate the table or import
   directly into public.books. Wait for upload completion.
3. Run 90-preview.sql. Staged/expected counts must match, validation counts must be
   zero and ready_to_apply true. Unknown export IDs are counted, not inserted.
4. Run 98-apply-background.sql once; existing pg_cron executes the atomic importer
   outside the Dashboard request budget. It has its own five-minute statement and
   two-second lock limits. Do not also run the foreground 99-apply.sql.
5. Use 91-status.sql until applied, with matching summary/counts and no remaining
   importer/job. A request timeout or disappearance of a job alone is not success.
6. Run generated verify-series.sql plus scripts/catalog/verify-book-annotations.sql
   and verify-book-urls.sql. Bad annotation/core identity/membership counts should be
   zero, expected readers should have read access and private importers remain denied.

Use reset-staging.sql only for that delivery's incomplete upload, after the upload
stops and while not applied. It checks identity/hash; never clear staging across all
exports to retry one file. For a timeout inspect status first, then the locator and
diagnostic SQL. Do not upload again if the complete stage is already present. The
repair script is recovery for missing staging constraints, not routine publication.

## URL and presentation policy

The database allocates slugs once using short normalized title/author labels and a
unique deterministic collision policy. It preserves assigned slugs after metadata
corrections; don't regenerate them from names in frontend links. Existing explicit
valid slugs can be supplied on insert. Ratings, covers and relationships use ULIDs.
Full title display remains independent from the shortened URL label.

Series data is one shared name plus lightweight per-book membership. Numeric order
and ID tie-breaking preserve decimals/collisions; no browser chronology inference.
The detail read returns current metadata and ordered lightweight members in one call,
not repeated whole-series objects in every feed response. See [book-page behavior](../book-page.md).

## Troubleshooting and maintenance

scripts/catalog/ contains preflight, preview, status, inspection, recovery and verification
SQL. Tests and package generators load these directly; they are reusable tooling, not
disposable query output. check-book-series-installation.sql reports committed schema
without a book scan. After a NetworkError, inspect that state and active sessions before
retrying; a browser disconnect does not establish server rollback or completion.

Read-only inspection scripts may have heavier catalog aggregates; use the narrower
status query for routine monitoring. build-book-annotation-reference.mjs refreshes the
independent public-lab reference embedded in inspect-book-annotations.sql when needed.
Data NULLs (especially political traits) and omitted obsolete catalog books are not
automatically defects requiring backfills.

After publication, any empty-staging reclamation is optional and separate; see
[database maintenance](database-maintenance.md). Publish the matching v4 connections
dataset and regenerate [sitemaps](sitemaps.md) before deploying/promoting the frontend.
Verify production canonicals, real 404/503 behavior and browser controls after deployment.
