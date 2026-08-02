# Why the first `/rate` load after idle is slow

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
