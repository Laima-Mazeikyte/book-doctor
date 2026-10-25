# Uncached rate entry and console messages — 2026-10-25

The cache-first integration is implemented. It does not guarantee instant personalized entry without a reusable feed result. The strict under-200-ms warm-entry target remains open; real upstream cold-entry latency is deferred. The reported auth-lock error is resolved following the SDK upgrade and dependency rebuild, and route-specific font preloads are implemented. See the [current status](rate-entry-status-review.md) and [developer testing handoff](rate-entry-developer-handoff.md).

## Immediate entry is not necessarily a cache miss

An existing user can open `/rate` directly and still reuse a persisted feed plus complete interaction snapshots. Landing dwell is unnecessary for that case. A true miss has neither a reusable in-memory/prepared feed nor a usable persisted feed. With no landing preparation, the current path is:

1. Restore the session to establish account ownership. An expired session can require refresh.
2. Fetch `/api/feed/latest`, whose server makes one authenticated `get_rate_feed_bootstrap` RPC.
3. Admit the returned eligible books and render the grid. Library interaction-ID reads run alongside the feed read; actions retain their per-collection readiness guards.

If the live feed response takes three seconds, the uncached page can still show skeletons for that wait. If only library reads are slow, cards can appear while actions remain disabled. There is no fixed three-second render sleep. Generation/polling for an actually exhausted feed is a separate case from reading an existing eligible feed.

## Added direct-entry coverage

Three production-preview Playwright checks now use a valid existing fixture session, **no feed snapshot, no library snapshot**, direct document navigation to `/rate`, and no visit/hover/preparation on the landing page. All API/auth responses are intercepted; no live records or real credentials are used.

| Fixture dependency held for three seconds | First visible cards from document navigation | Rating enabled from document navigation | Result                                                              |
| ----------------------------------------- | -------------------------------------------: | --------------------------------------: | ------------------------------------------------------------------- |
| Feed only                                 |                                    3897.9 ms |                               3897.9 ms | Skeleton remains until the held feed is released.                   |
| Library only                              |                                     268.7 ms |                               3493.6 ms | Books appear before library release; rating waits for complete IDs. |
| Both, released together                   |                                    3584.5 ms |                               3626.1 ms | Reads overlap; they do not form two serial three-second waits.      |

The three-second fixture hold starts after the request/initial UI checks, so these document-navigation timings include startup and checking overhead. These are dependency checks, **not real Supabase response measurements or cold-entry latency estimates**. Each case used one feed read, zero generation writes, zero interaction writes, and no public fallback read. Assertions check the ordering relative to response release rather than impose a hardware timing target.

Run after building, with port 4174 available:

```powershell
pnpm exec playwright test -c playwright.rate-entry.config.ts --grep "direct uncached entry"
```

## What the real upstream evidence establishes

The original slow endpoint spent 3559.5 ms inside its handler's Supabase calls. After consolidation, real feed HTTP observations were 1776 ms fresh and 467 ms warm. A later read took 2481 ms, including 2418 ms in the bootstrap round trip. That later result completed about 91 seconds before the user's click and therefore did not delay that cached entry.

Installed-function SQL comparisons took about 5.2–5.3 ms in their measured context. Other requests also slowed behind Supabase's gateway in the original capture. Together these findings make more index/query tuning an unproven explanation for the multi-second delay. The SQL and HTTP observations are different measurements; subtracting them does not isolate pool wait or establish a cold-start cause.

The exact cause remains unproven. To distinguish connection setup, PostgREST pool waiting, database execution/waits, resource pressure and region/network latency, correlate a new slow request's UTC time with Supabase API/database logs and metrics. No new live SQL, database settings, instance sizing, deployment, or migration-history changes were made in this review.

Potential follow-up changes depend on that evidence:

- If upstream queueing/resource pressure dominates, address the measured pool/resource cause; extra browser prefetch cannot solve a true cache miss.
- If the application-server-to-Supabase hop dominates, review deployment region and connection reuse. Removing or shortening that hop does not explain a simultaneous upstream service-time spike by itself.
- If library readiness dominates, evaluate a bounded cold-bootstrap interaction snapshot so complete exclusion/action state arrives with fewer requests. Large libraries and the distinction between card display and action readiness need explicit treatment; blindly adding all IDs to every feed response could slow it.
- If instant cold-browser entry must survive a slow database, consider a fast, authenticated, account-scoped server cache/precomputed feed. That adds invalidation and consistency work; it is not implemented by the existing browser cache.

