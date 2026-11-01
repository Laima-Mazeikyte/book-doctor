# Book connections: Supabase dashboard installation

Reviewed 2026-10-31. This is the current installation route for
`temp/similarity-matching/book-connections-int8-v2-dashboard` and supersedes the
earlier psql instructions. No remote installation was performed during review.
The v3 dataset is intentionally limited and is accepted for testing; v4 will replace
it before the frontend goes public. The frontend RPC contract is unchanged.

## Confirmed v3 testing installation

The user supplied successful preflight/setup results, followed by staged counts of
77,901 books and 23 unknown primary authors. Activation produced
`data_506d4e746ab8bc3b20d0c5f1cf0191b5`. The subsequent live verification reported
`book-connections-int8-v2`, 77,901 books, 16 MB, and activation at
`2026-10-31 17:31:30.700155+00`. Authenticated RPC execution, security definer, and
volatile status were true; all reported anonymous/private-table access flags were
false and search_path was empty. The user then confirmed the feature appears to
work locally. These are user-supplied live results; the automated local review did
not access their project. Do not repeat v3 setup/import/activation for this release.

## Remaining v4 release steps

The feature implementation is complete for the approved behavior. A v4 catalog
upload does **not** update connection vectors automatically. Before production:

1. Publish the v4 catalog while preserving existing public book ULIDs and slugs.
2. Obtain the matching v4 connections export from backend with a new release ID
   and the same RPC response contract. Review its manifest/expected coverage against
   that catalog; do not reuse the v3 test vector file as the production dataset.
3. Stage/import/activate that new package with the workflow below, using its own
   expected counts and fingerprints. Run the verification SQL afterward.
4. Deploy the frontend, then check authenticated nonempty and empty results, a
   new book visit, unchanged connections after rating edits, and clearing on sign-out
   against the actual production configuration. The current frontend has no hardcoded
   release/cutoff or result cache to migrate.

Keep the previous release artifact for recovery; successful activation drops the
old physical table. Actual hosted response times under concurrent production use
have not been benchmarked. Observe RPC latency/errors after release; additional
caching or matching infrastructure is not required for the current implementation.

## Versioned schema and backend data ownership

The dataset-independent schema, ULID conversion, scoring helper and authenticated
RPC are retained in [the connections migration](../../supabase/migrations/20261101000000_book_connections.sql).
It is extracted from the reviewed backend v2 setup and contains no vectors, pending
release or model-specific manifest. The shared database already has these definitions;
this file records reproducible source and is not an instruction to reapply it there.
Backend CSV/setup/activation deliveries remain in ignored local storage.

## Files and expected release

| File                  | Size             | Purpose                                                       |
| --------------------- | ---------------- | ------------------------------------------------------------- |
| `01_setup.sql`        | 24,722 bytes     | Private schema, RPC, empty incoming table and pending release |
| `book_embeddings.csv` | 24,661,126 bytes | 77,901 packed book vectors                                    |
| `03_activate.sql`     | 4,889 bytes      | Validate staging, index, activate, retire previous data       |

Expected release ID is `book-connections-int8-v2`, count `77901`, cutoff
`0.4808829544155937`. The frontend never hardcodes these release values.

## 1. Run the read-only preflight

Open the intended Supabase project used by your local frontend. In **SQL Editor**,
choose **Database / postgres** and run all of
[check-book-connections-installation.sql](../../scripts/connections/check-book-connections-installation.sql).

Proceed when it reports `preflight = ready`. A missing `existing_rpc` is expected
on first installation. This checks ratings column types, a usable index beginning
with user_id, Supabase authentication support, and incompatible v1 embedding storage.
It does not scan the catalog or change data. If it fails, inspect the selected
project/schema before running setup.

## 2. Set up staging and the RPC

Run the complete **`01_setup.sql`** in SQL Editor as postgres. It has ordinary SQL
and no psql-only commands. Its final result says to upload the CSV next.

It creates persistent, private `book_connections.incoming` and
`book_connections.pending_release`. These survive closing the browser. The RPC is
installed now, but on a first installation it cannot serve connections until
activation. If an older release is active, that release continues serving readers.

Run setup once for this attempt. If staging already exists, inspect the previous
attempt rather than rerunning setup or uploading a second copy of the CSV.

## 3. Import the CSV through Table Editor

1. Open **Table Editor** and select schema **`book_connections`**. Refresh the table
   list if the new schema is not visible yet.
2. Select the existing **`incoming`** table.
3. Choose **Insert → Import Data from CSV** and select **`book_embeddings.csv`**.
4. Preserve the exact mappings `book_id`, `embedding`, `inverse_norm`, `author_key`.
   The IDs in this file are internal UUID storage keys; do not convert them to ULIDs.
5. Treat empty `author_key` cells as **NULL**. There are 23 such rows. Preserve
   `embedding` hex strings beginning with `\x` and the supplied numeric precision.
6. Complete the upload and wait for its success notification. Keep the file
   unchanged; do not resave it in a spreadsheet application.

