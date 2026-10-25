# Comparing rate-entry speed in a real browser

Prepared on 2026-10-25. The application optimizations are implemented; this procedure collects real-account click-to-card/action measurements, which the earlier XHR captures did not contain. It does not investigate the Supabase spike or change the database.

For direct document entry with no application snapshots, use the [cold-path review and procedure](rate-entry-cold-path-review.md). The click-armed probe below covers client navigation from the landing page and does not persist across a full reload.

The original 150-ms fade was restored on 2026-10-25. The 74–149-ms samples below predate that restoration and used zero fade; they must not be presented as current measurements of the restored UI. The restored build passed 26 behavioral cases, but a separate timing rerun measured 153–420 ms and did not consistently meet the unchanged under-200-ms target. See the [UI/UX audit](rate-entry-ui-ux-audit.md).

## Evidence already available

| Boundary                                                              | Before                                                          | After                                                                       | What the comparison establishes                                                                                                                                                |
| --------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Upstream calls per latest-feed API request                            | Five parallel metadata/count reads, then a books RPC: six total | One bootstrap RPC                                                           | Five fewer upstream calls and elimination of the second serial round trip. Not an 83% latency claim.                                                                           |
| Actual feed API HTTP duration                                         | Warm: 506–862 ms; one slow sample: 3566 ms                      | Two distinct observations after RPC integration: 1776 ms fresh, 467 ms warm | Improved observed durations, with different upstream/auth conditions and too few samples for causal attribution or tail estimates.                                             |
| Installed-RPC SQL comparison at limit 50                              | 8.542 / 8.543 ms                                                | 5.292 / 5.225 ms                                                            | About 3.3 ms less database work in these paired read-only checks. Most of the original seconds were outside SQL execution.                                                     |
| Controlled click-to-card wait with a three-second feed response       | 3188 ms in the original fixture                                 | Final cached-entry samples: 81–149 ms with the refresh pending              | Available local content removes the network wait from first display. Historical fixtures are separate runs, not a matched real-user before/after measurement.                  |
| Historical zero-fade production-build click-to-enabled-rating control | No matching historical action measurement                       | 74–149 ms across 15 samples before fade restoration                         | The under-200-ms target passed for that zero-fade build with ready session, route code and complete interaction snapshots. Excludes cover completion and deployed performance. |

The six-to-one change reduces round trips. The shared controller deduplicates concurrent reads and reuses recent preparations. Feed snapshots supply books immediately; complete interaction snapshots make the relevant actions safe before revalidation finishes. Landing preparation moves the read ahead of the click. These mechanisms overlap, so their savings cannot be added together or assigned exact individual millisecond values from the existing captures.

For a cache miss, landing preparation hides up to the time spent preparing before the click; any remaining wait still depends on the actual response. Cache hits can bypass that wait entirely. The restored entry fade overlaps initialization; it is a visual transition, not a data-loading delay. Earlier fade-enabled samples reached 254 ms; the later historical zero-fade samples reached at most 149 ms. These separate runs do not isolate an exact animation cost. The ten-second shared-read timeout improves stall recovery and does not accelerate successful requests.

## Setup

Use the same browser/profile, account, viewport, network, and DevTools configuration for comparisons. The account should already have interactions and a completed eligible feed; otherwise a generation/Top 100 flow is a different case. Note any token refresh separately. Use a test account if making optional rating changes; the speed checks themselves do not need writes.

The old production app remains the real-world baseline. Test the updated app using a production build/preview for timing, since development compilation can dominate first navigation. Local versus deployed results include different hosting/network paths, so they are useful UX observations rather than a controlled estimate of the RPC's savings.

```powershell
pnpm run build
pnpm exec vite preview --host 127.0.0.1 --port 4174 --strictPort
```

Sign in once at `http://127.0.0.1:4174`; browser storage/session are separate from port 5173 and the deployed site. Visit `/rate` once and allow the feed/library requests and pending saves to settle, then use the home link. Keep browser HTTP cache enabled, use no throttling for the baseline, and enable Network log preservation. Keep the tested tab foregrounded. Hover Start rating for about one second before each timed click to standardize route-code readiness.

Open [rate-entry-browser-probe.js](rate-entry-browser-probe.js), copy the whole file into the landing-page Console, and run:

```js
rateEntryProbe.arm('after / normal / 1');
```

Click **Start rating**. Leave the list untouched until the feed request settles, or about five seconds after the cards appear; then run:

```js
rateEntryProbe.report();
await rateEntryProbe.copy();
```

The probe captures the actual click, first visible card, enabled visible rating control, skeleton reappearance, initial-card removal, completed feed requests and available Server-Timing. It sends no requests, changes no storage/authentication, and exports no headers, tokens, book titles or IDs. The first render-frame observation is not a pixel-level paint trace; cover download completion is measured separately by observation/Network.

The probe survives client navigation but a full reload removes it. After a reload, paste it again. For another client-side visit, return home and call `arm` with a new label. Reporting stops observation; call it after the background read has had time to finish, within the 20-second observation window. The Network panel is still needed for pending or blocked requests, which may be absent from Resource Timing.

