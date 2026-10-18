# Book corrections

Apply migrations in order before deploying this feature:

1. `migrations/20261017000000_book_corrections.sql` (initial schema, if not already applied).
2. `migrations/20261017010000_field_corrections.sql` (field proposals and rolling allowance).
3. `migrations/20261017020000_correction_year_and_validation.sql` (publication year and field validation).
4. `migrations/20261017030000_description_categories.sql` (adds the Too generic description category).

The second migration intentionally deletes the existing test proposals and their
old daily allowance entries, as requested. It does not change catalog book data.
Run it once. No new environment variables or storage buckets are required.

The third and fourth migrations preserve existing proposals and quota entries.

Registered, signed-in users first select Title, Author, Publication year, Description,
Cover image, or Genres. Only that field is displayed and each submission has its own
row in `book_corrections`, identified by `field`. One pending proposal is allowed
per user, book, and field; other fields on the same book can have separate proposals.

Title and author replacements are limited to 200 characters, cover URLs to 512.
Publication years are nonzero integers between -9999 and 9999, stored as normalized
strings. Negative years represent BCE dates. The catalog year remains unchanged.
If a correction context omits the year or returns it blank, the API reads the current
catalog year using the signed-in user's client before displaying the form. Existing
recorded proposal years are preserved; missing legacy snapshot years use the catalog value.
Description proposals contain a category (`factual`, `spoiler`, `too_generic`, or `other`) and a
nonempty explanation of at most 600 characters. They never contain a replacement
description. The original description is displayed read-only and kept in the
canonical snapshot for review. Genre changes store explicit additions/removals,
including new niche labels of 3–40 characters, with ten genres in the resulting
list. Old short labels such as YA remain removable.

`book_correction_submissions` is the quota ledger. Every new field proposal
consumes one of twenty corrections in the preceding 24 hours, including another
field on the same book or a new submission after withdrawal. Revisions are free,
even if the original submission is older than 24 hours. Withdrawal, review, or
proposal deletion does not remove its ledger entry. Slots become available as
each submission ages out; there is no midnight reset. The editor only shows the
limit and next available time when the allowance is exhausted.

Both API and database require a registered user. Row-level security exposes only
the user's own rows; direct client table writes are revoked. A per-user transaction
lock serializes checks and writes, including direct Supabase RPC requests. A
stable proposal UUID prevents duplicate inserts on retries. Original snapshots,
submission times, and 24-hour review deadlines survive revisions. Reverting the
selected pending field completely and updating uses the withdrawal operation.

Cover URLs are previewed only on request in the browser, without a referrer. The
server does not fetch those URLs and no files are uploaded. Text is passed to
fixed SQL functions as data and rendered as text/input values, never raw HTML.
Future review tools must preserve those protections.

Validation messages describe the action needed for the selected field. Empty
description feedback asks for a short description of the problem. Validation and
failed-save errors preserve the draft and do not offer reload. Reload is offered
only for a server conflict and replaces the draft with the latest saved proposal;
a failed initial load instead offers a loading retry.

Back returns to field selection and keeps each field's unsent draft for the current
visit. Close on field selection exits the editor and clears those drafts without
changing submitted proposals. Submission and withdrawal still close the editor.
The shared action footer remains attached to the menu, outside the field transitions,
and scrolls with it. Panel resizing compensates the scroll
position to keep its bottom anchored; cover previews reserve their image height
before loading. Closing the editor restores the scroll area's original settings.

Review tooling, notifications, and catalog integration remain separate. There is
no automatic review worker; fulfilling the 24-hour message requires an operational
review process. Closed proposals disappear from the editor without an outcome
message. The old `book_correction_daily_books` table remains empty and unused.

## Validation

Run focused unit/browser checks:

```sh
pnpm exec vitest run src/lib/corrections/model.test.ts src/lib/server/bookCorrectionsEndpoint.test.ts src/lib/components/book-card/BookCorrection.svelte.test.ts
```

Run actual PostgreSQL checks with Docker and the postgres:17 image:

```sh
pnpm test:corrections:db
```

Database checks apply all four migrations in an isolated disposable container. They
verify removal of old test proposals, independent fields, description categories,
access rules, validation, rolling expiry, revisions, withdrawal, and racing writes.
They never read .env or connect to the application's database.