Upload into `incoming`, not the empty `embeddings` template, `pending_release`, an
active `data_<hex>` table, or a newly created public table. There is no Storage
bucket or exposed-schema setting to configure.

The file is below the dashboard's documented 100 MB limit. See
[Supabase CSV import instructions](https://supabase.com/docs/guides/database/import-data#option-1-csv-import-via-supabase-dashboard).
The dashboard UI itself was not exercised in the local database review.

To check that staging finished, run this in SQL Editor:

```sql
select count(*) as staged_books,
       count(*) filter (where author_key is null) as unknown_primary_authors
from book_connections.incoming;
```

Expect **77,901** staged books and **23** unknown primary authors. Activation still
performs the stronger full checksum and vector checks; counts alone do not certify
the upload.

## 4. Validate and activate

After the upload has completed, run the entire **`03_activate.sql`** in SQL Editor
as postgres. It checks count, manifest consistency, vector normalization and record
checksum before creating the dense primary-key index and switching the active release.

Successful final results show:

- `release_id = book-connections-int8-v2`;
- `book_count = 77901`;
- `minimum_similarity = 0.4808829544155937`;
- the active physical table and its total table/index size, approximately 16–17 MiB
  in the local tests.

After successful activation, `incoming` has become the active physical table and
`pending_release` is removed. Do not rerun activation after success. Upload/indexing
temporarily needs space for staging and any previous active data, plus WAL.

## 5. Verify and test the frontend

Run [verify-book-connections.sql](../../scripts/connections/verify-book-connections.sql) in SQL Editor.
Expect one release row, `authenticated_rpc`, `security_definer`, and `volatile_rpc`
true, an empty search_path setting, and all other access flags false.

Sign in locally and open
`http://localhost:5173/books/the-hunger-games-suzanne-collins`. In DevTools → Network,
filter for `get_book_connections`. Expect one authenticated POST after the main
cover settles, with only the target public ULID and limit:

```json
{ "p_book_id": "01KR2ADTFG9DJ85AS30MZFHJG6", "p_limit": 3 }
```

The existing browser Supabase client supplies the reader session:

```ts
const { data, error } = await supabase
	.rpc('get_book_connections', { p_book_id: bookId, p_limit: 3 })
	.abortSignal(signal);
```

The frontend preserves server order, displays each returned rating separately, and
reuses cached book metadata or fetches only the missing titles/authors/slugs in one
small catalog query. It uses 200px low-priority lazy covers. An empty result or
`target_unavailable` hides the section; zero matches is valid for this test dataset.
There is no ten-rating minimum or four/five-star-only filter for connections.

Rate/change/remove a rating on the current page: the connection list remains a
visit snapshot and does not refetch. A new book visit, Back navigation, reload or
account change makes a fresh request. Token refresh for the same reader does not.
Sign-out clears the section and stale page/account responses are ignored.

If a successful installation is followed by API error `PGRST202`, reload the Data
API schema cache in SQL Editor, then reload the page:

```sql
notify pgrst, 'reload schema';
```

An admin SQL Editor session has no reader JWT; calling the personalized RPC there
normally raises `Authentication required`. Use the signed-in browser to test it.
Do not expose the `book_connections` schema or add reader grants to private tables.

## If an attempt fails

- On incomplete/altered/duplicate uploads, activation fails and staging remains
  available for inspection. Any previously active release stays unchanged.
- If the import failed and you want a clean restart, first make sure the upload
  has stopped. Drop only `book_connections.incoming` and
  `book_connections.pending_release` as the setup comments describe, rerun setup,
  and import once into the new empty staging table. Never drop an active
  `data_<hex>` table or the `release` table.
- A five-second activation lock timeout preserves staging. Wait until readers
  have drained, then retry **only `03_activate.sql`**; no second CSV upload.
- If a browser/API timeout makes completion uncertain, inspect
  `book_connections.release` and staging existence before retrying. A matching
  active release and absent staging indicate the activation committed.
- On failed first-install activation, the RPC can exist with no active dataset.
  This does not mean the import succeeded.

## Review evidence and limits

Local PostgreSQL 17 tests passed for the complete 77,901-row flow, using parsed CSV
converted to JSON inserts to exercise hex bytea, numeric and NULL conversions.
The CSV SHA256 and logical-record checksum both match the supplied manifest:

```text
SHA256: bdc8914c09f5c959e4b7b63313d1ad87637d6868fa2700e0ec0075f662d1be51
MD5:    d6887e75456f43f917377d878c5bbdb4
```

Also tested: session-derived reader isolation, private staging permissions, exact
cosine/author selection against an independent implementation, safe rejection of
partial/corrupt/duplicate uploads, active-reader lock timeout, successful retry,
and removal of old data/staging after activation. Two successful local activation
runs took about 0.6 seconds each, excluding upload. This is not a hosted latency
guarantee. No live project, Supabase dashboard upload, or actual browser session
was used by these database tests.

Ignored local evidence: `temp/similarity-matching/review-dashboard.mjs` and
`temp/similarity-matching/dashboard-review-results.json`. No backend package files
or frontend application code were changed during this review.
