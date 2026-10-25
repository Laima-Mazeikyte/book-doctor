# Rate-entry UI/UX audit — 2026-10-25

Subsequent same-day follow-up: the user identified unwanted save-state dots, queue-driven labels and shifting controls during normal actions. Those existing transient states were not sufficiently covered by the markup/style comparison below. The [quiet-save correction](rate-entry-quiet-saves.md) now removes routine save feedback, keeps local counts/labels stable and preserves failure recovery. Statements below about matching baseline markup describe the earlier fade-restoration audit, before this explicitly requested UI change.

The user confirmed that the navigation fade was intentional. `/rate` now uses the original 150-ms `cubicOut` fade again, with the existing route selection and reduced-motion handling. Removing that fade was an unintended visual change made during performance validation; restoring it keeps the RPC, shared controller, snapshots and landing preparation.

## Scope and evidence

Reviewed the complete working-tree application diff against `HEAD`, including the layout, landing and rate pages, library loaders/stores, copy, shared controller and persistence. After restoration, the rate page's markup and CSS and the root layout's markup and CSS match `HEAD` exactly. The landing page adds a preparation component that renders no DOM; its existing design and CSS are unchanged. Script changes can still affect what is shown and when, so they are listed below.

No other removed visual treatment or control was found in this diff. This is a source/behavior review, not a claim that every route and device received a visual comparison.

## Behavior changes retained

| Area                       | Before → current behavior                                                                                                  | User-visible consequence                                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Returning-user entry       | Wait for fresh feed reads → admit a validated cached/prepared list when complete interaction IDs are available             | Fewer skeletons; actions can become available during library revalidation. Missing/unusable snapshots retain ordinary loading.                                                                                                 |
| Background refresh         | Page-local reads → shared reads that stage the next list                                                                   | Mounted cards, order and scroll stay stable. Updated suggestions/exclusions from elsewhere can wait until a later entry. Failed/empty background refreshes leave visible books in place and add no banner.                     |
| Library restoration        | Compact rated-book cache → complete ratings, bookmark and dismissal snapshots, with pending-save overlays                  | More counts/selected states can appear immediately. Existing action guards remain; recommendations still require the existing live synchronization/save checks. Incomplete API results no longer establish a complete library. |
| Landing preparation        | Feed read begins on entry → existing sessions may start the same read on the landing page                                  | A click can reuse or join that read. No new spinner, banner, session creation or generation job is added by preparation.                                                                                                       |
| Pagination data            | Existing request/poll path → check live state and append unseen eligible books already available before creating more work | Existing cards stay mounted; a failed live-state check uses the pagination error/retry path instead of generating from a cached pointer.                                                                                       |
| Remote eligibility changes | Automatic pagination could replace a curated list with Top 100 → preserve the current curated grid and pause pagination    | Avoids a surprise grid replacement. Explicit local actions that cross the interaction threshold retain their existing reset behavior.                                                                                          |
| Pagination error copy      | Initial-load wording used while books were visible → “Couldn’t load more books. Try again.”                                | A precise error for loading additional books; initial-load copy is unchanged. This is the only added product-copy entry.                                                                                                       |
| Public pagination retry    | A failed request looked like the genuine end of Top 100 → failure is tracked separately                                    | The existing Load more control remains usable after failure, including after dismissing the banner. Genuine exhaustion retains the existing hint.                                                                              |
| Stalled feed read          | Shared read could remain pending → configurable 10-second deadline                                                         | Valid visible caches survive; a cache miss can reach the existing Top 100 fallback. A later read can retry. This deadline does not cover all authentication or library operations.                                             |
| Account changes            | Page work could finish for an old owner → cancel/ignore old-owner work and reset owner-specific state                      | Another account's cards/search results cannot carry over. Lazy anonymous sign-in preserves an already displayed public list and undo behavior.                                                                                 |

## Purposeful behavior preserved

- Original route fade, easing, navigation conditions and reduced-motion support.
- Book-card design, cover priorities, summaries, rating/bookmark/dismiss controls, and undo interactions.
- Search overlay design, keyboard/focus handling, scroll restoration and search-session refresh behavior within the same account.
- Header/bottom-bar behavior, recommendation CTA and its synchronization guards, existing notices and loading components.
- Automatic pagination's two-second dwell, browsing-progress credit, cooldown and manual Load more control. Cached curated batches start a new dwell period; old browsing credit is not persisted.
- Public Top 100 fallback and the existing interaction threshold. Cache admission does not create a personalized generation job.

The new library-loader diagnostic exceptions are internal state; the unchanged `LibraryLoadNotice` uses the existing localized load/refresh/retry wording rather than rendering those raw exception strings. That audit preceded the separately approved [font-preload cleanup](font-preload-validation.md) and [book-detail cover treatment](rate-entry-auth-sdk-upgrade.md). The current changes preserve font definitions/display policies and the restored navigation fade.

## Measurement correction

The previous 74–149-ms figures describe the historical zero-fade build. They remain recorded with that condition and are not measurements of this restored UI. The under-200-ms timing assertions have not been relaxed to accommodate the fade. The fade overlaps initialization, so neither adding nor subtracting exactly 150 ms gives a valid comparison.

The user's null visible-rating timing is explained by the subsequent inspection: all 250 controls were enabled, but the first row was at y=622.3–658.3 in a viewport only 483 pixels high. That inspection establishes current enablement, not the precise enablement time during the earlier entry. The browser probe now records enabled and visible-action timing separately.

## Follow-up validation

- Production build passed. Svelte/TypeScript checking reported zero errors/warnings; changed-code lint and formatting passed.
- All 26 behavioral production-preview cases passed with the restored fade: 21 feed/cache/landing cases in the full invocation and all five probe cases in the focused rerun.
- Four probe cases initially ended observation at DOM presence while the intentional fade still had opacity zero. They now wait for an actually visible card, with no fixed animation sleep or application change. The five-case rerun passed.
- The full invocation also ran type checking concurrently, so its timing samples are not used for the follow-up table. Timing was rerun after build/type/lint work finished. All three strict timing cases still failed the unchanged under-200-ms-every-sample assertion.

| Scenario                      | First visible card, ms | Enabled visible rating, ms | Median rating, ms | Samples below 200 ms |
| ----------------------------- | ---------------------: | -------------------------: | ----------------: | -------------------: |
| Disk cache, refresh pending   |            169.5–236.2 |                169.5–236.3 |             180.3 |                  4/5 |
| Completed landing preparation |            152.9–420.1 |                152.9–420.1 |             258.6 |                  2/5 |
| Warm navigation               |            209.6–391.1 |                209.7–391.2 |             217.3 |                  0/5 |

Each scenario still used one feed read and zero generation writes. DOM arrival ranged from 118.3 to 340.5 ms, so the visible timings cannot be attributed solely to the animation. These are small local fixture samples, not a matched estimate of the fade's cost or a real-user percentile. They measure first positive opacity, not completion of the full fade. Rounded samples are in [the restored-fade timing record](rate-entry-restored-fade-timings-2026-10-25.json).

The restored visual behavior is verified. Consistently meeting the strict under-200-ms visible-action target remains open; the benchmark was not weakened or the fade removed again to report success.

See the [browser findings](rate-entry-browser-findings-2026-10-25.md) and [browser procedure](rate-entry-browser-validation.md) for measurement boundaries. The later [auth upgrade record](rate-entry-auth-sdk-upgrade.md) documents resolution of the reported auth-lock error.
