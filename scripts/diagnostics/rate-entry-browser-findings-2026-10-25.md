# First real-browser result and follow-up inspection

The user supplied a report captured at 2026-10-25T13:41:33.738Z from `http://localhost:5173`. Although its label was `before / normal / 1`, the endpoint's `feed_bootstrap` timing identifies the updated unified-RPC implementation. Labels annotate a measurement; they do not switch application versions.

| Observation                                                                                     | Interpretation                                                                                                                              |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 50 cards first visible at 196 ms                                                                | Real development-browser warm entry displayed available books quickly.                                                                      |
| Latest feed read started 93.360 seconds before the click and completed 90.879 seconds before it | This was a recent prepared/reusable-feed case; the API was not on the entry's critical path.                                                |
| That earlier read took 2481 ms, including 2418 ms bootstrap / 2419.7 ms handler total           | A slow prior backend response was reused later; these milliseconds are not the click's loading duration.                                    |
| Zero completed post-click feed requests and no completed requests during the entry              | Consistent with reuse of the recent prepared result. The probe reports completed Resource Timing entries, not pending requests.             |
| No skeleton before/after cards and no initial-card removal                                      | This capture observed no skeleton flash or whole-list replacement.                                                                          |
| `usableRatingMs: null` after 8.934 seconds                                                      | The visible enabled-control condition was not observed. This does not establish whether the controls were disabled or outside the viewport. |

Do not calculate a real before/after speedup from this result alone. The 196-ms figure measures visible cards; the historical HAR durations measured HTTP requests. Original-production click measurements and a timed action-enabled observation remain necessary.

## Rating-control diagnosis

The updated [browser probe](rate-entry-browser-probe.js) adds `rateEntryProbe.inspect()`, which can run on the current `/rate` without redoing navigation. It reports the viewport, total/enabled rating control counts, and the first control's enabled state, visibility and vertical bounds. It reads only DOM state and does not inspect authentication or personalized storage.

New timed reports include `ratingEnabledMs` separately from `usableRatingMs` and embed `controlsAtReport`. A control can be enabled while below the viewport, especially after docking DevTools. If controls are disabled, the next check is the relevant library/auth readiness and visible load/retry notice. The probe does not change those existing guards.

The user's subsequent inspection confirmed 50 cards and all 250 rating controls enabled. The viewport was 1782 × 483 pixels, while the first control spanned y=622.3–658.3: it was below the viewport. This explains the missing visible-action timing in this case; it does not show an action-readiness failure. The later inspection cannot establish exactly when the controls first became enabled during the earlier timed entry.

Five focused production-preview browser cases passed, including one where controls are enabled but moved outside the viewport and one where missing dismissal IDs correctly disable controls. Type checking reported zero errors/warnings; changed-file lint/format checks passed.

## Auth-lock message

This section records the original pre-upgrade investigation. The later SDK upgrade and forced dependency optimization resolved the reported symptom, as confirmed by the user. See the [current auth record](rate-entry-auth-sdk-upgrade.md).

The stack was the then-installed `@supabase/auth-js` 2.99.1 `_autoRefreshTokenTick()` path. That method calls `_acquireLock(0, ...)`: a nonblocking background attempt. `navigatorLock` throws a `NavigatorLockAcquireTimeoutError` when an exclusive lock is already held, and the tick catches acquire-timeout errors and skips that attempt. This differs from evidence that an interactive session operation waited indefinitely or failed.

The application uses one lazily constructed client per module. The stack alone does not identify which operation held the lock, prove a duplicate client, or connect the message to the missing action timing. The browser probe never constructs a client or acquires auth locks.

An isolated check used the installed SDK browser bundle with a synthetic HTTPS origin, a native Web Lock holder and a manual background refresh tick. Chromium 145.0.7632.6 and Firefox 146.0.1 both skipped contention, allowed a subsequent session read after release, and recorded no page error, unhandled rejection or external request. This is a narrow reproduction of the expected contention path, not a reproduction of the user's Firefox 158 environment/session.

No SDK upgrade, custom lock override, disabled locking, auth-storage reset or global error suppression was applied in that initial investigation. Its isolated checks did not resolve the user's report; the subsequent upgrade and user confirmation are documented separately.

The unused font-preload messages came from the original global hints in `src/app.html`. They indicated fonts were not used promptly on that page, not an auth-lock or feed-RPC failure. The later [route-specific preload cleanup](font-preload-validation.md) is implemented and validated; this initial investigation preceded it.

## Fade design review

`git show a044434` identifies commit `a0444348845ae6a9f94f58f0c1f4e2966b5d821a`, **Soft transitions**, dated 2026-05-25. It deliberately introduced the main-navigation route wrapper, a 150-ms `cubicOut` fade, `/rate` in `MAIN_NAV_PATHS`, and reduced-motion handling.

The fade is a visual transition, not a fixed data-loading sleep. It overlaps route initialization/network work and cannot explain a three-second skeleton. On a cache hit, already mounted content can initially be transparent; disabling it was a visual tradeoff to improve first-visible-card timing. The local acceptance samples showing 74–149 ms used the `/rate` duration override of zero.

On 2026-10-25 the user confirmed the fade was intentional and requested restoration. The original 150-ms `cubicOut` fade is restored, with the existing navigation/reduced-motion conditions unchanged. This corrects an unintended visual tradeoff in the loading work; RPC, controller, snapshots and prefetch remain in place. Animation duration should not be mechanically subtracted from network timings, nor should the zero-fade timing samples be presented as measurements with the fade restored.

The [UI/UX audit](rate-entry-ui-ux-audit.md) records the remaining behavior changes and the preserved controls, styling, search and pagination rules.