## Auth-lock rejection

The development SDK is now **2.118.0**, whose default auth coordination does not use Navigator Locks. A running localhost server was found serving the old optimized dependency; forced dependency optimization was advised, and the user subsequently confirmed the error is gone. See the [upgrade record](rate-entry-auth-sdk-upgrade.md) for validation, the explicit database retry policy, and optional repeat checks. The investigation below describes the earlier SDK and does not identify an outstanding auth task.

The previously installed SDK was 2.99.1. Its background refresh tick tries an exclusive auth-session Web Lock with acquisition timeout zero. Contention is designed to skip the tick through an acquire-timeout catch. The synchronous application auth callback does not await another Supabase auth call.

Earlier isolated Chromium/Firefox tests exercised lock contention without real credentials and did not reproduce an unhandled rejection. Those tests alone did not clear the user's Firefox 158 report. This browser synchronization error was separate from a measured database/API response already in flight.

The user later supplied a recurring localhost stack. Additional isolated tests with the locally installed Firefox 158.0.1 passed valid/expired session restoration, token refresh, explicit lock contention and a post-release session read. Both installed UMD and Vite-transformed SDK checks produced zero unhandled rejections. These used a temporary profile and synthetic responses; the served SDK version in the Vite check was not recorded, so it is not upgrade confirmation. The later user confirmation closes the reported symptom. See the [quiet-save follow-up](rate-entry-quiet-saves.md) and [auth record](rate-entry-auth-sdk-upgrade.md).

If a new auth error appears, record the served SDK version and whether restoration or refresh fails. Distinguish a debugger stop on a caught exception from an actual `unhandledrejection` event. Multiple tabs or hot reload were considered possible contributors to the historical report; neither was established as its cause.

The [official SDK changelog](https://github.com/supabase/supabase-js/blob/master/CHANGELOG.md) records removal of the navigator-lock mutex in 2.107.0. A later [refresh-rejection fix](https://github.com/supabase/supabase-js/pull/2627) handles a rejected refresh deduplication promise when no concurrent caller awaits it. These motivated the subsequent tested SDK upgrade. No lock override, auth-storage reset or error suppression was applied.

## Font-preload warnings

Update: route-specific hints now replace the eight global preloads. See the
[font validation record](font-preload-validation.md) for measured download reductions
and browser checks. The findings below describe the pre-cleanup configuration.

Before cleanup, `src/app.html` preloaded eight fonts globally, including static and variable Bespoke cuts, three Inter weights, and Beth Ellen. The eight files totalled 222,940 bytes (about 218 KiB) before HTTP encoding. `as="font"`, `type="font/woff2"` and `crossorigin="anonymous"` were already present, and their paths matched the font-face definitions. See [MDN's preload guidance](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload).

The warning means a prioritized preload was not consumed promptly. It does not establish a missing font or a failed feed read. Inter and Beth Ellen also use `font-display: optional`, which can keep fallback text for that page load if the font is not ready promptly. Global preload selection should be reviewed against the actual initial route/viewport; unnecessary preloads can compete with useful downloads.

The implemented cleanup preserves font families, weights, CSS and display policy while selecting measured preloads per route. Landing now has three hints and `/rate` four. A conditional face can still be unused on a particular visit; this is not an outstanding requirement to eliminate every preload warning. See the [font validation record](font-preload-validation.md).

## Real-account cold-entry check

1. Use the updated production preview and a pre-logged-in account with an existing eligible feed. Let pending saves settle. Keep browser HTTP cache enabled and the viewport fixed.
2. In browser storage, remove only that account's disposable `book-doctor:rate-feed:v1:<uid>` and `book-doctor:library-cache:v2:<uid>` entries. Keep the auth session and pending-save journal. This tests application-cache misses without signing out or fabricating an HTTP-cache miss.
3. Record Network/Performance, then navigate directly to `/rate` without visiting the landing page. Capture the latest-feed duration and `Server-Timing`, the three library reads, any token refresh, and when cards/actions become available. The click-armed console probe does not survive a full document navigation; use the browser recording for this case.
4. Compare an immediate repeat visit and a post-idle visit. Browser snapshot eviction does not make Supabase's connections or database buffers cold. Do not loop requests while trying to reproduce the idle case; that warms the upstream path.

If a real miss still takes seconds, retain the UTC interval and upstream timing headers for the next infrastructure investigation. Current fixture checks establish the dependency, not the live cause.
