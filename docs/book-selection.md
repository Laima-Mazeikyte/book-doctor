# Book selection recommendations

`/choose-books` is the shared workspace, with the existing app header, an overlapping cover strip using native horizontal scrolling, and inline search/source selection.

Selections that fit render each cover once and do not scroll. Overflowing selections
support mouse dragging, touch, keyboard and native horizontal scrolling without
scrollbar or arrows. Every overflowing selection loops in both directions, including
the tightest overflow. With fixed-size overlapping jackets, a short cycle may show
parts of the same jacket at opposite faded edges; these are display copies, not
duplicate selection entries. Only one logical set is
exposed to assistive technology and keyboard navigation. The ranking editor
uses a compact selected-book count; the 200 / 200 format appears only at the cap.
Clear entire selection offers Undo clear, independently for each mode, until the
next selection edit. The empty-state prompt appears once above the book browser.
Search keeps its original responsive card widths, with space below the input.
Covers retain their aspect ratio beside long titles and display the complete image.

Selected jackets use their natural image proportions at a shared height, with a
24px overlap instead of letterboxed 2:3 containers or positive loop spacing.
Cover and viewport heights stay unchanged when scrolling starts or stops. Looping
starts with scrolling, never at a separate minimum cycle length. No cover
enlargement or extra spacing is used to force looping for short selections.
Only overflowing strips fade at
both horizontal edges; the fade sits above artwork but below remove controls
and never intercepts pointer input. Vertical padding accommodates rotation and
the feed-matching 5% hover/focus enlargement.

Hovering or keyboard-focusing a jacket promotes it above previously visited
jackets; the complete recency stack remains after enlargement ends. This is
presentation-only: selected IDs and left-to-right/submitted order never change.
The stack resets on mode changes, leaving results for selection, and refresh,
but survives opening and closing details. Loop copies share each book's layer,
while only the primary set participates in keyboard/assistive navigation.

Clicking a jacket (or tapping it once on touch) opens the existing summary panel
with ratings, bookmarks and not-interested actions immediately, using already
loaded source/library details or this page visit's resolved-detail cache. Minimal
session-draft records resolve any missing metadata in the background, showing
loading/error/retry inline in the synopsis area while identity and actions stay
usable. Even empty catalog summaries are cached so reopening never repeats the
request. Timeout and cancellation remain in place; the account-scoped in-memory
cache clears on account changes. Closing restores focus without scrolling the strip. Mouse drags use
a 5px threshold before pointer capture and suppress the resulting click; touch
scrolling remains native. Remove controls remain separate from cover activation.

Search results, Bookmarks and Previous recommendations expose separate cover and
title buttons that open this same panel without adding/removing a selection.
Add/Selected controls remain independent. Both entry points support keyboard
activation and restore focus to the exact triggering button; mobile uses one tap.
Candidate controls inherit the existing disabled fieldset while a job runs.

## Selection and entry points

The editor renders once session restoration has identified the account. Library
ID snapshots no longer block the picker, draft restoration, catalogue search,
cover details or explicit selection edits. Submission, bulk addition and automatic
preselection retain their library safety prerequisites; a local readiness message
explains any disabled action. Genuine signed-out and failed-session states have
separate approved copy and Sign in / Reload actions.

Plain entry requests no source collection. `from=bookmarks` and
`from=recommendations` request only their own source; Recent selections loads
independently. Source loading, loaded-empty, unmatched-search and final-error
states are distinct. Changing source, mode or selection consumes/cancels the
one-time entry action; opening details or scrolling does not. Once preselection
is applied, no source refresh changes selected IDs or submission order.

Bookmarks use the shared account-scoped loader and its in-flight request. Recent
snapshots are reused for 60 seconds; older snapshots stay visible during
revalidation. Local bookmark overlays are merged, with newly added books first.
Previous recommendations reuse a loaded full-page snapshot or the shared
lightweight candidate cache, with the same freshness window and empty-response
caching. Rating/dismissal changes, completed selection jobs, imports and cross-tab
library revalidation invalidate candidates. Final read errors wait for explicit
retry instead of restarting on every reactive update.

