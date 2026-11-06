# Discovery filters and results

Current behavior for `/discover` on mobile and desktop. Starting-book links,
filter matching and backend release requirements are described in
[book-page behavior](book-page.md#starting-book-recommendations).

- Saved runs open on their status/results and applied-filter summary. The results
  use the full content width, with no filter sidebar ahead of them.
- Filters opens a full-height mobile panel or a desktop left drawer, matching the
  ratings menu's 768px breakpoint. The header and
  action footer remain visible while the fields scroll. Less common preferences
  stay in expandable sections; every existing filter remains available.
- A new visit opens the editor over an empty state. Opening or closing the editor
  never generates recommendations. Find books explicitly creates the request,
  closes the editor, and takes focus to the results/status area.
- Closing retains selected draft values in memory. Unapplied changes are labelled
  separately from the original run. Reloading or opening another historical run
  restores that run's submitted choices; this does not add persistent draft storage.
- The filter drawer and nested tag picker use shallow browser history. Back closes
  the current layer; Forward can reopen it with the in-memory draft retained.
  Submission replaces the editor entry with the new run. A closed base entry
  prevents Back to a new-search URL from reopening the editor and replacing Forward.
- Saved choices finish loading before editing is enabled. Initialization happens
  on the first successful read, including after a failed initial read. Later status
  polls do not overwrite edits. Account-change guards and original result order
  remain in place.
- The uncertain-submission warning stays visible after clearing or closing the
  editor. The duplicate-submission guard remains active. History refreshes after
  a timeout, and View recent searches opens the history section. A manual refresh
  and visible loading/error states support read-only recovery.

The controls live in `RecommendationFilterFields.svelte`. Request handling remains
in the route. `ModalDialog` adds an optional drawer placement, includes native
summary elements in keyboard traversal, and keeps the body scroll lock until all
nested modals have closed. Other modal consumers keep their centered placement.
The filter drawer uses the site's drawer surface, shadow, overlay and slide
timings. Its controls share selection/input styles and interactive typography;
starting-book lookup reuses SearchBar. View navigation precedes the page title,
and results/history share the same section-heading scale.

Concurrent changes to exact genre/theme matching and empty-result recovery are
preserved. They are not additional changes attributed to this layout work.
Numeric/custom-range summaries now include preset labels or exact bounds. Custom
characteristic edits retain raw strings and require both bounds; erasing a range
does not dismiss its custom editor. Confirmed missing starting books block
submission, while transient display lookup failures alone do not.

Library warnings and Retry are available on the results page and in the editor,
with one visible notice at a time. Starting-book and author searches use combobox
semantics and active-option keyboard navigation. Result gutters and secondary
touch targets match the site's existing tokens. The superseded BrowseTagPicker
and unused author matching-rule API have been removed.

## Validation

Component tests exercise seeded and ratings-based submissions, saved-run loading,
retry, draft retention, edits during polling, focus restoration, nested dialogs,
account changes, uncertain writes and recommendation order. The existing shared
modal tests cover other modal consumers.

Full-page Chromium checks use controlled account/catalog/request fixtures, real
page components and the app shell. They check 390×844, 1440×900, 320×568 and
390×844 with a 24px root font: results position, viewport containment, scrolling
preferences with a stable footer, and nested tag choices. No live recommendation
jobs or account writes are needed for these checks.

Screenshots and the isolated browser-test configuration are in the ignored folder
`temp/filtered-layout-implementation/`. Book text and covers in those captures are
test fixtures, not live recommendation output.

The November 5 implementation validation covered 46 focused model/component tests (22 payload/summary, 18 page,
6 shared modal) and 20 full-page Chromium scenarios. The source-URL change case
exposed a router state-commit race; automatic drawer opening now waits for navigation
to complete, and the three navigation scenarios passed on a focused rerun after
that fix. Type checking reports zero errors and warnings; targeted ESLint and
Prettier checks pass.

The follow-up browser configuration and screenshots are under
`temp/filtered-follow-up-implementation/`. Run its Playwright configuration to
repeat the full set. The filter editor needs no schema changes. Random request
links require the separate [public-ID migration](random-request-ids.md).

Historical filter reviews and their reproduction evidence are retained locally
under `temp/prepush-review-archive/` and the ignored probe folders named above.
Use the checked-in page/model tests and `e2e/starting-book-recommendations.e2e.ts`
for repeatable regressions from a fresh checkout.
