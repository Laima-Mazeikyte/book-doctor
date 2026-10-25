# Rate-entry status — 2026-10-25

The application changes are implemented and ready for developer testing. Steps 1–5 are complete in development, and restored-UI behavior passed validation. Step 6's strict under-200-ms timing target remains open: the follow-up run with the intentional 150-ms fade measured 153–420 ms across 15 samples. Production still uses its existing application flow against the same database.

Start with the [developer testing handoff](rate-entry-developer-handoff.md) for setup, commands, and expected results. Supabase latency investigation, migration-history reconciliation, production deployment, and deployed measurements remain explicitly deferred.

| Work                           | Current status and practical effect                                                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unified RPC                    | Installed and verified on the shared database. Development uses one RPC; production retains its existing six-call implementation. Do not replay the installation for local testing. |
| Shared feed controller         | Current-account reads are shared. Refresh stages a future list without replacing mounted cards.                                                                                     |
| Complete interaction snapshots | Complete ratings, bookmarks, dismissals, mappings, and pending overlays support actions during revalidation.                                                                        |
| Persistent feed snapshots      | Validated candidates persist for up to 24 hours and 100 books, with known/pending exclusions applied before admission.                                                              |
| Landing-page preparation       | Existing sessions prepare one shared read, which `/rate` reuses or joins. Signed-out/maintenance visits skip it; preparation never creates generation jobs.                         |
| Shared-read deadline           | A configurable 10-second deadline covers the response and body, releases stalled reads, preserves cached cards, and permits retry.                                                  |
| Intentional UI behavior        | The original 150-ms fade is restored. Normal saves show no dots or saving labels; counts follow local changes without acknowledgment-driven shifts. Failure recovery remains.       |
| Book detail                    | Dismissed covers use 30% opacity. Unknown state does not delay the cover. The rating removal action reads “Remove.”                                                                 |
| Auth SDK                       | The dependency and lockfile resolve to 2.118.0. The user confirmed the auth-lock error is gone. Explicit `db.retry: false` preserves application-owned database retry behavior.     |
| Fonts                          | Route-specific preloads are implemented and validated; typography and display policies are preserved. Conditional unused-preload warnings remain possible.                          |
| Performance acceptance         | Restored-UI behavior passed. Strict under-200-ms timing acceptance did not pass every sample and remains open.                                                                      |

## Performance evidence and limits

The original controlled production-build run reached usable actions in **74–149 ms**, but temporarily used zero fade. Those results do not measure the restored UI. The subsequent restored-fade run measured **153–420 ms** and failed all three strict timing scenarios because some samples exceeded 200 ms. Each scenario still made one feed read across five visits and zero generation writes. See the [UI/UX audit](rate-entry-ui-ux-audit.md) and [historical completion record](rate-entry-completion-validation.md).

One real development-browser entry displayed 50 cards in **196 ms**, reusing a feed read completed about 91 seconds earlier. Later inspection found all 250 rating controls enabled, with the first row below the 483-pixel viewport. That explains the missing visible-action observation without establishing its exact enablement time. See the [browser findings](rate-entry-browser-findings-2026-10-25.md). Neither this capture nor the controlled timing runs establish a measured production speedup.

Three direct-entry fixture checks with both application snapshots absent confirm that a slow feed delays cards, slow library reads delay actions, and the reads overlap. A true cache miss still depends on the live network/backend; there is no fixed three-second render sleep. These are dependency checks, not real cold Supabase latency estimates. See the [cold-path review](rate-entry-cold-path-review.md).

## Resolved integration issues

The pagination error now reads **“Couldn’t load more books. Try again.”** Initial popular-feed loading keeps its existing message. Public pagination also distinguishes failure from genuine exhaustion, so Load more remains available after a failed request or dismissal of its error banner. Successful retry appends books without replacing existing cards.

The shared-read deadline covers body consumption and settles cancellation even when a transport ignores abort. Late responses cannot publish over newer work. Timeout retains valid caches and mounted cards; a cache miss can reach the ordinary Top 100 fallback. This bounds browser recovery rather than explaining the upstream spike.

The auth investigation found that an already running localhost Vite server was serving **2.99.1** despite the installed **2.118.0** dependency. Forced dependency optimization was advised, and the user subsequently confirmed: **“The auth error is now gone.”** The old SDK's exact exception-escape mechanism remains unproven and is not an open integration task. Earlier isolated Firefox checks did not record the served SDK version and cannot be counted as upgrade confirmation. See the [auth record](rate-entry-auth-sdk-upgrade.md).

The [quiet-save correction](rate-entry-quiet-saves.md) preserves durable writes and waits for saves internally before recommendation generation. The [font cleanup](font-preload-validation.md) reduces unnecessary downloads while preserving font files, definitions, weights, and display policies. A font used somewhere in the app need not be displayed on every visit.

## Validation and deferred work

The latest pre-handoff review passed **719 Node tests across 97 files**, **125 browser component tests across 20 files**, type checking with zero errors/warnings, changed-file lint/format checks, and whitespace checks. Earlier focused runs passed **28 development-browser cases** and **29 production-preview behavior cases**; the three strict timing scenarios were excluded from that functional regression. Browser suites were not rerun during the handoff review. Historical step-specific counts remain in their linked validation records.

Two work areas remain explicitly deferred:

- **Supabase upstream latency:** simultaneous feed and library requests slowed in the supplied HAR. The exact pool/connection/CPU/I/O cause is unproven. Cache hits bypass the wait for first display; misses and refreshes still depend on it. Correlate slow request intervals with upstream/database metrics before choosing infrastructure or query changes.
- **Deployment preparation and measurements:** reconcile the manually applied migration so automation does not replay `CREATE FUNCTION`, repeat installed-RPC verification, and check the future build/runtime's Node version before deployment. Keep the existing feed helpers throughout the development/production overlap. Do not apply a fresh baseline to the shared live database for this feature. Deployed latency distributions and real-user cache-hit rates remain unmeasured.

Missing, expired, partial, or unusable caches retain ordinary loading and readiness guards. Background read-only refresh failures stay silent; cold personalized-feed failure may use the existing Top 100 fallback. A dedicated refresh retry UI remains optional and has not been added. The [six-step plan](../../RATE_ENTRY_PLAN.md) retains the original performance target and distinguishes these policies from unresolved acceptance.