`GET /api/recommendations/unique?view=selection` retains the full endpoint's
50-run eligibility window, rank cutoff, rating/dismissal exclusions and recency,
but returns only book identities and last-recommended timestamps. It skips
synopsis, precedent, author-relationship and dimension-match loading. Missing
details resolve through the existing inline summary loader on demand. The full
endpoint response remains unchanged for the recommendations page.

Cold picker entry defers recommendation-count refresh and rated-details warmup;
normal page navigation resumes them when relevant. No backend worker or database
migration is required for these entry changes.

The entry browser probe holds the requested source response until after measuring
the visible editor. Plain entry starts Recent selections and the three safety ID
reads, but no bookmark/candidate/count/details request. Bookmark entry adds just
the shared bookmark read. In both cases the search/editor is visible before the
held response is released; eligible books are selected afterward only if the
entry intent remains active. These are mocked local-development checks, not
production latency measurements.

Final entry validation: all 81 selection/library end-to-end tests passed in one
run, including blocked sources/IDs, edit-vs-preselection races, successful empty
caching, retry isolation, account changes, revalidation and browser history.
All 931 server/unit tests and 26 related browser-component tests passed, along
with type checking, targeted ESLint/Prettier and the production build. The six
history-scroll probes also passed with one result scroll each and no unrelated
source reads. No live recommendation jobs, database writes or migrations were
performed for this entry implementation.

- Bookshelf bookmarks and For You open Rank my list with unread, non-dismissed books preselected. For You uses unique titles from the latest 50 eligible completed runs.
- Discover opens Find more like these. Both modes accept 4-200 unique canonical catalog ULIDs.
- Automatic preselection and Add all skip rated and dismissed books in both modes. Collections over 200 preselect the 200 most recent eligible books; the remainder stays available for swapping.
- Individual selection, including search, accepts rated and dismissed books. Dismissed books remain shaded. Selection itself never changes saved actions or ratings.
- Ranking returns up to 10 from the submitted selection, including explicit read/dismissed choices. Explicit rating history provides taste context; no minimum rating count is required.
- Inspiration treats every usable seed as equally positive regardless of prior ratings. Results exclude all submitted IDs and other rated/dismissed books. Other bookmarks remain eligible.

Modes have independent account-scoped session drafts. Source-entry URL actions are consumed with shallow replacement so refresh/Back retain edits. Saved requests restore the original `book_ids`, including removable placeholders for missing display records. Those placeholders do not block submission.

## Backend contract

`POST /api/recommendations/selection` accepts only `request_type` (`rank_selection` or `recommend_from_selection`) and `book_ids` (4-200 unique ULIDs). The server authenticates ownership, validates syntax and inserts those fields plus `user_id` into `recommendation_requests`. Filters are omitted. No catalog/action preflight or library writes occur. Existing general/discovery submissions remain unchanged.

GET returns account-scoped status and metadata, including `skipped_book_ids`; `include_books=1` resolves input display data once. GET without an ID lists the latest 20 selection requests for recent selections and uncertain-write recovery. Responses are private and uncached.

Unsupported inputs are skipped by the worker, even if only one usable seed remains. Partial success has no skipped-book notice. If none remain, `no_usable_selection` displays the approved unavailable-selection error while keeping the submitted selection. Editing or retrying a failure inserts a new request; submitted inputs are immutable.

Results load only after completion, follow backend rank order and honor `result_count`, up to 10. For rankings of 4–9 submitted books, skipped inputs are silently appended after usable results in alphabetical title order. Rankings of 10+ books omit skipped inputs; entirely unusable selections display the unavailable-selection error. Scores are never displayed as ratings/confidence or used to re-sort. Inspiration evidence says "Based on books you selected" and retains unrated seed covers. Saved selection links through the legacy shortlist route redirect to the selection results page for all results and Back to selection.

