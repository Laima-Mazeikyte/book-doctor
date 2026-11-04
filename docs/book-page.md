# Book page: behavior and release readiness

Current decisions consolidated November 1, 2026. Historical audits and raw evidence
are archived locally under temp/repository-cleanup-2026-11-01/. Earlier proposals
are not pending instructions when they conflict with the decisions here.

## Public content and addresses

- One page per catalog book at /books/<stored-slug>. ULIDs remain internal catalog
  IDs for ratings, covers, recommendations and relationships. Slugs are permanent;
  title/author corrections do not change assigned URLs. Ordinary edition splitting
  and legacy ULID redirects are outside the current scope.
- Titles, authors, summary, available genres/tags, ranking badges, awards and series
  links appear in server HTML. Invalid core identities are contract errors; optional
  missing fields are omitted. Missing synopsis copy is "No description available."
- One H1, descriptive title, meta description, canonical and social-image metadata.
  Missing books return a real 404; failed catalog reads return 503.
- The 404 uses the landing illustration/style, the "404 / Page not found" eyebrow,
  and one random quote in the heading font. "Lost in the stacks" was removed.
- Known v3 factual/series-order issues are accepted for testing and belong in v4 data.
  Political-score NULLs are intentional; not all missing dimensions need backfilling.

## Annotations and lean presentation

Stored rankings and characteristics accompany ordinary metadata; no per-page public
ranking-population download. Shared components/map functions keep badges consistent
across full pages, drawers, shortlist and feed. Tooltip wording uses an ordinal,
for example "Ranked 47th best book or series of all time, according to Unread."
The server-provided tooltip text is already in HTML; a full explanation wall is
not required. Awards display backend-final assignments without recipient attribution;
initially show six and allow the rest to expand. Do not invent legacy badge fallbacks.

## Series covers and loading

All ordered series member anchors and accessible names are in initial server HTML.
The strip shows covers without per-book captions, scrolls horizontally and initially
reveals the current book. The detail response already includes membership; no extra
series request is needed. Thumbnails use 200px variants with reserved 200x300 source
dimensions, native lazy loading, async decode and low priority. JavaScript releases
their images only after the main cover loads/errors/is already complete or absent,
then yields two animation frames. Links/spaces remain in SSR, with a noscript fallback.

After that gate, at most one next-volume route preload runs. Save-Data/final-volume
visits skip speculation and hover/focus intent takes precedence. During navigation,
only the selected-cover outline moves: no visible dimming, spinner or loading label.
The same-series strip and image elements stay mounted, preserve horizontal position,
and do not recenter. Series clicks preserve vertical scroll. A different series gets
a fresh strip. Author expansion, loaded covers, in-flight requests and panel scroll
persist across books with the exact same catalog author. Author-cover clicks preserve
page scroll. Switching authors resets the section and aborts old requests; late
responses are ignored. Reloads start with the author section closed.

Titles retain the original responsive CSS and natural wrapping. Adaptive title
fitting was explicitly reverted; longer titles can move subsequent content. Author
books remain fetched only after the author is clicked. One bounded chronological
author collection is reused during same-author navigation. A subtitle states
publication order (oldest first, unknown years last). The current book stays in the
list, marked with aria-current and the same outline as a selected series cover.
At most 48 covers appear, with a truncation notice when needed; if the current book
falls outside the first 48, it follows the earliest 47. Manually closing the section
retains its collection and scroll position. No public catalog directory or
server-side author-books request is required for this release.

## Personalized familiar-book connections

The implemented section is "Similar books you've read", including disliked books.
It queries the private authenticated RPC once per book visit after auth and the main
cover are ready. It preserves server order and rating context as a visit snapshot:
rating edits and token refresh do not refetch. New visits, Back/reload and account
changes fetch fresh results. Sign-out clears results; stale responses are ignored.
Empty/unavailable targets omit the section. No ten-rating gate applies to connections.
See [installation and v4 release steps](operations/connections.md).

