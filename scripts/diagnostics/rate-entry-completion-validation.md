# Rate entry: application completion validation

This is the historical 2026-10-24 validation record for the bounded shared read, landing-page preparation, and then-current controlled behavior/timing acceptance. For the current handoff and open timing target, see the [developer testing handoff](rate-entry-developer-handoff.md). Production deployment/measurements, Supabase spike diagnosis, and migration-history reconciliation are explicitly deferred by the user.

2026-10-25 correction: the intentional 150-ms navigation fade has been restored at the user's request. The timing table below is a historical zero-fade measurement, not acceptance evidence for the restored visual transition. The restored UI passed 26 behavioral cases, but its separate timing rerun measured 153–420 ms and failed all three strict under-200-ms scenario assertions. See the [UI/UX audit](rate-entry-ui-ux-audit.md) for the restoration and subsequent checks.

## Request deadline and recovery

`FEED_READ_TIMEOUT_MS` defaults to 10,000 ms. The controller also accepts `readTimeoutMs` for configuration/testing. The deadline wraps the complete `readLatest` promise, including response-body parsing. Timeout aborts the browser request, settles subscribers even if a transport ignores cancellation, releases the pending slot, and permits another attempt. Late success/failure cannot publish a snapshot or clear a newer request.

Timeout preserves mounted cards and valid disposable snapshots. A cache miss continues through the existing Top 100 fallback. Ownership change/destruction settles canceled reads and clears the deadline. Read preparation adds no automatic retry or generation/write retry. Aborting a browser request does not guarantee cancellation of database work already running upstream; this change bounds the browser's wait on the shared read, not every network operation in the application.

Six focused deadline tests cover a never-settling transport, a response body stalled after nine seconds of headers wait, late results, retry, cache preservation, cache-miss fallback without generation, account cancellation, a configured deadline, and destruction.

## Landing preparation

`LandingFeedPreparation.svelte` mounts only on the landing page. Its browser effect waits for settled session restoration and matching controller ownership, then calls the existing controller's read-only `prepare` once per account/landing visit. Existing signed-in anonymous sessions are supported; a signed-out visit creates no session. Maintenance mode skips preparation.

The component does not abort useful preparation on navigation. `/rate` joins the pending read or reuses its recent prepared result, without a duplicate mount fetch. Failure remains silent on the landing page and does not form a retry loop. A later entry can attempt the read again. The root layout retains its existing library restoration/revalidation and save-journal behavior; preparation adds no save flush or generation callback.

Account changes abort the previous read and permit preparation for the new account. Preparation does not bypass action readiness: rating needs ratings and dismissal IDs, bookmarking needs bookmark and dismissal IDs, and dismissal needs all three collections. Partial snapshots retain those existing guards.

During the original acceptance run, `/rate` temporarily skipped the existing 150-ms page fade. Earlier timing runs showed ready card DOM preceding visible cards and some samples above 200 ms (up to 254 ms). That visual change was subsequently reversed: `/rate` again uses the original fade and reduced-motion handling. Data availability and intentional animation must be assessed separately; no UI wording was added by the preparation/deadline work.

## Controlled production-build measurements

The browser test records the actual click event and samples animation frames for the first visible card and its enabled rating control, checking ancestor opacity/visibility as well as card layout. This measures the first render frame with usable controls, rather than API completion. DOM arrival is recorded separately. Cover download completion is excluded; fixtures have no remote covers. Route code is warmed through the existing hover preload and the session/complete interaction snapshots are ready.

Chromium ran the production bundle locally on one worker, with intercepted auth/library/API fixtures. Each scenario made **one feed read across all five visits**, with **zero generation writes**. The disk-cache scenario held the feed response throughout all five visits.

| Scenario                              | Samples | First visible card, ms | Usable rating action, ms | Median usable action, ms |
| ------------------------------------- | ------: | ---------------------: | -----------------------: | -----------------------: |
| Persisted feed, refresh still pending |       5 |             81.1–148.5 |               81.1–148.6 |                    113.4 |
| Completed landing preparation         |       5 |             74.3–135.9 |               74.3–136.0 |                    127.5 |
| Warm navigation                       |       5 |             79.4–130.1 |               79.4–130.2 |                    118.7 |

All 15 historical zero-fade samples met the **under-200-ms** acceptance target. Rounded raw samples are in [rate-entry-local-timings.json](rate-entry-local-timings.json), and each timing test attaches its unrounded JSON report. Five samples per scenario establish this controlled local result, not a production percentile or a guarantee across devices. These samples do not validate visible-action timing after fade restoration. Real cache-hit rate, Supabase latency, authentication delays, code downloads, and deployed performance remain outside this measurement.

## Behavioral and regression checks

- 152 targeted Node tests across controller/deadline/persistence/cache, endpoint/eligibility/pagination, library caches/snapshots/save queue, and library loaders.
- 37 Chromium component cases, including landing ownership/read sharing, same-account token refresh, maintenance, account switch, failure, navigation retention, and the existing rate-page scheduling/search/pagination cases.
- 24 production-preview feed/cache/landing scenarios, including three timing cases. The new partial-cache scenario initially had an incorrect readiness expectation; its corrected version passed a focused rerun. The other 23 passed the full production-preview invocation.
- All 15 existing library load/save end-to-end scenarios passed in the development-browser run.
- Production build, Svelte/TypeScript checking (zero errors/warnings), changed-file lint/formatting, and whitespace checks passed.

Full browser coverage includes clicks before/during/after preparation, expired-session refresh, repeat navigation, three/five-second delayed refreshes, a ten-second timeout and later recovery, failed/empty refreshes, complete/partial/corrupt/expired snapshots, exclusions and pending saves, logout and late results, card summaries, and public pagination failure/retry.

The existing refresh-stability fixture scrolled 250 px, which could cross normal automatic-pagination credit and produce extra reads during an empty refresh. It now uses a nonzero 50-px position to isolate background refresh and still assert exact scroll preservation; pagination has separate controller/component/browser coverage. The corrected case passed in production preview.

## Reproduction and rollback

Build and run the controlled browser suite:

```powershell
pnpm run build
pnpm exec playwright test -c playwright.rate-entry.config.ts
```

The dedicated config uses local production preview on port 4174, one worker, and enables the timing cases. Ordinary end-to-end runs skip timing acceptance to avoid measuring development compilation or worker contention. Fixtures intercept writes; these checks do not need user credentials or live SQL. The user's port-5173 dev server is not managed by this suite.

The existing browser factory still supports `persistSnapshots: false`. To disable both disk caching and landing preparation through a code rollback, pass that option from the layout and remove the landing preparation component mount. Neither operation deletes pending-save journals. In-memory request sharing and the unified endpoint remain independent of disk caching.

The original checks found no remaining functional issue. After restoring the fade, functional checks still pass, but consistent under-200-ms visible-action performance remains open. Future deployment verification and infrastructure investigation remain tracked separately in the [status review](rate-entry-status-review.md).
