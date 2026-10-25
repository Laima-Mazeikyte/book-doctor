# Investigating `/rate` entry latency

## Current status (2026-10-25)

Start with the [developer testing handoff](rate-entry-developer-handoff.md) for setup,
shared-database constraints, focused test commands, and expected behavior. Node 22.12+
and pnpm 9.15.9 are required. The timing benchmark retains its open under-200-ms target.

The shared database now has the additive `get_rate_feed_bootstrap` RPC installed. Its live
verification at 23:42 UTC passed all ten equivalence comparisons and four access checks.
The development `/api/feed/latest` implementation now makes one authenticated RPC call,
preserving its response fields and existing book mapper. The deployed production application
keeps its six-call implementation until the planned application deployment in approximately
two months; both implementations use the same database. See the [validation record](rate-feed-bootstrap-validation.md).

Step 2 now gives the layout an account-owned feed controller. It reuses in-flight and recent
in-memory reads while keeping prepared snapshots separate from the active card list. See the
[controller validation record](rate-feed-controller-validation.md).

Step 3 now restores complete ratings, bookmark, and dismissal snapshots through the existing
stores and readiness checks. Returning users with complete cached collections can act while
library revalidation runs. See the [interaction snapshot validation record](library-snapshot-validation.md).
Step 4 now restores validated feed candidates for up to 24 hours, filtered against those
interaction snapshots, while refreshing the next list without replacing mounted cards.
See the [persistent feed validation record](rate-feed-cache-validation.md). A returning user
with usable feed and complete interaction snapshots can see and act on cards before network
revalidation finishes. Step 5 now prepares the same shared read from the landing page after
existing-session restoration. A configurable 10-second deadline covers the shared response and
body, preserving cached cards and permitting retry. Missing/unusable caches retain ordinary loading.

Step 6's original controlled local acceptance used zero fade: all 15 production-build browser samples
reached usable rating actions in 74–149 ms with ready session/route code and usable snapshots.
The intentional 150-ms fade was restored on 2026-10-25; those figures do not measure the restored UI.
The restored UI passed all 26 behavioral cases; a separate 15-sample timing run measured 153–420 ms
and did not consistently meet the unchanged under-200-ms target. See the [UI/UX audit and follow-up checks](rate-entry-ui-ux-audit.md).
See the [completion validation and reproduction commands](rate-entry-completion-validation.md).
The [current completion review](rate-entry-status-review.md) separates finished application work
from explicitly deferred production/infrastructure work and records the pagination copy/retry fix.

For the next real-browser before/after comparison, use the [browser validation procedure](rate-entry-browser-validation.md)
and [rate-entry-browser-probe.js](rate-entry-browser-probe.js). The probe measures the actual click,
visible cards and enabled controls; the historical waterfall probe's network-derived "list ready"
boundary does not describe cache-first display.

Direct entry without either application snapshot still depends on the live feed and library reads.
Three added fixture checks confirm those dependencies and their overlap. See the [cold-path review](rate-entry-cold-path-review.md)
for the real-account procedure and historical console investigation. Auth is resolved;
font-preload cleanup is implemented, as detailed below.

The [auth SDK and book-cover follow-up](rate-entry-auth-sdk-upgrade.md) records the 2.118.0
upgrade, explicit database retry policy, manual Firefox checks, and cover dismissal treatment.
The user has now confirmed that the auth error is gone. The [font preload cleanup](font-preload-validation.md)
is implemented, with measured cold-load font-byte reductions and browser validation.

### Observed in the supplied Firefox HAR

The capture contains four successful warm `/api/feed/latest` requests taking **506–862 ms**,
then a slow request taking **3566 ms**, after roughly four minutes without recorded API traffic.
Every successful response has `mode: has_eligible_feed`, `status: completed`, and 50 books.
There are **no generation-poll requests or auth-refresh requests** in this capture.

The slow feed response breaks down as follows:

| Stage / request            |  Duration |
| -------------------------- | --------: |
| Latest request metadata    | 3020.7 ms |
| Completed request metadata | 3074.8 ms |
| Ratings count              | 2953.0 ms |
| Bookmarks count            | 3054.1 ms |
| Not-interested count       | 3028.7 ms |
| Books RPC, after metadata  |  483.1 ms |
| Total inside route handler | 3559.5 ms |
| Total observed by browser  | 3566.0 ms |

The five metadata reads overlap. Their slowest request contributes **3074.8 ms**, about 86% of
the handler's duration; the books RPC adds another 483.1 ms. Almost all of the feed request's
elapsed time is accounted for inside the handler's Supabase calls.

Independent browser-to-Supabase reads slowed during the same interval:

