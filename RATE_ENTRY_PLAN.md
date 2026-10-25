This plan addresses the measured multi-second `/rate` entry delay for existing users. It is based on the 2026-10-24 investigation in [the diagnostic notes](scripts/diagnostics/README.md). The measured slow feed request took 3566 ms: five overlapping metadata requests took up to 3074.8 ms, followed by a 483.1 ms books request. Shared Supabase latency remains an infrastructure concern; the application should remain usable during that latency.

The accepted product policy permits briefly stale suggestions across devices and a bounded local personalized snapshot. Stable rendering is a requirement: after a list is shown, background refreshes must preserve its card identities, order, and scroll position. The user's explicit actions retain their current behavior. Changes discovered from other devices take effect when preparing the next list or an appended batch, rather than removing and reinserting visible cards during browsing.

Implement the following as separate, reviewable changes in order. Each step leaves the application working and names the behavior that demonstrates completion.

Current status: Steps 1–5 are complete in development. Step 6's functional checks pass; strict timing acceptance remains open. Start with the [developer testing handoff](scripts/diagnostics/rate-entry-developer-handoff.md) for setup and reproduction commands. The shared read has a configurable 10-second deadline and the landing page prepares the same resource. All 15 original production-build timing samples met the under-200-ms target with zero fade. On 2026-10-25 the intentional 150-ms fade was restored at the user's request; those samples do not measure the restored UI. Restored-UI behavioral checks passed, but the strict timing target remains open after a 153–420-ms follow-up run. See the [UI/UX audit](scripts/diagnostics/rate-entry-ui-ux-audit.md), [completion validation record](scripts/diagnostics/rate-entry-completion-validation.md) and [status review](scripts/diagnostics/rate-entry-status-review.md). The user explicitly deferred Supabase spike diagnosis, migration-history reconciliation, production deployment, and deployed measurements.

Production and development will share the existing Supabase database. Production application deployments are deferred for approximately two months; development can use the new RPC as soon as it is installed and verified. Keep both database implementations available throughout that overlap: production retains its six-call flow, while development uses the unified read. Database changes during this period must remain compatible with the deployed application. Development writes affect the shared data, so use a separate test account for interactive checks.

1. Consolidate the server feed read into one RPC.

   Add an additive `get_rate_feed_bootstrap(p_limit)` database function and switch `loadLatestEligibleRateFeed` to call it once. Return the eligible catalog rows, feed pointers/status, errors, and counts needed to preserve the existing `/api/feed/latest` JSON contract. Select the request pointers once and derive the user from the caller's authenticated identity. Keep the function read-only, use caller permissions and existing row-level security, and restrict execution to the intended roles, including authenticated anonymous users where currently supported.

   Preserve exact response counts initially by calculating them inside the RPC. This removes their separate HTTP requests without changing the current eligibility helpers or consumers. Any later change from exact counts to existence checks should be driven by SQL measurements and a separately updated API contract. The existing library collection loaders continue through their current coordinator; this step consolidates the feed endpoint's six upstream calls.

   Preserve all existing feed modes and fallback decisions, including no interactions, no request, pending generation, exhausted feeds, failed/skipped requests, and eligible books. Keep book mapping in the server helper and retain overall request timing. Keep the existing RPCs available during rollout so the server read can be rolled back independently.

   Install and verify the additive RPC through the web SQL Editor, then switch the development endpoint. Installing the function alone does not change production latency. Before the eventual production application deployment, repeat the installed-function verification and account for the manually applied migration in the deployment process so its `CREATE FUNCTION` is not replayed.

   Verify the response contract and one upstream RPC call, then exercise eligibility and ownership using two accounts and real RLS in an isolated database. Measure the new SQL plan with representative feed/library fixtures. The repository's historical migration-chain issue is already documented: validate this additive change against the isolated baseline/live-compatible schema without coupling this feature to baseline promotion.

   Completion: the current frontend works unchanged, and one feed API request makes one Supabase RPC call while returning equivalent feed decisions.

   Status on 2026-10-24: implemented in development and verified. The installed function passed all ten live equivalence comparisons and four access checks. Twenty endpoint tests and seven eligibility tests passed, alongside type checking and changed-file lint/format checks. The user's real HTTP captures returned equivalent feed bodies in 1776 ms fresh and 467 ms warm. Upstream latency still dominates the fresh request; subsequent steps remain necessary for near-instant entry. The deployed production application retains its existing six-call flow.