For You uses completed, nonempty `recommendation_requests` directly, including both new modes, and excludes discovery-filtered runs. The latest 50 eligible requests define the history window. Best-effort `recommendation_log` writes are not a dependency.

## Deployed migrations

These files are exact copies of the backend SQL supplied by the owner:

- Backend 004: `supabase/migrations/20261106000000_book_selection_requests.sql`, replacing our unexecuted draft with the deployed contract, immutable input trigger, worker RPCs and permissions.
- Backend 005: `supabase/migrations/20261108000000_tolerant_book_selection.sql`, adding skipped IDs, tolerant completion and `no_usable_selection`.

Both are already deployed per the backend owner. No SQL was executed by this frontend work. Repository timestamp names map to backend 004/005; they do not establish remote Supabase CLI migration versions. Reconcile the remote migration ledger before any future CLI push. Do not replay these files or reset the shared database. A read-only schema probe on November 8 confirmed that the new columns are available.

## Recovery and verification

Submission keeps the selected covers and picker visible, with selection controls, source tabs, search and both modes disabled immediately. Progress stays inside the action button: a spinner and “Ranking your list…” or “Finding more books…”, changing to “Still working…” after four seconds. Network recovery uses “Reconnecting…” in that same button; there is no intermediate navigation or progress panel.

Recent selections stay mounted, visible and unchanged during submission and polling; starting a job must not remove the history below the picker or shift its position. Historical result links temporarily lose their navigation targets, expose their disabled state to assistive technology and leave the tab order while a job is active. They become navigable again on completion, failure or timeout.

Opening history is a separate read-only flow. In-page clicks keep the current
screen, source/search/expanded candidates and Recent selections in place while
the clicked row alone shows loading. Failed reads show retry feedback without
replacing the screen or modifying selection drafts. Only successful reads commit
the historical result and mode, with one focus/scroll transition and a shallow
history entry. Cached/uncached results use the same destination. Source lists,
recommendation counts and history are not refetched just to view saved results.
Browser Back/Forward and Back to selection restore the preserved picker, scroll
position and focus. Modified clicks keep normal mode-aware deep links. History
reads have a 15-second overall timeout; genuinely processing saved requests poll
without submitting a new request or writing a pending-job journal.

Status is checked immediately and then 500 ms after each completed check, with only one check active at a time. Network errors back off to 1, 2 and 4 seconds. Polling continues in background tabs, subject to browser timer throttling; visibility restoration requests an immediate check without overlapping the current one. Results replace the picker, receive focus and scroll into view, with “Back to selection” above the cards. Returning restores only submitted books and order, not source, search or scroll position.

The total click-to-results budget is ten seconds, including submission, library-save flushing, polling and fetching cards. The original click timestamp, submitted books and request ID are retained in account-scoped session storage for same-tab refresh/navigation recovery. Recovery starts before source collections load. Unknown submission outcomes check recent matching requests rather than automatically posting again. Navigation, reload and account changes cancel local reads, not backend work.

At the ten-second deadline, local checking stops and editing is restored without clearing any selected books. The button reads “Error: Timed out. Retry”; clicking it deliberately submits a new job, even though the old backend job may still finish. Confirmed failures use “Error: Failed. Retry”. Late responses from abandoned local attempts cannot replace the current view. No backend cancellation or idempotency changes are included.

Only the latest completed selection is persisted in this tab for reuse, including empty results. Other opened historical results are cached in account-scoped memory for the page visit. Submitting the same books in the same mode as the latest selection reopens those results without a new job; presentation order is ignored for matching. An active request blocks submissions in both modes. Storage failures fall back to in-memory behavior.

