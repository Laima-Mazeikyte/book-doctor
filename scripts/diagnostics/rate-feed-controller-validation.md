Step 2 moves initial feed ownership into a layout-scoped controller. It is an application-only development change and requires no SQL. The deployed production application continues its current implementation against the shared database.

[rateFeedController.ts](../../src/lib/feed/rateFeedController.ts) owns the account, active book list and source, prepared snapshot, initial-load decisions, read deduplication, loading/refresh/error state, and entry identity. The root layout creates one instance and supplies it through [context](../../src/lib/feed/rateFeedContext.ts). Constructing that instance does not read a session or make a request; SSR layouts have separate instances. A page-local fallback supports isolated component mounting.

The controller's `prepare` operation only reads `/api/feed/latest`. It never starts anonymous sign-in, flushes pending saves, or inserts generation requests. Concurrent calls for the current account share one promise. Successful prepared snapshots can be reused for five minutes in memory; this timer does not remove or replace an active grid. There is no new browser persistence or landing-page prefetch in this step.

Only a current entry can admit or append books. Preparation stages its response without changing active book objects, order, or source. Empty and failed refreshes retain the active list and record refresh state separately from initial loading. A 401/403 response invalidates the reusable snapshot so a later entry revalidates. The existing auth store remains responsible for session changes. Leaving the page releases the displayed list but lets an account-owned read finish into the prepared snapshot. Signing out or changing accounts aborts that read and rejects its late results, even if the original account later signs in again. Refreshing a token for the same account preserves the entry.

The page retains explicit generation/polling operations, save flushing, search-session generation, Top 100 pagination, and the existing feed pagination reducer. The controller chooses the initial source and invokes the page's guarded generation callback only for an active entry when needed. Pending generation reuses its existing request ID. Page operations check their entry after asynchronous work so departed/account-switched operations cannot insert subsequent jobs or update another entry's cards, flags, or errors. Local exclusions are applied at admission using the current library stores; appends deduplicate catalog IDs within the new batch as well as against the active list. Automatic pagination pauses when eligibility is unavailable or lost, preserving the visible grid instead of replacing it with Top 100. Explicit user mutations retain their existing Top 100 reset behavior.

The integration closeout corrected an HTTP error-classification gap: Supabase RPC access errors previously became generic HTTP 500 responses, preventing the controller's 401/403 invalidation branch from running. The server helper now preserves 401/403 through a typed access error; the endpoint returns a safe generic message and retains request timing. Other upstream failures and malformed successful payloads remain HTTP 500. The endpoint does not expose upstream error details or fall back to the legacy six-call path.

Known local mutations invalidate reusable prepared data, including a read completing after that invalidation. They continue through the existing save queue. Lazy anonymous sign-in may carry an already displayed public Top 100 into its new owner, preserving the existing card nodes and open search query; personalized account lists are cleared on ownership changes. Initial auth attachment preserves search deep links.

Validation on 2026-10-24:

- 38 Node tests passed across the controller, feed pagination reducer, and eligibility helpers. They cover request sharing/freshness, ownership races, invalidation, stable active references, errors, default choices, generation decisions, and instance isolation.
- 18 Chromium component tests passed. The existing dwell/progress/search-pause scenarios remain, alongside in-flight navigation reuse, a three-second refresh returning reordered/changed/excluded books, empty/failed refreshes, card node/order/scroll preservation, account and token changes, search deep links, guest handoff, initial pending/failed generation, an interaction made while the initial read is pending, late library IDs, and server eligibility changes during pagination.
- All 11 existing library load/save Playwright scenarios passed, including retry/failure handling, guest save ownership, account isolation, bookmark undo, drawers, and recommendation submission after persistence.
- `pnpm run check` reported zero errors and zero warnings. ESLint passed for the changed controller, context, page/layout, and test files.

Closeout validation passed all 43 targeted endpoint/controller tests. This includes 401/403 propagation through the real Supabase JS client, endpoint, browser read adapter, and controller (with SvelteKit's HTTP-error serialization represented by a test boundary). The cases confirm reusable data is invalidated, mounted books remain stable, and a later entry with a restored token makes a new read without generating a feed job. Actual local HTTP requests with missing and deliberately invalid tokens also returned 401; the invalid-token request reached the real Supabase gateway. Real gateway permission denial was not forced; 403 is covered by the transport fixtures.

A controlled Chromium smoke check exercised the real application router and root layout: landing page → `/rate` → browser Back to landing → `/rate`. It displayed the same 50 books in the same order on both entries, made one latest-feed API request total, made no popular-feed requests, generation polls, or writes, and recorded no page errors. API/library/auth data were intercepted fixture responses, so this verifies integration and request reuse rather than real-user latency. The closeout also passed type checking, changed-file lint, and formatting.

The remaining items are explicitly outside this integration closeout: a new fallback/refresh notice and retry UI (the existing Top 100 fallback and controller error state are retained), investigation of Supabase upstream latency, migration-history reconciliation before production deployment, and the already planned interaction snapshots/persistence/landing-page preparation. None is an unresolved controller correctness defect established by the current checks.

These are controlled browser/API fixtures, not new real-Supabase latency measurements. The real HTTP samples from Step 1 remain the latest end-to-end network evidence. A recent same-tab entry can now reuse a read; a full reload or expired/missing prepared snapshot still follows the network-dependent cold path. Steps 3–5 add complete interaction snapshots, persistent feed restoration, and landing-page preparation.

The focused commands are:

```powershell
pnpm exec vitest run --project server src/lib/feed/rateFeedController.test.ts src/lib/feed/feedPaginationController.test.ts src/lib/rate/feedEligibility.test.ts
pnpm exec vitest run --project client src/lib/feed/rateFeedScheduling.svelte.test.ts
pnpm exec playwright test e2e/library-saves.e2e.ts e2e/library-loads.e2e.ts --workers=2
pnpm run check
```