2. Extract initial feed ownership into a shared browser controller.

   Create a feed controller under `src/lib/feed` that owns the account, initial candidates, active displayed list, prepared replacement snapshot, request identity, refresh/error state, and the metadata needed to hand off to existing pagination. Use a browser-owned instance or layout context so mutable account state is not shared across server-rendered requests. Move the current initial-load decisions out of `rate/+page.svelte` and have the page subscribe to the controller.

   Give loading and refreshing separate states. A request can be in flight while an active list remains available. Deduplicate concurrent preparation/refresh calls for the same account, and reject late responses after account changes using ownership and request-generation checks. Leaving `/rate` may retain a useful account-owned read; signing out or switching accounts invalidates it.

   Keep `activeBooks` separate from `preparedSnapshot`. A refresh updates the prepared snapshot and reusable candidate buffer, rather than replacing the active list. Admit a new list when entering the route before cards mount. Existing pagination can append unique eligible books while preserving existing card order. An empty or failed refresh preserves usable active content and records a retryable error without returning to initial skeletons. Authoritative auth failure still follows the existing session handling.

   Keep search overlay behavior, save flushing, generation triggers, request cooldowns, and the existing pagination progress/dwell controller compatible with their current behavior. Read-only preparation must not create generation jobs. Preserve the existing cold-load generation/Top 100 decisions when no usable list exists.

   Verify request reuse, account switches, late responses, failed refreshes, and active-list identity/order preservation. Run the existing rate scheduling and library-action browser coverage.

   Completion: `/rate` uses the controller with current cold-load behavior, and background refresh cannot unmount or wholesale replace an available grid.

   Status on 2026-10-24: implemented in development. The root layout provides its own controller through context; the page subscribes to its active books and initial-loading state. Concurrent reads are shared, recent prepared results are reusable in memory for five minutes, and navigation retains useful reads while releasing the departed grid. Owner changes abort reads and invalidate entry permissions; same-account token refreshes preserve them. Preparation stages new data without replacing the visible list. Existing generation/polling, Top 100 fallback, local exclusions, and pagination gates remain connected through guarded page operations. Browser coverage verifies stable card nodes/order/scroll under delayed, empty, failed, and reordered refreshes, plus account changes, search entry, guest handoff, and pending initial generation. See the [controller validation record](scripts/diagnostics/rate-feed-controller-validation.md). Complete interaction snapshots, persistence, and landing-page preparation remain steps 3–5.

3. Persist complete interaction snapshots for safe immediate actions.

   Extend the existing account-scoped library caching to represent complete snapshots for ratings, bookmarks, and dismissals. Preserve the UUID/ULID mappings required by the existing stores. Track successful completeness per collection, including successfully loaded empty collections; an uninitialized or failed empty collection must not overwrite a valid cache.

   Restore these snapshots through the existing stores and `libraryLoads` snapshot mechanism, then revalidate through the current loaders. Reuse the `librarySaves` revision/overlay mechanism so pending and recently acknowledged local actions win over older cached/network reads. Snapshot availability and server-refresh status remain separate concepts. Keep existing save/retry/error notices and the recommendation-generation persistence checks.

   Support the previous ratings-only cache during migration without treating its missing bookmark/dismissal data as complete. Clear disposable snapshots separately from pending-save journals. Cross-tab/account events must invalidate or refresh only the relevant account's view, and must not silently discard pending intent.

   Verify complete empty collections, partial/old caches, failed revalidation, and a user action occurring during an older read. Verify that saved and pending exclusions are restored, and that actions are enabled only when their required snapshots exist.

   Completion: a returning user with complete local interaction snapshots can use the existing rating/bookmark/dismissal actions while server revalidation continues.

   Status on 2026-10-24: implemented in development. V2 account snapshots independently retain complete ratings, bookmarks, and dismissals, including empty collections and UUID/ULID mappings. Restoration uses the existing stores, readiness flags, and save-journal overlays; legacy detail-only caches do not establish complete interaction IDs. Loaders verify exact totals and fetch capped pages before committing. Relevant cross-tab events revalidate without replacing mounted cards, and logout clears only the affected account's snapshots while retaining pending intent. Validation passed 113 targeted Node tests, 19 Chromium component tests, and 15 Playwright scenarios, including delayed/failed reads, a 1,007-item capped library, acknowledged-action races, cross-tab changes, and sign-out. See the [interaction snapshot validation record](scripts/diagnostics/library-snapshot-validation.md). Persistent feed restoration and landing-page preparation remain Steps 4 and 5.