## Public book discovery

"Similar experience" and "A different direction" use one public get_book_discovery
RPC per book visit, after auth restoration and the main-cover paint gate. Both
lists include live display metadata; no second catalog request or server-side
page-loading dependency is added. Results from old navigation are aborted/ignored.
Empty sections are omitted. Failed requests show a small message and explicit retry.

Each section selects up to three books from the existing five candidates. Unread
books come first; when fewer than three are unread, already-rated books fill the
remaining slots. Server order is preserved within both groups. Familiar books use
the same card presentation with no read-status label. Selection uses exact public
ULIDs from the current library and happens locally when its rating-ID snapshot is available;
it does not wait for full book metadata or make another request. Until that snapshot
is available, shared public results remain usable. Account changes clear the old
reader's prioritization immediately; token refresh and library edits do not refetch the
public lists. Saved-to-read books remain eligible. Covers use 200px variants, fixed
dimensions, lazy loading, async decoding and low priority.

Section headings appear without subtitles. The generic shared-profile reason is
not repeated on individual cards. Supported
departure codes become short relative descriptions, such as "More introspective"
or "Toward fantasy"; unknown codes omit the explanation while preserving the book.
No similarity percentages or personal-fit predictions are shown. Canonical groups
share lists: different series volumes may return identical recommendations.

The user installed and verified book-discovery-gower-xquad-v1-b4ac45d4e9cc against
v3 on November 3, 2026: 74,530 canonical groups, 37,930 aliases, 112,460 matched IDs,
two unmatched aliases, and 17.23 MiB. The corrected Dashboard verification uses
[an explicit book ID](../scripts/catalog/verify-book-discovery.sql), since the
backend's original verifier can lose its session setting across ROLLBACK and
compare two empty responses. Preserve the ignored backend package for recovery.
Before production, obtain the matching v4 dataset, stage/activate it, and repeat
RPC/browser checks; a catalog upload alone does not update the precomputed lists.

## Remaining product sections

1. Match score: define and expose reader fit; adjacency is not a personal-fit percentage.
2. "More like this, but...": actual modifier queries and premium access behavior.

These still contain placeholders. They are separate from the completed connections
feature and from search-discovery requirements.

## Search publication

Keep the public index and book sitemaps, and regenerate explicitly after a stable v4
catalog publication. See [sitemaps](operations/sitemaps.md). Verify production book
and sitemap 200 responses, canonical HTTPS unread.world URLs, robots sitemap reference,
absence of unwanted noindex and maintenance 503 responses, and the real unknown-book 404. PUBLIC_MAINTENANCE_MODE can prevent book indexing; check the production setting.
Submit the stable index in Search Console and inspect representative live book URLs.
Discovery does not guarantee indexing or ranking. Confirm v4 public facts before promotion.

JSON-LD/structured book metadata, a public catalog browsing directory, anti-scraping
controls and additional AI-specific files were explicitly deferred/skipped. Do not
restore them as release blockers. Personalized reading history stays outside public SSR.

## Validation boundaries

Local series checks covered SSR/no-JavaScript anchors, held/error/cached main covers,
mobile/desktop strips, persistent thumbnails, scroll and bounded preloading. The
main-cover gate preserved request ordering in 24 simulated runs without a consistent
added main-cover opening delay in the sampled series. This is not a production latency
guarantee. Main content, cover completion and personalized RPC timing are distinct.
Backend model quality and catalog correctness are not established by UI tests.

Discovery validation covers response contracts, stale navigation, account-scoped
local filtering, reserves, retry/empty states and cover ordering. Fresh signed-out
desktop/mobile browsers exercised the installed Supabase RPC for The Hunger Games
and The Way of Kings: one discovery request per tested visit, six visible links,
200px low-priority lazy covers and no horizontal overflow. Link navigation was
checked. Signed-in filtering was tested with synthetic library state; these checks
do not establish production latency or reader-rated recommendation quality.
