# Quiet library saves — 2026-10-25

The user requested that normal rating, bookmark and dismissal actions save without dots, saving labels, or save-dependent movement in the recommendation control/library counter. This follow-up implements that presentation policy while retaining durable saves and failure recovery.

## Cause and changes

The existing save flow rendered a `LibrarySaveIndicator` for pending, saving, retrying and failed changes. This inserted dots beside card/summary actions. The rate-page recommendation label, hint and CTA visibility also depended on whether the queue was empty. While work was queued, displayed recommendation progress could be capped at nine ratings or fall back to the last confirmed count. A successful save then changed those controls again. The earlier markup/style audit did not describe these transient interaction states adequately; the indicators and queue-driven presentation were already present in the baseline save UI.

- `LibrarySaveIndicator` now renders only for an actual failed save. Pending work and automatic retries add no dot or label beside stars, bookmarks or dismissals, including summary sheets.
- The ratings drawer no longer adds a routine syncing status. Its failed-save retry remains available.
- Rate-page counts and recommendation progress follow the local library state. Crossing the tenth rating reveals the normal recommendation button immediately, including while the rating is still being saved. Queue acknowledgments do not clamp or restore a different display count.
- The recommendation button and sub-threshold hint keep their normal wording during background saving. Queue-driven icons, classes and busy state have been removed. Failed saves retain the normal button label and block submission through its existing accessible unavailable state; the separate failure notice provides Retry.
- The shortlist's “Get new recommendations” overlay also keeps its normal label while background work is pending. Its submission path waits for saves internally.

The save journal, optimistic changes, request ordering, retry budget and protection against older reads are preserved. `createRecommendationSubmission.submit()` still flushes the queue before creating a recommendation request, refuses generation after save failure or incomplete library state, and guards duplicate submissions/account changes. Explicit recommendation generation retains its existing starting/busy feedback. Initial authentication/library-loading indicators remain distinct from routine background saves. The restored navigation fade is preserved.

## Validation

- 31 Node tests passed across the save queue and recommendation submission.
- 42 browser component cases passed across cards, summary sheets, shortlist details and rate-feed scheduling.
- All 18 library load/save browser cases passed, including three added quiet-save cases. Desktop (1280 px) and mobile (390 px) checks hold rating/bookmark/dismissal writes, verify the absence of pending indicators/saving copy, open the drawer, and compare CTA/counter/star geometry before and after acknowledgment. All measured positions/sizes remain within one pixel.
- The tenth-rating case confirms the normal CTA is available while the write is held, and that clicking it creates no recommendation request until saving completes.
- All four recommendation-submission browser cases passed after updating their older HTTP fixtures to include exact collection counts required by the complete-library loader. This fixture correction does not relax application readiness.
- Production build, Svelte/TypeScript checking (zero errors/warnings), changed-code lint and formatting passed.

Only synthetic browser fixtures were written during tests. No live database writes, SDK upgrade, auth-storage reset or deployment was performed.

## Repeated auth-lock report

This section records the historical pre-upgrade investigation. The SDK was subsequently upgraded to 2.118.0, a stale Vite dependency was identified, and the user confirmed the error is gone. See the [auth record](rate-entry-auth-sdk-upgrade.md) for the current result.

At this stage, the user's log still showed the localhost auth-lock error. Its stack followed the old SDK's nonblocking background refresh lock path. The additional CSP, performance-entry, fingerprinting and WebGL messages referenced ChatGPT/OpenAI pages; they did not establish a book-app CSP or rendering failure.

An additional isolated check used the locally installed Firefox **158.0.1**, a fresh temporary profile and the installed Supabase SDK **2.99.1**. It exercised valid-session restoration, expired-session refresh, a native exclusive lock held during a background tick, and a subsequent session read after release. The browser exposed zero unhandled rejections, both session reads succeeded, the expired fixture performed one refresh, and no lock failure appeared in captured stderr.

The same cases also passed using the user's dev server's actual Vite-transformed SDK module rather than its UMD bundle. Network responses were synthetic; the user's browser profile, auth storage, extensions and open tabs were not accessed. The temporary profiles were removed afterward.

Those isolated checks did not reproduce or resolve the error in the user's actual session, and the Vite-transformed check did not record the served SDK version. They did not justify weakening locking or changing the save queue. The later upgrade and user confirmation are recorded separately; upstream latency remains deferred in the [cold-path review](rate-entry-cold-path-review.md).