## Test sequence

### 1. Normal return: real-world before/after

On **old production and updated preview**, start from the landing page with the existing session restored. Arm the probe, hover Start rating for one second, click, and collect the report after refresh. Repeat five times per app, returning through the home link rather than reloading between repetitions. Label reports `before / normal / 1` through `5`, and `after / normal / 1` through `5`.

Compare the median and slowest click-to-card/action results, and compare API durations separately. The updated app should use its prepared/reusable content; a second feed read on every same-account revisit within five minutes would warrant investigation. Each browser latest-feed request is one endpoint request in both versions; the old six Supabase calls occur inside the server and are not six browser XHRs.

### 2. Persisted feed: a new document with the API blocked

After priming the updated app, block only URLs matching `/api/feed/latest` in the browser's Network tools. Leave auth, static files and library endpoints available. Fully reload the landing page to discard the controller's in-memory preparation, paste the probe again, then arm/click/report. This isolates persisted feed restoration from an already completed in-memory feed read.

Expected: existing cached personalized cards and enabled actions appear without waiting for the blocked feed endpoint. The list should not return to skeletons or lose its mounted cards. If auth/required interaction snapshots are unavailable, record that condition rather than classifying the run as a valid cache hit. Unblock the URL immediately after this case. One or two repetitions are sufficient for this functional check.

### 3. Landing preparation without a persisted feed

In the updated app's browser storage, remove only this account's key beginning `book-doctor:rate-feed:v1:`. Keep the library snapshots, auth session, and pending-save journal. Fully reload the landing page so a warm controller cannot supply the removed snapshot.

Watch Network: `/api/feed/latest` should begin while still on the landing page. Wait until it completes, then paste/arm the probe and click. Expected: ready books/actions and **zero new latest-feed requests after the click**. A newly persisted snapshot appearing after that landing read is expected. Repeat three times, resetting the feed snapshot before each new document if testing this condition repeatedly.

### 4. No usable snapshots: the honest network-dependent case

After pending saves settle, remove only this account's disposable `book-doctor:rate-feed:v1:...` and `book-doctor:library-cache:v1:...` / `v2:...` keys. Keep `sb-...-auth-token` and every `book-doctor:library-pending:...` key. Fully reload the landing page, paste/arm the probe, and click as soon as practical; the report's negative request start time shows how much prefetch head start occurred.

Expected: this case may wait for live feed/library reads, and actions remain guarded until their required collections arrive. Record it separately from cache-hit results. Never interpret deleting snapshots as disabling the RPC/controller/prefetch code: this is a cache-miss measurement of the optimized application, not a rollback to the old implementation. One or two runs help identify remaining unavoidable waits.

### 5. Return after idle

With the updated app primed, stay on the landing page for about five minutes with the tab foregrounded. Arm/click/report. Note whether an auth refresh occurs. Expected: a usable persisted feed keeps a slower fresh feed request off first-card display. Compare with an idle old-production run if practical; a single idle sample does not establish an upstream latency distribution.

## Return these results

Start with the ten JSON reports from **Test 1** and one report each from **Tests 2 and 3**. Include the browser name, which URL/build was tested, whether the expected eligible feed was available, and whether covers appeared noticeably later than the titles/actions. Tests 4 and 5 are useful follow-ups after the core comparison.

The important fields are `firstCardMs`, `usableRatingMs`, `skeletonReturnedAfterCards`, `initialCardRemoved`, and the before-/after-click feed request timings. A negative request start means it began on the landing page before the click. Zero **completed** post-click requests alone does not prove no request was made; check Network for anything still pending/blocked.

If `usableRatingMs` is null, paste the current probe and call `rateEntryProbe.inspect()` on `/rate`; no new navigation is needed for this inspection. The result reports enabled-control counts and the first control's visibility/viewport position. An enabled control below the viewport is different from a disabled control awaiting authentication/library readiness. New reports also retain `ratingEnabledMs` separately from visible-control timing and include `controlsAtReport`. Keep the viewport fixed while measuring; docking DevTools can move the rating row below the fold.

Labels are annotations, not version switches. A report from the development app with `feed_bootstrap` timings belongs to the updated implementation even if labeled `before`. Use deployed old production for the historical-app comparison.

Do not clear all site data to reset a case: that changes authentication and can discard pending saves. The reset procedure intentionally names only disposable snapshot keys. Avoid resetting caches in other open tabs during a trial, as their storage events/revalidation would add another variable.

We will report real click latency, action readiness, API latency and cover loading separately. These results can validate the visible improvement and reveal any remaining first-use delays without reopening the deferred infrastructure investigation.

The probe is covered by five focused production-preview browser checks: cached entry during a pending refresh, completed landing preparation, a delayed post-click read with visible skeletons, enabled controls below the viewport, and disabled controls awaiting required interaction data. These exercise timing, request placement, control diagnosis and stable-card reporting. They do not replace the real-account comparisons requested above.