| Browser request    | Total elapsed | `x-envoy-upstream-service-time` |
| ------------------ | ------------: | ------------------------------: |
| Rating IDs         |       4157 ms |                         3866 ms |
| Bookmark IDs       |       2673 ms |                         2336 ms |
| Not-interested IDs |       2884 ms |                         2468 ms |

The corresponding nearby warm requests report upstream times of 23, 8, and 21 ms. The Envoy
header covers upstream processing and the network between the gateway and upstream service,
not the browser-to-gateway leg ([Envoy documentation](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/router_filter#x-envoy-upstream-service-time)).
This locates most of the delay behind Supabase's gateway; it does **not** identify pure SQL
execution time, CPU throttling, pool waiting, locks, or a cold connection as the exact cause.

**Finding:** this run is a shared Supabase API/database latency spike that the page exposes by
blocking its first list on a fresh network read. Polling and token refresh do not explain this
sample. The capture has no click/DOM markers or cover-image entries, so it does not independently
measure click-to-paint time. The API wait alone explains the reported multi-second skeleton.

The next infrastructure investigation should compare the slow interval with PostgREST request
and pool metrics, PostgreSQL query durations/waits, and instance CPU/I/O. A missing index or
particular query plan is not established by this HAR; the July findings below remain historical.

### Unified RPC follow-up: fresh and warm XHR captures

The follow-up exports beginning at 23:50:25 UTC on 2026-10-24 confirm the unified endpoint
works through the local application and real Supabase HTTP gateway. The first export has
13 entries; the second contains those same 13 entries plus a warm feed request and a
recommendation-count request. Count the feed observations once, rather than treating the
exports as independent fresh runs.

| Feed observation             | Browser duration | Bootstrap round trip | Handler total |
| ---------------------------- | ---------------: | -------------------: | ------------: |
| Earlier six-call slow sample |          3566 ms |                    — |     3559.5 ms |
| Unified fresh sample         |          1776 ms |            1724.1 ms |     1726.3 ms |
| Unified warm sample          |           467 ms |             452.2 ms |      454.3 ms |

The earlier warm six-call observations ranged from 506 to 862 ms. The new fresh request is
about 50% shorter than the earlier slow request, and the new warm request is below the earlier
warm range. These are individual observations under different upstream/auth conditions,
not a controlled estimate of the refactor's latency improvement or a bound on future spikes.
All successful new feed bodies deeply match the original response, including 50 books in
the same order, 249 ratings, 1228 interactions, and the same metadata. Both new responses are
successful `has_eligible_feed` / `completed` responses; no generation requests or polls occur.

The fresh bootstrap still spends 1724.1 ms in the Supabase round trip. Envelope validation,
book mapping, and response construction account for approximately 2.2 ms more in the handler;
the warm difference is 2.1 ms. These round-trip timings do not isolate database execution from
upstream queueing or networking. Concurrent initial library reads are also slow: rating IDs
2787 ms (2521 ms upstream service time), bookmarks 1351 ms (1171 ms upstream), and dismissals
1438 ms (960 ms upstream). The initial recommendation-count request takes 2563 ms. The shared
upstream latency remains visible after consolidating the feed reads.

This fresh capture includes a successful token-refresh POST taking 806 ms. It finishes at
806 ms relative to the first captured XHR; the feed request starts at 2425 ms and finishes at
4201 ms. Auth is therefore earlier than the measured feed request, and neither the refresh
nor that pre-feed gap can be assigned to the Start rating click without a click marker.
The warm feed starts at 27342 ms, about 25 seconds after the fresh feed starts, with no
additional auth or library fetches during that warm entry. The exports contain only XHR
requests, so they do not measure click-to-card paint, cover loading, or route-code loading.

Step 1 is verified through the real HTTP path. The shared controller is now implemented in
development, along with complete interaction snapshots and persistent feed restoration.
Landing-page preparation is now implemented and shares the same read with `/rate`.
Those steps let a usable list appear while the network refresh
continues. Broader post-idle samples remain useful for investigating the Supabase latency tail.

### Code path at the original capture and controlled reproductions (historical)

For an existing, signed-in user entering from the landing page, the counts and feed take
different paths. The layout restores the session, hydrates cached ratings, and starts library
reads on the landing page. At that stage the feed had no persistent cache or landing-page prefetch:
`rate/+page.svelte` waits until mount and auth readiness, then asks the shared controller for
an initial choice. The controller reuses a recent in-memory result or a request already in
flight; otherwise it requests `/api/feed/latest`. SvelteKit's link preloading does not start
this read.

At the time of the capture, the latest-feed endpoint made **six Supabase HTTP requests in two stages**.
The deployed production application retains this flow during the development overlap:

1. In parallel: latest request, latest completed request, ratings count, bookmarks count,
   not-interested count.
2. After all five finish: `get_latest_rate_feed_state`, which also looks up the request pointers
   before returning eligible books.

The skeleton stays visible through both stages. If there are interactions but no eligible books,
the page also waits for a pending/new generation job. `pollCuratedFeedRequest` polls immediately,
then waits **3000 ms** between pending responses. Even a job that finishes just after the first
poll remains behind the skeleton until the next poll.

Controlled Playwright runs against local Vite, with a valid fixture session, cached ratings,
mocked API/library responses, and no real account writes:

| Controlled response                           | Counts visible | First cards after click |
| --------------------------------------------- | -------------: | ----------------------: |
| Immediate eligible feed                       |          84 ms |                  180 ms |
| Latest-feed response delayed by 3000 ms       |          88 ms |                 3188 ms |
| Exhausted feed; first poll pending, next done |          91 ms |                 3210 ms |

These demonstrate two ways to reproduce the symptom; they are **not measurements of the user's
real Supabase requests**. There is no unconditional three-second render delay. Cover downloads
begin after the skeleton is replaced and cannot explain the skeleton itself. The idle callback's
3000 ms timeout in the library details loader does not gate the feed either.

### Capture the actual click

On the local landing page, open DevTools Console and paste
[`feed-cold-load-probe.js`](feed-cold-load-probe.js). From PowerShell in the project directory,
this copies the file for pasting:

```powershell
Get-Content -Raw scripts/diagnostics/feed-cold-load-probe.js | Set-Clipboard
```

Then run in DevTools Console:

```js
feedProbe.watch();
```

Click Start rating, wait for books, then run:

```js
await feedProbe.report();
await feedProbe.copy();
feedProbe.stop();
```

For client navigation, use the **live watch capture** tables: request starts and DOM milestones
are relative to the Start rating click. The older stage breakdown describes the initial document
load and includes landing-page activity. To capture production, paste the probe file into the
landing page console and call `feedProbe.watch()` before clicking. Keep Disable cache off.

The live capture records feed response `mode`, `status`, book count, and polling timestamps.
The unified development `/api/feed/latest` sends `Server-Timing` with `feed_bootstrap` for the
single RPC round trip and response parsing, plus `feed_total` for the complete handler work.
Earlier instrumentation of the six-call implementation reports the five metadata queries,
`feed_books`, and `feed_total`; those metadata queries overlap and **must not be summed**.
These timings include networking and response parsing, not just SQL execution. The probe
prints and exports whichever timings the running build provides. Production gains the unified
path and its timing headers when that application code is deployed.

- A slow unified latest-feed response: compare `feed_bootstrap` with `feed_total`. For a six-call
  build, compare `feed_total`, the slowest metadata query, and `feed_books`.
- A quick latest response followed by pending `/api/feed` responses: generation/polling is gating
  display. Check the roughly three-second gap between polls.
- A late first feed request: check route loading and `/auth/v1/token` refresh before blaming SQL.

For near-instant entry despite the measured upstream spike, fetch while the existing user is
on the landing page and show a user-scoped cached feed while revalidating. Cached books must
still be filtered against known ratings, bookmarks, and dismissals. Prefetch alone removes the
wait only when the landing-page dwell time covers the request; a fresh cache is what removes
the mandatory network wait for a returning user who clicks immediately.

Consolidating metadata/counts/books into one RPC removes the extra serial round trip and
reduces request fan-out. That helps uncached and warm loads, but cannot guarantee instant entry
when Supabase itself stalls. The generation/polling branch remains a separate possible delay
for exhausted feeds, although it was not taken in the supplied HAR.

## Historical investigation (2026-07-26)

The findings below describe earlier production samples and their database statistics window.
They are background evidence, not a diagnosis of the current three-second entry delay.

Symptom: a logged-in user returning after some idle time sees the `/rate` skeleton for 4–5s,
then books appear ~2s later. Every visit after that is ~1s.

`feed-cold-load-probe.js` is a paste-into-DevTools probe that prices each link of the load.
This document records what it found on production (Firefox, free-plan Supabase, 2026-07-26).

## Verdict

**A missing index was starving the instance; the feed RPC is a victim, not the cause.**

`feed_items` had no index on `user_id`, so a worker query filtering on it read all ~111k rows and
sorted them, 2190 times — ~243 million sequential tuple reads. On a 0.5 GB shared instance each
pass evicts the buffer cache and pins the shared vCPU, which is why _unrelated_ work shows
multi-second tails: `SELECT name FROM pg_timezone_names`, which touches no user data at all,
averages 512 ms and peaks at 3.4 s. **Fixed 2026-07-26** —
[20260726120000_feed_items_user_created_index.sql](../../supabase/migrations/20260726120000_feed_items_user_created_index.sql).

`get_latest_rate_feed_state` is the largest single statement (837.7 s, 12.42%), but its plan is
already optimal and its floor is **0.8 ms**. It is slow when the instance is thrashing, not
because of anything in the query.

> **Read the numbers here with care.** The statistics window is 136 days and spans several
> deployments. Some of the largest entries — including the `books` ILIKE search — come from code
> that has since been removed. Reset `pg_stat_statements` and re-measure before acting on anything
> not already fixed. See [the census mixes ~136 days](#the-census-mixes-136-days-across-several-deployments).

Full evidence in [census results](#census-results-the-feed-rpc-was-never-the-problem).
The one item independent of all this is the 2087 ms auth token refresh, which is client-side.

Two probe runs, cold (first visit after idle) and warm (immediate reload):

| Stage                             |   Cold |   Warm |
| --------------------------------- | -----: | -----: |
| Document (SSR, Netlify function)  |  334ms |  297ms |
| App JS download                   |  193ms |  223ms |
| Hydration → first request         |   11ms |   27ms |
| **Supabase auth token refresh**   | 2087ms |      — |
| **`GET /api/feed/latest`** (TTFB) | 5567ms | 1922ms |
| Covers → first visible            |  395ms | cached |
| **Total to books on screen**      |  ~8.9s |  ~2.7s |

### Netlify is exonerated

Document TTFB was 334ms cold vs 297ms warm — effectively identical. The SSR document runs on
the same function as `/api/feed/latest` and is the _first_ invocation, so it would have paid any
container init. It didn't.

### Everything Supabase-facing was slow simultaneously

At 2.87s in the cold run, four requests fired at once. Three go browser → Supabase directly and
never touch Netlify:

| Request                        |   Cold |   Warm |
| ------------------------------ | -----: | -----: |
| `user_ratings` (direct)        | 5392ms | 1487ms |
| `user_bookmarks` (direct)      | 3132ms |  444ms |
| `user_not_interested` (direct) | 3131ms |  457ms |
| `/api/feed/latest` (Netlify)   | 5600ms | 1974ms |

`user_bookmarks` and `user_not_interested` are trivial single-column selects and still took 3.1s.
No serverless cold start explains that. They were **starved behind the feed RPC** on free-plan
shared CPU.

## `get_latest_rate_feed_state`: what the confirmation run actually found

Run `confirm-feed-rpc-cost.sql` (below) produced these numbers on production:

| Measurement                                         | Execution | Buffers |
| --------------------------------------------------- | --------: | ------: |
| Block 3 — the real RPC, `select * from …_state(20)` |   93.0 ms |    1337 |
| Block 3b — same logic hand-inlined (today's shape)  |    2.1 ms |     523 |
| Block 4 — `auth.uid()` hoisted, redundant join gone |    9.2 ms |     169 |
| Block 5 — block 4 plus the `::text` cast removed    |    0.9 ms |     169 |

**Read the buffer column, not the milliseconds.** Blocks 4 and 5 produced byte-identical plans
(same cost estimate, same node tree, same 169 buffers); their 9.2 ms vs 0.9 ms is cache warmth and
noise. Buffers are the stable metric at this scale.

### Refuted: the cast is not the problem

`books.book_id`, `feed_items.book_id` and all three `user_*.book_id` columns are **`text`**.
`b.book_id::text` is therefore a no-op the planner elides. Block 3b's plan confirms it directly:

```
->  Index Scan using books_book_id_key on public.books b  (loops=20)
      Index Cond: (b.book_id = fi.book_id)
```

Index scan, not a seq scan. And blocks 4 and 5 — one with the cast, one without — generated
_identical plans_. The cast costs nothing. The earlier "seq scan on a 118k-row catalog" theory is
dead, and so is the `book_id` type-drift concern for these joins.

### Refuted: the plan is not bad

Every access path is already optimal: `feed_items_request_rank_idx` for the lookup and ordering,
`books_book_id_key` for the join, `user_ratings_user_id_book_id_key` and the `book_id` indexes as
index-only anti-joins with `Heap Fetches: 0`. There is no missing index and nothing to reorder.

`min_exec_time` is **0.8 ms**. When this database is healthy, the query is essentially free.

### What is actually expensive

Two things, neither of them the query logic:

1. **Nested non-inlinable functions — 1337 buffers vs 523 for the same work.**
   `get_latest_rate_feed_state` calls `get_eligible_feed_books` laterally, and _neither_ can be
   inlined because both declare `set search_path = public` — a SQL function carrying a `SET`
   clause is never inlined. So each call plans two function bodies separately. On a pooled
   PostgREST connection with a cold plan cache that is real per-call cost, and it is why block 3
   (93 ms) is ~45× block 3b (2.1 ms) for identical output.
2. **Free-tier CPU contention.** `mean 515.5 ms`, `stddev 638.9 ms`, `min 0.8 ms`, `max 7269 ms`.
   A standard deviation larger than the mean, over a query whose floor is sub-millisecond, is the
   signature of queueing and burst-credit throttling — not of a plan problem.

Collapsing the two functions into one is worth doing (block 4's shape drops buffers 523 → 169, and
removing the nested call should take 1337 → ~169, roughly 8×). Dropping `set search_path` would
allow inlining but weakens search-path-injection hardening — a real tradeoff, not a free win.

### Correction: it is 12.42% of database time, not 99.83%

The 99.83% figure came from the Supabase dashboard's `prop_total_time`, which is computed over the
report's own filtered statement subset. Measured against `sum(total_exec_time)` across all of
`pg_stat_statements`, this RPC is **12.42%** of database time — still the single largest statement
at 837.7 seconds, but not the whole picture.

**The other ~87% is unaccounted for.** [`db-time-census.sql`](db-time-census.sql) finds it — run
it block by block before optimising anything here. Read-only apart from one clearly marked
opt-in statement at the end.

| Block | Question                                                            |
| ----- | ------------------------------------------------------------------- |
| 0     | Is the denominator trustworthy? (window, eviction, track mode)      |
| 1     | Top-level vs nested — is the 87% just double-counting?              |
| 2     | Top 25 statements by total time, top-level only                     |
| 3     | Which role is spending it? (app vs GoTrue vs Realtime vs dashboard) |
| 4     | Which subsystem?                                                    |
| 5     | Slowest per call / chattiest / heaviest on I/O and temp spills      |
| 6     | Instance health: cache hit ratio, temp files, connections, waits    |
| 7     | Tables with excessive sequential scans or bloat                     |

**Block 1 may resolve the 99.83% vs 12.42% discrepancy outright.** If
`pg_stat_statements.track = 'all'`, statements run inside functions are recorded separately from
the call that invoked them, so summing every row double-counts and deflates every share. The
dashboard's 99.83% was probably top-level only; my 12.42% summed everything. Block 1b prints the
RPC's share computed both ways side by side.

Blocks 0 and 2 also guard two ways the totals can be meaningless: a `stats_reset` old enough that
the numbers describe ancient behaviour, and `dealloc > 0`, meaning `pg_stat_statements` hit its
entry cap and silently discarded statements.

## Census results: the feed RPC was never the problem

`db-time-census.sql` run on production, 2026-07-26.

**The denominator is clean.** `track = 'top'` (no nested double-counting — block 1 returned a
single row at 100%), `dealloc = 0` (nothing evicted), 2949 of 5000 entries held. The 12.42% figure
is correct and the dashboard's 99.83% was an artefact of its own report filtering. Confirmed by
block 1b: 12.44% computed both ways.

**The database is almost entirely idle.** 6748 seconds of query time across a **136-day** window —
about 50 seconds of database work per day. There is no sustained load here to exhaust burst
credits.

**Yet queries that touch no user data are slow:**

| Statement                               | Calls |  Mean |     Max |
| --------------------------------------- | ----: | ----: | ------: |
| `SELECT name FROM pg_timezone_names`    |   169 | 512ms |  3393ms |
| `pg_available_extensions()` (dashboard) |   730 | 585ms | 11754ms |

Those are pure catalog reads. When they average half a second and peak at 11.7 s, the _instance_
is starved — no query rewrite fixes that.

### What is starving it: two missing indexes

| Table        | Seq scans | Tuples read sequentially | Live rows | Index scans |
| ------------ | --------: | -----------------------: | --------: | ----------: |
| `feed_items` |     8,046 |          **294,129,123** |   111,195 |       2,033 |
| `books`      |     2,815 |          **152,708,997** |   118,097 |     897,285 |

`feed_items` has been read sequentially the equivalent of ~2,600 full-table passes, `books` ~1,300
passes over 108 MB. On a 0.5 GB instance each pass evicts the shared buffers and pins the shared
vCPU, which is why unrelated queries — including the feed RPC and the GoTrue token refresh — show
multi-second tails.

The full statement texts confirm both, exactly:

**1. `feed_items` filtered and sorted on two unindexed columns** — 2190 calls, 192.6 ms mean,
421.7 s total, role `service_role`:

```sql
SELECT book_id, created_at FROM feed_items
WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3
```

`feed_items` indexes are `(id)`, `(request_id)`, `(request_id, rank)` —
[20260327000000_feed_requests_and_items.sql:38](../../supabase/migrations/20260327000000_feed_requests_and_items.sql#L38).
Nothing on `user_id`, nothing on `created_at`. 2190 calls × ~111k rows ≈ 243 M tuples, which is
most of the 294 M recorded. The fix serves the filter, the sort and the projection at once:

```sql
create index concurrently feed_items_user_created_idx
  on public.feed_items (user_id, created_at desc) include (book_id);
```

**2. `books` searched with `ILIKE` — ALREADY FIXED, do not index it** — 898 calls, 331.4 ms mean,
297.6 s total, role `anon`:

```sql
SELECT <15 columns> FROM books
WHERE (book_name ilike $1 OR author ilike $2)
ORDER BY book_name ASC LIMIT $3 OFFSET $4
```

No btree index can serve `ILIKE`, so the obvious response is a pair of `pg_trgm` GIN indexes.
**That would be wasted work.** This query no longer exists: commit `898955b`
("Changed button author search to meilisearch for faster return", 2026-06-28) removed the last
`ILIKE` from the codebase, and it is an ancestor of `HEAD`. Search now goes through the
`book-search` Edge Function ([client.ts](../../src/lib/search/client.ts)) and resolves rows by id.

The statistics window opened 2026-03-12, so this query was live for roughly 108 of its 136 days.
What `pg_stat_statements` shows is residue, not traffic. Adding GIN indexes on 118k text rows
would cost disk and slow every write to `books` in exchange for nothing.

### The census mixes ~136 days across several deployments

This is the methodological catch, and it affects more than the search query. `books.cover_url`
appears in **zero** current source files, yet several top-25 statements select it — so those rows
come from a retired build. Sorting the four rated-library statements by that marker:

| Statement                        | Calls |   Total | `cover_url`? | Status  |
| -------------------------------- | ----: | ------: | ------------ | ------- |
| `user_ratings` + lateral `books` | 5,498 | 268.7 s | yes          | retired |
| `user_ratings` + lateral `books` | 5,329 | 126.5 s | yes          | retired |
| `user_ratings` + lateral `books` | 2,847 | 198.1 s | no           | current |
| `user_ratings` + lateral `books` |   824 | 140.8 s | no           | current |

So "10.9% on duplicate library loads" is really ~5% live and ~5% dead. The same marker retires the
7,638-call `books = ANY(...)` statement while its 4,794-call twin matches
[resolveBooksFromSupabase.ts](../../src/lib/search/resolveBooksFromSupabase.ts).

**Before optimising anything further, reset the counters and re-measure against current code:**

```sql
select pg_stat_statements_reset();
```

Then use the app normally for a few days and re-run blocks 2–4. Statistics only — no data is
touched. Until that happens, treat every total in this document as an upper bound that may belong
partly to code that no longer runs.

### The rated-library loaders are 10.9%, more than I credited

Four near-identical statements load `user_ratings` with a lateral join into `books`, differing only
in which `books` columns they select:

| Calls |     Mean |   Total |
| ----: | -------: | ------: |
| 5,498 |  48.9 ms | 268.7 s |
| 2,847 |  69.6 ms | 198.1 s |
| 5,329 |  23.7 ms | 126.5 s |
|   824 | 170.9 ms | 140.8 s |

**734 s combined — 10.9% of all database time**, second only to the feed RPC. All four are
`where user_id = $1 order by updated_at desc`, which the existing `(user_id, book_id)` unique index
can filter but not sort.

This is the browser trace's "`user_ratings` queried three times per load" showing up in the
database. The ids load and the details load re-fetch the same rows with different column sets. An
index on `(user_id, updated_at desc)` removes the sort, but `user_ratings` holds only 2,915 live
rows — the sort is not the cost, so **measure before adding it**. The real fix is architectural:
fetch once.

### Refuted: Realtime, GoTrue and Storage are not involved

Block 4 puts Realtime at **0.02%**, Storage at 0.01%, GoTrue at 1.45%. The "Realtime is the silent
hog" hypothesis is dead.

### The Supabase dashboard is 24% of all database time

By role: `authenticated` 47.85%, **`postgres` 24.25%**, `anon` 10.45%, `service_role` 9.93%,
`supabase_admin` 3.42%. Nearly a quarter of database time is dashboard introspection —
`pg_available_extensions`, `base_table_info`, `table_privileges`. The Query Performance report
itself is #8 at 173.6 s and is the single largest temp-file producer in the database
(300,364 temp blocks). Investigating this has been a measurable contributor to it.

### Memory pressure is severe

`pg_stat_database` reports **172,235 temp files / 343 GB written** with a 99.99% cache hit ratio.
Work is spilling to disk constantly because `work_mem` is tiny, and the two full-scan patterns
above are the main producers.

Stale statistics compound it: `books` was last auto-analyzed 2026-06-04 (7 weeks before this run),
`feed_items` 2026-07-05.

### Revised priority order

1. **`feed_items (user_id, created_at desc) include (book_id)`** — one index, removes ~243 M of the
   294 M sequential tuple reads. Cheap, safe, no application change. Do this first.
2. **`analyze books; analyze feed_items;`** — seconds to run, and the planner is working from
   7-week-old statistics.
3. **`select pg_stat_statements_reset();`, then re-measure over a few days** — the current window
   spans 136 days and several deployments, so some of the biggest entries belong to retired code.
   Everything below this line should be re-prioritised against clean numbers.
4. ~~The `books` ILIKE search~~ — **nothing to do.** Removed in `898955b` (2026-06-28). Do not add
   trigram indexes for it.
5. **The 2087 ms auth token refresh** — client-side, independent of the database entirely, and
   unaffected by the measurement-window problem.
6. **The duplicate rated-library loads** — ~5% of database time from current code (the other ~5%
   attributed earlier was a retired build), fetching the same rows twice per page load.
7. **Collapse the two feed functions** — 1337 → ~169 buffers, real but modest.
8. Keep the Supabase dashboard closed while measuring; it is 24% of database time.

Re-run `db-time-census.sql` blocks 2 and 7 a day after #1 lands. `seq_tup_read` on `feed_items`
should stop growing; if the multi-second tails on unrelated queries also disappear, the
buffer-thrash theory is confirmed.

## The measurement trap

The `EXPLAIN` runs in `pg_stat_statements` (41ms, 222ms, 829ms) **are not measuring the real
query.** In the SQL editor `auth.uid()` returns NULL — `set role authenticated` does not populate
`request.jwt.claims`. The function opens with `where auth.uid() is not null`, so `latest_any`
returns zero rows and the whole statement short-circuits before doing any work.

To profile it truthfully you have to impersonate a real user — and `set role authenticated`
alone is not impersonation. **[`confirm-feed-rpc-cost.sql`](confirm-feed-rpc-cost.sql) does this
correctly**; run it block by block in the SQL editor. It is read-only: every block that changes
session state wraps itself in `begin … rollback`, and there is no DDL.

The blocks, and what each settles:

| Block | Question                                                     |
| ----- | ------------------------------------------------------------ |
| 1     | Column types, indexes, table sizes, RLS policies             |
| 2     | Did the impersonation actually work? (`auth.uid()` non-null) |
| 3     | True end-to-end cost of the RPC                              |
| 3b    | The same query hand-inlined, so the plan nodes are visible   |
| 4     | A/B: does hoisting `auth.uid()` help?                        |
| 5     | A/B: does dropping the `::text` cast help?                   |
| 6     | Is the remaining gap plan cost or instance contention?       |

**Block 1 can kill the main suspect.** Verified on a scratch Postgres 15: when `books.book_id`
and `feed_items.book_id` are both `text`, the planner elides `b.book_id::text` entirely and uses
`Index Scan using books_book_id_key`. The cast only costs anything if the two columns are
different types. Check that before touching the join.

Block 3 deliberately shows an opaque `Function Scan` and no inner nodes — both functions declare
`set search_path = public`, and a SQL function carrying a `SET` clause can never be inlined by the
planner. That is why block 3b exists; compare blocks 4 and 5 against **3b**, not 3.

## Free plan compounds it

837 seconds of accumulated CPU on one query, on shared burstable compute. Once burst credits are
drawn down, everything on the instance is throttled — which is why three trivial queries and the
GoTrue token refresh all degraded together in the cold trace. Fixing the RPC should lift the
whole page, not just the feed.

The 2087ms auth refresh is a separate, additive cost: `supabase-js` stops its auto-refresh timer
while the tab is hidden, so a backgrounded tab wakes with an expired token and blocks
`markAuthInitReady()` on a refresh round trip ([bootstrap-auth.ts:97](../../src/lib/auth/bootstrap-auth.ts#L97))
before `/rate`'s `onMount` can even start ([rate/+page.svelte:1704](../../src/routes/rate/+page.svelte#L1704)).

## The two halves of the page are parallel, not sequential

Worth knowing when interpreting what you see on screen:

- **Bottom-bar book count** ← the library-ids triple (`user_ratings` / `user_bookmarks` /
  `user_not_interested`), issued straight from the browser.
- **Book cards** ← `/api/feed/latest`, then cover images from Bunny.

Both start the instant `authReady` fires. The perceived gap between "count appears" and "books
appear" is just whichever path loses the race — 0.2s cold, 0.5s warm in the runs above. The
originally-reported 2s second phase was **cover images on a cold CDN edge**; when the covers are
already cached that phase vanishes entirely, which is why one run looked like "only the spinner
was slow".

## The load chain

Strictly serial — nothing starts until the line above finishes:

| #   | Step                                                                       | Code                                                                      |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | Document server-rendered (no `prerender`, `adapter-netlify` → Lambda)      | [hooks.server.ts](../../src/hooks.server.ts)                              |
| 2   | App JS downloads and hydrates                                              | —                                                                         |
| 3   | `getSupabase()` — the client isn't constructed until `onMount`             | [supabase.ts:28](../../src/lib/supabase.ts#L28)                           |
| 4   | `getSession()`; **blocks on a token refresh if expired**                   | [bootstrap-auth.ts:97](../../src/lib/auth/bootstrap-auth.ts#L97)          |
| 5   | `/rate`'s `onMount` unparks from `await waitForAuthReady()`                | [rate/+page.svelte:1704](../../src/routes/rate/+page.svelte#L1704)        |
| 6   | `GET /api/feed/latest` → `get_latest_rate_feed_state` **← the bottleneck** | [api/feed/latest/+server.ts](../../src/routes/api/feed/latest/+server.ts) |
| 7   | Fallback only: `GET /api/books/popular` → `get_eligible_top_100_books`     | [rate/+page.svelte:1421](../../src/routes/rate/+page.svelte#L1421)        |
| 8   | `loadingInitial = false` → cards render → covers fetched from Bunny        | [rate/+page.svelte:1780](../../src/routes/rate/+page.svelte#L1780)        |

Also visible in the trace: `user_ratings` is queried **three times per load** (5392 / 721 / 1028ms
cold). The first is the ids load, the second the details load, the third appears to be a duplicate
details load — `scheduleUserLibraryDetailsLoad` is invoked from both the layout and
`scheduleLibraryHydrationAfterFirstList`.

## Running the probe

Use production. vite dev has no Lambda, a different bundle, and an always-warm server — it cannot
reproduce this.

1. Navigate to `/rate` on a browser that's been idle. Wait for books. **Don't reload.**
2. DevTools → Console, paste all of `feed-cold-load-probe.js` (Chrome makes you type
   `allow pasting` once), press Enter.
3. Run:

```bash
feedProbe.report()
```

Resource Timing is recorded automatically, so pasting _after_ the load still captures it.
`feedProbe.copy()` puts the run on the clipboard as JSON — **save it before reloading**, a reload
destroys the timeline and it is not recoverable client-side.

Then reload and run `feedProbe.report()` again for the warm baseline, and diff the stage tables.

Keep DevTools' "Disable cache" **off** — it fabricates a colder load than real users get.

## Isolation commands

- `feedProbe.session()` — is the stored access token expired right now, and will the next load
  block on a refresh?
- `feedProbe.expire()` / `feedProbe.restore()` — force the expired-token path against an otherwise
  warm stack, to price the refresh alone. Backs the session up first; refuses to run without a
  refresh token.
- `feedProbe.probeApi()` — time `/api/feed/latest` from an already-hydrated page (no bundle, no
  bootstrap, warm DNS). Run twice back to back. A 401 is still a valid timing sample.
- `feedProbe.watch()` — live fetch + DOM-milestone capture for a client-side navigation into
  `/rate`. Cannot survive a reload.

## Reading the report

- **stage breakdown** — one row per link in the chain above.
- **app requests (waterfall)** — every auth/DB/API call with an ASCII gantt. `ttfb` is server think
  time; `ttfb ≈ dur` means the time is server-side, not transfer. Supabase and Bunny don't send
  `Timing-Allow-Origin`, so their sub-phases show as `—`, but `dur` is accurate.
- **main-thread / boot gaps** — windows with no app request in flight. A big gap means the time
  went to JS, not the network.
- **verdict** — contributors ranked by milliseconds.

FCP/LCP/long-task come back empty for tabs that were never foregrounded; that's a browser
recording rule, not a fast load.

## Caveats

- The Resource Timing buffer holds ~250 entries. The critical path is at the front so it survives,
  but scrolling a lot before running `report()` can push later covers out.
- Firefox omits memory-cached images from Resource Timing, so a warm run can legitimately report
  0 cover requests.
- Conclusions above rest on one cold sample plus one warm sample. Re-run after another idle period
  before acting on the margins — though the 99.83% figure comes from 1625 production calls and
  needs no further confirmation.
- These files are diagnostics only. Nothing here is imported by the app.