4. Add a persistent feed snapshot and wire cache-first route entry.

   Add a bounded, versioned, account-scoped feed cache using the existing browser-storage pattern. Store the book fields needed by the cards, a fetch timestamp, source feed identity/mode, and enough provenance to restore a valid initial list. Keep interaction state in the step 3 cache and its existing stores rather than creating another writable library store. Cache one or two batches, up to 100 unique books, rather than an unbounded browse history.

   Initial policy: reuse an in-memory read for five minutes, retain a persisted feed for up to 24 hours, and start background revalidation when restoring a persisted snapshot. These are configurable defaults, not timers that remove an active grid. Use a small bounded persistence delay so quick reloads can recover a recently received list without writing on every reactive update. Validate payloads and sizes on read; storage errors, corrupt data, expiry, or incompatible versions fall back to ordinary loading.

   Once the current account is identified, restore its interaction snapshots, filter cached candidates against known and pending interactions, and admit the remaining books before mounting the grid. Revalidate without replacing that active list. Stage new ordering, remote exclusions, and changed book payloads for a later list admission, preserving the current visible cards. Apply the user's explicit actions using existing behavior.

   Keep cached card expansion and detail behavior functional. Reinitialize pagination progress/dwell from the current mount rather than replaying persisted timers. A persisted request ID or generation status is a hint: confirm current server state before using it to resume generation or create a job. If filtering leaves no usable cached books, continue through the existing fresh-load/fallback path.

   Clear the account's feed snapshots on explicit logout; account changes must immediately clear the active display and ignore old requests. Persisted content never establishes authentication or permission to write. Keep personalized API responses out of shared HTTP/CDN caches.

   Completion: cached entry renders usable cards without awaiting the feed API, and a delayed, failed, empty, or differently ordered refresh produces no skeleton flash, visible-list replacement, or scroll jump.

   Status on 2026-10-24: implemented in development. The layout controller restores a validated account-owned snapshot of up to 100 books for 24 hours, after complete interaction snapshots are available and local/pending exclusions are applied. A read-only refresh stages the next list while preserving mounted cards, order, and scroll. Full card details survive restoration; pagination starts new dwell/progress state, consumes fresh unique candidates, and requires a successful live status read before generation/polling. Empty authoritative responses retire old disk candidates for later entry; outages retain them and access failures invalidate them. Logout clears this account's queued/persisted feed separately from pending journals. Validation passed 104 targeted Node tests, 29 Chromium component tests, and all 24 Playwright scenarios, including nine new full-application cache cases. See the [persistent feed validation record](scripts/diagnostics/rate-feed-cache-validation.md). Landing-page preparation remains Step 5; real performance acceptance remains Step 6.

5. Prepare the same feed resource from the landing page.

   After existing-session restoration identifies a user on the landing page, restore caches and invoke the controller's read-only preparation once. The Start rating navigation consumes the completed prepared snapshot or joins the same in-flight request. Reuse a recent prepared result without immediately making a duplicate request on `/rate` mount.

   Keep the landing page interactive while this work runs. Signed-out visitors retain the current flow; prefetch must not create anonymous sessions, flush user writes, or insert feed-generation requests. Preserve maintenance-mode routing. Reuse the existing route-code preloading behavior and cover priorities; measure covers separately before adding image prefetching.

   Verify clicking before, during, and after preparation; repeat navigation; an account change during preparation; and visitors who remain on the landing page. Confirm that multiple subscribers produce one feed read and zero generation writes from prefetch.

   Completion: time spent on the landing page advances the same preparation used by `/rate`, with no duplicate mount fetch or new generation cost.

   Status on 2026-10-24: implemented and locally verified. Preparation waits for existing session restoration and matching controller ownership; signed-out and maintenance visits skip it. Early clicks remain usable, navigation retains pending preparation, recent results avoid a duplicate read, and failed preparation does not loop or create jobs. Account changes cancel old work. The shared read's 10-second deadline covers response bodies and permits retry while preserving usable content. See the [completion record](scripts/diagnostics/rate-entry-completion-validation.md).

