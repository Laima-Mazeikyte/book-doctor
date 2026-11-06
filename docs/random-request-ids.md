# Random request IDs

Discover searches, overall recommendations, and feed requests use random
8-character public IDs, for example `/discover?search=K7mQ2xBa`. IDs use `A–Z`,
`a–z`, and `0–9` and are case-sensitive. Every ID contains at least one letter,
making public IDs unambiguous beside historical numeric links. The space is
approximately 218 trillion possibilities; IDs carry no request count or order.

`supabase/migrations/20261105000000_random_request_ids.sql` is installed on the
shared Supabase project. Read-only checks on November 5, 2026 confirmed that the
connection matches the application's project, both public-ID columns are NOT NULL
with case-sensitive `C` collation, both unique indexes and format constraints are
valid, and both assignment triggers are enabled. All three stored function bodies
match the checked-in migration, including `get_rate_feed_bootstrap_public`;
execution permissions and request-table RLS were also checked. At verification,
all 11 recommendation requests and 18 feed requests had valid, unique public IDs.

The migration-history table has no entry for version `20261105000000`. Reconcile
that history separately; **do not replay this already-installed migration** on the
shared project. Verification performed no database writes or request generation.
A different database must install the migration before using this frontend.

The migration adds and backfills `public_id` on recommendation and feed requests.
Internal identity keys, webhook `id` fields, backend lifecycle updates, and
result references stay numeric. Existing saved links such as
`/discover?search=560` remain valid; history links now use their public aliases.
The migration is additive and compatible with the previous frontend. Its write
behavior and concurrent allocation were tested in a disposable local database.

The database uses cryptographic randomness and retries both occupied IDs and
concurrent allocation conflicts. Unique indexes provide a final duplicate guard.
Existing RLS policies still enforce ownership. IDs are generated automatically
and cannot be reassigned. Callers omit both `id` and `public_id` when inserting;
the frontend selects only the public ID. Server APIs resolve aliases under RLS
and translate internal references back to public ones in history and dimension
evidence. The additive `get_rate_feed_bootstrap_public` RPC translates feed
pointers in the existing single round trip. Existing backend RPCs stay intact.

Request IDs are not access tokens. Numeric keys still exist in the underlying
database; this change removes counters from generated links and application API
responses, and does not redesign direct database access permissions. Legacy
recommendation logs without a lifecycle request row retain their original IDs.
Sort requests by `created_at`.

Run the isolated database regressions with Docker:

```powershell
pnpm run test:request-ids:db
```
