# Performance and investigation procedures

## Rate entry: current behavior and open target

Functional implementation is complete in development: one annotated bootstrap RPC,
account-owned shared reads, prepared/cached snapshots, complete library hydration,
quiet optimistic saves and account-change cancellation. The original 150-ms navigation
fade remains. Persistent feed candidates are bounded to 24 hours/100 books and filtered
against current/pending interactions. Cached cards remain mounted during refresh.
The shared read deadline is 10 seconds; it does not cover every auth/library operation.
Landing preparation reuses reads and never starts generation jobs. After landing
images/fonts are ready and the logo video has a frame, it preloads `/rate` code,
prepares the live public Top 100 or authenticated feed, and warms first-row covers.
Top 100 preparation preserves the response's shuffle seed and pagination; early
clicks join pending reads or start foreground loading without waiting for assets.
Popular preparation expires after five minutes and is consumed by the next entry;
account changes and interactions invalidate it. The layout keeps one keyed wrapper
so enabling the 150-ms destination fade does not remount the departing landing page.

The strict under-200-ms cache-hit visible-action target remains open. Historical
restored-fade fixture measurements (October 25, 2026):

| Scenario                      | Visible rating range | Median   | Samples under 200 ms |
| ----------------------------- | -------------------- | -------- | -------------------- |
| Disk cache, refresh pending   | 169.5–236.3 ms       | 180.3 ms | 4/5                  |
| Completed landing preparation | 152.9–420.1 ms       | 258.6 ms | 2/5                  |
| Warm navigation               | 209.7–391.2 ms       | 217.3 ms | 0/5                  |

November 8, 2026 production-preview validation after landing asset gating, live
Top 100 preparation, route/cover preloading, and the stable transition wrapper:
all 33 behavior checks passed. The three timing assertions still failed. Every
visible-rating sample is listed below, in run order, with the 150-ms fade retained.

| Scenario                      | Visible rating samples (ms)       | Median   | Samples under 200 ms |
| ----------------------------- | --------------------------------- | -------- | -------------------- |
| Disk cache, refresh pending   | 195.1, 314.3, 241.4, 241.3, 338.4 | 241.4 ms | 1/5                  |
| Completed landing preparation | 420.2, 301.1, 201.6, 243.7, 210.3 | 243.7 ms | 0/5                  |
| Warm navigation               | 173.7, 253.1, 241.9, 275.9, 403.8 | 253.1 ms | 1/5                  |

These authenticated fixtures made one feed read and zero generation writes per
scenario. Separate signed-out and below-threshold behavior checks verify that a
pending Top 100 read is shared, its seed/offset survive entry, and asset waiting
does not delay an early click. These samples do not establish production latency
or a strict instant-render guarantee.

Each scenario made one feed read and zero generation writes. Earlier 74–149-ms samples
used a temporary zero-fade build and do not establish acceptance for the restored UI.
Do not weaken assertions or remove the fade to make the benchmark pass. Functional
behavior and timing acceptance are separate outcomes; these small local fixture samples
are not production percentiles. Cover completion, DOM arrival, enabled actions and
visible actions are different milestones. A null visible-action result may mean the
controls were outside the viewport, rather than disabled.

## Reproduce behavior and timings

See [development](development.md) for build/test commands. Build first and leave port
4174 available. Run behavior with grep-invert "entry timing:"; run timing assertions
separately with grep "entry timing:", after other CPU-heavy checks finish. Preserve
fixture/network/cache conditions and report every sample, not just the fastest.

The browser probes remain in scripts/diagnostics/rate-entry-browser-probe.js and
feed-cold-load-probe.js. Their own comments describe installation and available API.
Use a temporary browser profile or separate test account. Do not copy tokens/session
contents into reports. A document navigation does not preserve a console-installed
click probe; use a browser Performance/Network recording for direct entry.

For a real-account application-cache miss, let pending saves settle and remove only
that reader's disposable book-doctor:rate-feed:v2:<uid> and
book-doctor:library-cache:v2:<uid> snapshots. Preserve auth and pending-save journals.
Keep browser HTTP cache/viewport fixed. Navigate directly to /rate, then compare warm
and post-idle entries without repeatedly warming the upstream service. Browser cache
eviction does not make Supabase's buffers/connections cold.

## Upstream latency investigation

Paused at the user's request until the slowdown is reproducible. Historical HTTP
observations included 1776 ms fresh, 467 ms warm and a later 2481-ms feed read. A cached
visit reused that later response about 91 seconds afterward. Separate SQL observations
around 5.2–5.3 ms were not contemporaneous end-to-end measurements. Later cumulative
statement counters averaged 300.655 ms and reached 1482.533 ms across 121 calls.
The October 25 slow gateway pair had Envoy upstream times of 690/836 ms, with later
values as low as 48 ms. These do not isolate pool wait, SQL execution, gateway CPU or
prove a cold-start cause. The ultimate source of the variation remains unproven.

Use scripts/diagnostics/supabase-latency-diagnostics.sql only when a new reproduction
exists. It is a read-only Database/postgres report with a configurable recent window;
statement counters are cumulative and current waits describe capture time. Correlate
request ID, UTC timestamp, duration/Server-Timing, API/database logs and metrics. Logs
Explorer queries use a different source/dialect from Database SQL. Old incident-specific
October 25 log queries are archived locally, not pending run instructions. Do not reset
statistics, resize the database or change pools without evidence of the actual cause.

## Authentication and fonts

The Supabase SDK upgrade to 2.118.0 plus Vite dependency rebuild resolved the reported
auth-lock symptom according to the user. Keep db.retry:false because library/feed
controllers own retries. If it returns, record the SDK actually served and distinguish
a caught debugger exception from an unhandled rejection; do not wipe auth or save journals.

Font preloads are route-specific. Existing families, weights and display policies remain;
unused-preload warnings alone do not indicate missing fonts. November 1 cleanup retains
the same WOFF2 fonts but removes obsolete EOT/WOFF/TTF source copies and CSS fallbacks.
This is separate from the earlier preload behavior change. Preserve font notices/licenses.

## Book pages and connections

Series thumbnails are released after the main cover has settled and painted; see
[book-page behavior](book-page.md). The earlier uncontrolled lazy strip could request
all 22 thumbnails and contend with the main cover. The gated design preserved ordering
in all 24 simulated checks, with no consistent added opening delay in the sampled series.

Connections load outside the public page path. Initial local synthetic database medians
were about 6/19/141 ms for histories of 100/1,000/10,000 rated books; later parallel local
work changed those timings. They exclude network/metadata and do not establish hosted
concurrency capacity. Monitor actual RPC latency/errors after release. Extra caches and
infrastructure are not required for the current load-once implementation.

Raw dated JSON, screenshots and superseded reports are recoverable under ignored
temp/repository-cleanup-2026-11-01/ with original paths and checksums. Current statements
here preserve accepted behavior, unresolved targets and measurement limits.
