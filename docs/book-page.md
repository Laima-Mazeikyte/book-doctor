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

## Remaining product sections

1. Match score: define and expose reader fit; adjacency is not a personal-fit percentage.
2. "More like this, but...": actual modifier queries and premium access behavior.
3. Similar experience / A different direction: candidate-selection and result display.

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