6. Validate the complete behavior and roll out with measurable checks.

   Add focused browser scenarios using the real page flow and controlled API latency. Capture click-to-first-card, click-to-usable-rating-action, request counts, stable book IDs/order, and scroll position. Include a refresh returning a different feed after three/five seconds, a user mutation during that refresh, a failed/empty refresh, warm navigation, restored browser storage, logout/account changes, corrupt/missing/partial caches, expired-session handling, and exhausted feeds. Exercise card details, search, pagination, and the existing save-failure/retry behavior.

   Require the grid's existing card nodes to remain mounted during background refresh, with no full-grid loading state after usable content is admitted. Confirm remote exclusions apply to the next admitted list and that explicit local exclusions are not resurrected by an older response. Check storage fallback without deleting pending changes. Use the existing save-queue tests for mutation durability rather than implementing a second queue.

   Run the targeted server/store/browser tests, repository type checks, formatting/lint for changed files, and the relevant existing end-to-end coverage. Keep the real HAR and query metrics distinct from controlled browser timings. Compare local and deployed behavior with a ready session, ordinary warm traffic, and the previously observed idle/slow-upstream condition.

   Target under 200 ms from click to usable cards for a cache hit with route code already available; treat this as a measured target, not a guarantee covering network-dependent code or image downloads. Track cache-hit rate, first-usable-card latency, feed request count, and backend latency separately so fast display does not hide a continuing Supabase issue.

   Deploy the additive RPC before the server path that requires it, then roll out the controller/cache/prefetch changes in the order above. Preserve a way to disable the cache/prefetch path without deleting pending saves. Keep per-request timing and use the observed Supabase spike as a separate infrastructure investigation.

   Completion for the current development scope: the acceptance cases below and targeted regressions pass, and controlled production-build browser measurements meet the cache-hit target. Deployed measurements and rollout are explicitly deferred by the user.

   Status on 2026-10-24: local application acceptance passed. Click-to-usable-action samples were 74–149 ms across disk-cache, completed landing preparation, and warm-navigation cases, with one shared read per five-visit scenario and zero generation writes. Those measurements temporarily skipped `/rate`'s fade; the original 150-ms transition was restored on 2026-10-25. Validation covered 152 targeted Node tests, 37 component cases, 24 production-preview feed/landing cases, and 15 existing library load/save browser cases. Fixtures isolate application behavior; real-user cache-hit rate, upstream latency, and deployed results remain unmeasured. See the [completion record](scripts/diagnostics/rate-entry-completion-validation.md).

| Scenario                                                  | Required result                                                                           |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Valid feed and complete interaction caches                | Usable cards render while network revalidation continues.                                 |
| Refresh returns a new order or remote exclusions          | Current list remains stable; the prepared next list reflects the update.                  |
| Refresh fails, times out, or returns no books             | Usable content remains, with existing retry/error behavior available.                     |
| A local action occurs during refresh                      | The action and its pending-save state survive; older responses do not resurrect the book. |
| Landing-page preparation is already running               | `/rate` joins it, with one feed read.                                                     |
| Account changes or user logs out                          | Previous account's visible content clears; old responses cannot repopulate it.            |
| Missing, incompatible, partial, or unusable cache         | Current fresh-load and action-readiness rules continue to work.                           |
| Feed needs generation and has no usable cached candidates | Existing generation/fallback behavior works without duplicate jobs from prefetch.         |

The first release preserves the existing generation cadence, server ownership enforcement, durable save queue, and public page flow. A separate external serving cache, server-auth/SSR migration, generation-polling changes, and infrastructure upgrades can be considered after measuring these changes; they are not prerequisites for the six steps above.
