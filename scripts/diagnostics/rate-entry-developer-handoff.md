# Rate-entry developer testing handoff

The application changes are ready for developer testing. The intentional 150-ms navigation fade is preserved. The strict under-200-ms cache-hit timing target remains open: the recorded restored-fade run measured 153–420 ms across 15 samples. Functional validation and timing acceptance are separate results.

## Setup

Run commands from `book-doctor` using **Node 22.12 or later** and **pnpm 9.15.9**. Local validation used Node 24.15.0. Configure `.env` from `.env.example`; the server needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Any `PUBLIC_SUPABASE_*` browser values must refer to the same project.

```powershell
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm dev --force
```

Stop any existing dev server normally before starting the command above, then fully reload the browser. Forced dependency optimization avoids serving the old Supabase SDK from an already running Vite server. Do not clear authentication storage or pending-save journals for this upgrade.

Development and the unchanged production application share the existing Supabase database. Use a separate test account: interactive ratings, bookmarks, dismissals, and generation requests affect shared data. For the personalized-feed checks, the account needs existing interactions and a completed feed with eligible books.

`public.get_rate_feed_bootstrap(integer)` is **already installed and verified on this shared database**. Do not rerun `20261024000000_rate_feed_bootstrap.sql`, apply a fresh baseline, or reset the shared database to test this branch. Keep the existing feed functions available for production's six-call flow. A different database needs its own reviewed setup; the development endpoint requires the new RPC and has no legacy six-call fallback.

## Automated checks

Type checking and all Node/browser component tests:

```powershell
pnpm run check
pnpm exec vitest run
```

Focused development-browser regressions for auth, library loading/saving, and recommendation submission:

```powershell
pnpm exec playwright test e2e/auth-session.e2e.ts e2e/library-loads.e2e.ts e2e/library-saves.e2e.ts e2e/recommendation-submission.e2e.ts --workers=1
```

These use the standard Playwright config on port 4173. Leave that port available for the test server. The focused suites intercept application/auth reads and writes with synthetic fixtures; they do not require signing in with real credentials.

Production-preview feed/cache behavior, excluding the separately tracked timing assertions:

```powershell
pnpm run build
pnpm exec playwright test -c playwright.rate-entry.config.ts --grep-invert "entry timing:"
```

Leave port 4174 available; the dedicated config starts its own preview and refuses to reuse an existing server. The production build uses the configured environment values, while these browser cases intercept API/auth responses.

Run timing acceptance separately, after building and with other checks finished:

```powershell
pnpm exec playwright test -c playwright.rate-entry.config.ts --grep "entry timing:"
```

The timing tests retain the original under-200-ms assertions. The last recorded restored-fade run failed all three timing scenarios because some samples exceeded that threshold. A full invocation of the dedicated config includes those assertions and may therefore fail despite passing behavior checks. Preserve the transition and report the timing results; do not treat the historical zero-fade measurements as current acceptance or relax the assertions to make the run pass.

## Manual checks

| Check                                                                                    | Expected result                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prime `/rate`, return home, and click Start rating                                       | Cached/prepared cards and actions become available during revalidation. The intentional fade remains; refresh does not restore skeletons, replace mounted cards, or jump the scroll position. |
| Reload `/rate` with usable feed and complete interaction snapshots                       | Account-owned cached cards and actions work while live reads continue.                                                                                                                        |
| Enter `/rate` directly with no reusable snapshots                                        | Feed and library reads overlap. Cards can wait for the feed; actions wait for their required interaction collections. Instant entry is not guaranteed.                                        |
| Rate, bookmark, dismiss, undo, and reload                                                | Changes persist. Normal saves add no dots or saving labels, and acknowledgments do not move the counter or recommendation control. Save failures still expose retry.                          |
| Open a dismissed book's detail page and toggle dismissal                                 | The main cover uses 30% opacity when dismissed. Unknown state does not delay the cover; fading applies when state arrives. The rating removal action reads “Remove.”                          |
| Refresh the session, use two tabs, and sign out/switch accounts                          | No auth-lock rejection; account state follows the session, and old responses cannot restore another account's books.                                                                          |
| Visit landing, rate, FAQ, book detail, and recommendation views at desktop/mobile widths | Existing typography and controls remain. Font preloads follow the route; conditional fonts may load on first use, and an unused-preload warning alone is not a missing-font failure.          |

For controlled cache resets and actual click-to-card/action reports, follow the [browser procedure](rate-entry-browser-validation.md) and [direct-entry procedure](rate-entry-cold-path-review.md#real-account-cold-entry-check). Remove only the named disposable snapshots after pending saves settle; preserve authentication and pending-save journals.

Report the build, browser, viewport, account/feed condition, cache state, reproduction steps, and relevant timing or console output. Keep tokens and session contents out of reports. Cover-image completion, card visibility, action readiness, and backend request duration are separate measurements.

## Validation and deferred work

The pre-handoff review passed **719 Node tests across 97 files**, **125 browser component tests across 20 files**, type checking with zero errors/warnings, and changed-file lint/format checks. Earlier focused browser runs passed **28 development cases** and **29 production-preview behavior cases**. Those browser runs were not repeated in the handoff review; the documentation cleanup does not change application behavior.

The reported auth-lock error is resolved following the SDK upgrade and dependency rebuild; font-preload cleanup is implemented and validated. The remaining performance target is described above. Real cache misses and refreshes still depend on live Supabase responses.

Supabase latency-spike diagnosis, migration-history reconciliation, production deployment, and deployed measurements remain explicitly deferred. Reconcile the manually applied migration and verify the installed RPC and Node runtime before eventual deployment. See the [current status](rate-entry-status-review.md), [auth record](rate-entry-auth-sdk-upgrade.md), and [font validation](font-preload-validation.md) for supporting evidence.