Run `pnpm run check`, focused server tests, `e2e/book-selection.e2e.ts`, feed scheduling/cache browser tests and `pnpm run build`. Browser fixtures intercept auth/catalog/API calls and do not create live recommendation jobs. The strip uses native scrolling, fixed cover dimensions, lazy images and no per-scroll application updates. Physical-device profiling remains separate from headless frame measurements.

The historical-loading implementation passed 921 server/unit tests, including
five read-only history-loader tests, and 13 related browser-component tests.
All 53 selection browser scenarios passed across validation runs. The last full
run passed 52/53; its mobile cached-repeat trace test passed on isolated rerun,
as did a prior intermittent mobile source-button timeout. These intermittent
browser-suite failures are recorded rather than reported as a clean full run.
Six before/after diagnostic scenarios confirmed exactly one results scroll,
unchanged picker coordinates during loading and no unrelated API reads. Type
checking and targeted lint/format checks passed; the production build passed.
No live jobs, database writes or migrations were executed.

The earlier candidate-details update passed all 46 selection end-to-end tests, including
seven new source/mode/keyboard/touch cases, plus 916 server/unit tests, zero
type-check errors/warnings, targeted lint/format checks and the production build.
The current read-only history-loading and scroll behavior is documented above
and covered by the selection browser regressions.

The earlier always-looping correction passed all 39 selection end-to-end tests and 916
server/unit tests, with zero type-check errors/warnings, targeted ESLint/Prettier
checks and a successful Netlify production build. Regression checks require
looping for every overflowing selection in both modes at desktop/mobile sizes,
wrap across both seams at the tightest overflow, verify cyclic book order, and
keep cover/viewport heights fixed. A second trailing display copy prevents the
native scroll limit from clamping the right-hand wrap point for short cycles.
Partial edge repeats are allowed; fully visible duplicate jackets are not.

The earlier panel-response and fixed-height follow-up passed 916 server/unit tests, 13
related browser-component tests and all 39 selection end-to-end tests. New checks
hold catalog transport open while asserting an immediately usable panel, verify
source-detail reuse after refresh and one-read caching for full/empty summaries,
and cross both scrolling thresholds in both modes on desktop/mobile without any
cover or viewport height change. Type checking, targeted ESLint/Prettier and the
Netlify production build passed. Catalog/account/API requests were mocked; no
live jobs, database writes or migrations were performed.

The earlier horizontal-strip interaction update passed 915 server/unit tests, 12 related
browser-component tests, and all 32 selection end-to-end tests, including desktop
and mobile overlap/fades, remembered hover/focus layers and reset boundaries,
unchanged submission order, click-versus-drag, single-tap/native touch swipe,
details loading/retry, focus restoration and library actions. Type checking
reported zero errors/warnings; targeted ESLint/Prettier checks and the Netlify
production build also passed. Screenshots were reviewed with varied-proportion
cover fixtures. These tests intercepted catalog/account/API requests; no live
recommendation jobs, database writes or migrations were run for this update.

The button-progress lifecycle update passed 912 server tests (including 14 new
job lifecycle/result-order tests), 23 selection end-to-end tests, 37 related
recommendation browser-component tests, type checking with zero errors/warnings,
targeted ESLint/Prettier checks and the Netlify production build. These browser
checks used intercepted requests; no live jobs or migrations were run for this update.

Earlier November 8 validation passed: zero type-check errors/warnings, 898 server tests,
42 focused browser-component tests, 50 production-preview browser tests (three
existing opt-in timing cases skipped), formatting and the Netlify production build.
A separate anonymous test account also exercised the production frontend API and
deployed worker: ranking five inputs returned three usable selected books with two
skipped IDs; inspiration from four inputs returned ten other books with one skipped
seed; four unsupported IDs failed with `no_usable_selection`. Both completed runs
were immediately present in For You history. The ignored
`temp/book-selection/live-smoke.json` records the test account/request references
and outcomes, without credentials. No migrations were executed.
