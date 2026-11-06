# Book page: behavior and release readiness

Current decisions consolidated November 5, 2026. Historical audits and raw evidence
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
across full pages, drawers, shortlist and feed. All characteristic, ranking and
keyword tags render as plain text, without click explanations, tooltips or dotted
underlines. Explanation text is omitted from server HTML. Awards display
backend-final assignments without recipient attribution; initially show six and
allow the rest to expand. Do not invent legacy
badge fallbacks.

## Series covers and loading

All ordered series member anchors and accessible names are in initial server HTML.
The strip shows covers without per-book captions, scrolls horizontally and initially
reveals the current book. The detail response already includes membership; no extra
series request is needed. Thumbnails use 200px variants with reserved 200x300 source
dimensions, native lazy loading, async decode and low priority. JavaScript releases
their images after the main cover loads/errors/is already complete or absent,
then yields two animation frames. A five-second client-side cover wait caps this
gate: a still-pending image is replaced with the title/author fallback and series
thumbnails, discovery and familiar connections are released. Cached broken images
also use the fallback. The deadline releases directly if paint callbacks have not
run; a successfully loaded image is retained. Timers and paint callbacks are cleared
on completion/navigation/unmount, and late image events cannot reopen the gate.
Links/spaces remain in SSR, with a noscript fallback.

After that gate, at most one next-volume route preload runs. Save-Data/final-volume
visits skip speculation and hover/focus intent takes precedence. During navigation,
only the selected-cover outline moves: no visible dimming, spinner or loading label.
The same-series strip and image elements stay mounted, preserve horizontal position,
and do not recenter. Series clicks preserve vertical scroll. A different series gets
a fresh strip. Author expansion, loaded covers, in-flight requests and panel scroll
persist across books with the exact same catalog author. Author-cover clicks preserve
page scroll. Switching authors resets the section and aborts old requests; late
responses are ignored. Reloads start with the author section closed.

Titles retain the original responsive CSS and natural wrapping. Connection labels,
author names, expanded author headings and missing-cover text wrap long unbroken
strings within their containers. Covers and the author chevron retain their sizes;
full text remains visible and may increase section height. Adaptive title
fitting was explicitly reverted; longer titles can move subsequent content. Author
books remain fetched only after the author is clicked. One bounded chronological
author collection is reused during same-author navigation. A subtitle states
publication order (oldest first, unknown years last). The current book stays in the
list, marked with aria-current and the same outline as a selected series cover.
At most 48 covers appear, with a truncation notice when needed; if the current book
falls outside the first 48, it follows the earliest 47. Manually closing the section
retains its collection and scroll position. No public catalog directory or
server-side author-books request is required for this release.
The author endpoint selects only book_id, slug and title (aliased from book_name),
with a shared summary response type. Year remains a database ordering field and is
not returned. The 49th row is used only to determine truncation. Full metadata still
loads through the normal book page; no Supabase schema, function or policy changes
are required.
Author thumbnails use the canonical 200px cover variants, reserved 200x300 source
dimensions, native lazy loading, async decoding and low fetch priority.

## Summary-drawer title navigation

Opening a ready book-summary drawer preloads its stored-slug route through
SvelteKit `preloadData`. A title click reuses the pending or completed read;
preload failure leaves ordinary navigation available to retry. No navigation
spinner was added. Public detail reads are also issued for opened drawers whose
titles are never clicked. The November 5 desktop/touch investigation and raw
captures are retained locally under `temp/book-navigation-investigation/` and
`temp/prepush-review-archive/`; those development samples are not production
latency acceptance measurements.

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

Each section selects up to three books from the existing five candidates: unread
non-dismissed books first, rated non-dismissed books next, then dismissed books as
fallbacks. Server order is preserved within each group, including dismissed books
regardless of rating. An all-dismissed list still shows its first three candidates.
Dismissed covers alone are dimmed and have a "Not interested" label; their links
remain active. Familiar books have no read-status label. Selection uses exact public
ULIDs from the current library; dismissing a volume does not dismiss its series.

The existing account-scoped dismissal snapshot/cache is reused without another
request. Without a snapshot, only discovery display waits for the initial dismissal
load, while its public RPC runs on the usual schedule. Failed loads offer retry;
valid cached snapshots remain usable during refresh or failure. Empty public lists
are omitted without waiting for dismissals. Guests use their current local state.
Rating-ID snapshots reprioritize results when available without waiting for full
metadata. Account changes clear the old reader's selection immediately. Local edits,
hydration and token refresh do not refetch public lists. Saved-to-read books remain
eligible. Covers use 200px variants, fixed dimensions, lazy loading, async decoding
and low priority.

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

## Starting-book recommendations

See [the discovery editor](discovery.md) for drawer navigation, draft retention,
status/results presentation and timeout recovery.

"More like this, but…" links to `/discover?from=<stored-book-slug>` and optionally
`&change=<preset>`. Public presets are `less-violence`, `more-action-driven`,
`more-complex-language` and `least-popular-30`. Opening that
page never submits a recommendation request. The reader chooses **Find books**
to insert a new request through the existing authenticated Supabase client.
There is no new request or generation dependency on the book page.

The discovery page resolves the stored slug through its unique catalog index,
returning the ULID and title/author/genre/keyword metadata together. The picker
reuses that record instead of issuing another ID lookup. Failed lookups offer
retry or choosing another book; unresolved slugs never become backend IDs. Late
responses after navigation, account changes or unmount are ignored.
Successful submissions and recent searches use `/discover?search=<request-id>`.
Those account-scoped URLs restore recorded filters/results; unsubmitted edits
remain draft state. Backend `seed_book_id` and saved JSON are unchanged. Generated
request links use [random public aliases](random-request-ids.md); internal result
keys and webhook IDs remain numeric.
The old `/rate/recommendations/filtered` route is removed without redirects.

`robots.txt` disallows `/discover`, covering the page and all query variations.
These URLs stay outside the sitemap. The blocked route intentionally has no
redundant `noindex` tag. Crawling restrictions are not authorization or a guarantee
that externally linked URL-only references cannot appear in search results.

The filtered page supports choosing/replacing/removing a starting book through
the existing catalog search. It sends `filters.seed_book_id` and optional
`filters.relative_dimensions` alongside ordinary filters. Direction buttons use
a minimum change of 0.15 on the normalized annotation scale; restored requests
retain their exact signed deltas. Positive pace means more introspective;
negative pace means more action-driven. Removing or changing the starting book
clears its relative modifiers, while ordinary filters stay selected. Least
popular 30% uses the existing absolute popularity percentile maximum of 30;
it does not claim a relative change from the source book.

Saved-search restoration, summaries and explicit retries retain the source and
relative changes. Public title/author display lookups are small and independent
of ranking. Generation uses the existing request-specific status polling and
rank-ordered result endpoint; it never reads a user's latest unrelated run.
Zero results remain empty; filters are not relaxed. Existing history evidence
is not presented as proof of the requested relative change.

Genres and keywords each support simultaneous `all_of`, `any_of` and `none_of`.
Every operator and category combines with AND. Matching uses exact case-sensitive
labels, with no parent/subgenre or synonym expansion. The editor and saved-search
summaries preserve all three groups, including contradictory requests; the worker
completes valid contradictions with zero results. Unused operators are omitted;
the existing limit of 200 labels applies to each list. An explicit user choice
replaces an opposite include/exclude choice for that label, without changing other
labels. Reopened contradictions remain intact until edited.

The starting-book metadata lookup includes its seven genre and ten keyword slots.
Its recorded tags offer Exclude quick choices; other tags can be required or
excluded through the existing catalog label picker. Source tags are never applied
automatically, and source replacement does not clear ordinary tag constraints.
All dimension controls remain available; the initial relative threshold stays 0.15.
The server owns candidate profile eligibility: a completely missing category
profile fails any filter on that category, while a populated profile passes an
exclusion when the exact label is absent. Exclusions mean not tagged, not verified
absence of content. The source book itself may carry excluded labels.

Empty results offer Adjust filters, preserving choices and opening the editor.
For a constrained starting-book search, Use starting book only explicitly submits
one new request with the applied source ULID and clears every explicit filter and
relative modifier. Account history and backend exclusions remain binding. If that
source-only search is also empty, Choose another starting book opens a focused
catalog picker instead of automatically retrying. Partial lists are shown as returned.

A starting-book search does not require ten ratings. It still requires a
Supabase session, available account library snapshots and successful pending
library saves. Ordinary recommendation searches keep the ten-rating rule.
Readers without a session can sign in without losing their draft. Switching
accounts clears previous results and ignores old asynchronous responses.
This uses existing recommendation access; no paid entitlement enforcement is
implemented, so the former Premium/coming-soon label is removed.

Filter copy stays lean: no repeated page/drawer subtitles, instructions already
expressed by presets, or general numeric-scale explanation above characteristics.
Custom characteristic ranges explain their 0–1 endpoints only when open; custom
popularity and rating ranges identify the 0–100 percentile units next to the inputs.
Search filters and recommendation counts use reader-facing language. Unapplied
changes, eligibility, loading/errors and empty-result recovery remain visible when
relevant. The tag dialog explains the active matching rule; Clear this group only
clears that rule, and all filters apply together.

## Required backend alignment before the v4 Supabase export

Approved November 4, 2026. Frontend filter labels have been updated; backend
alignment is still pending. Apply these names and endpoints in the backend's
annotation definitions and exported display metadata before producing the v4
Supabase dataset, so future exports do not restore the old wording.
The frontend reference is `FILTER_DIMENSIONS` in
[filteredRecommendations.ts](../src/lib/recommendations/filteredRecommendations.ts).
Keep the existing dimension keys and low-to-high directions.

| Dimension key          | Approved label                | Low endpoint      | High endpoint  |
| ---------------------- | ----------------------------- | ----------------- | -------------- |
| `granularity`          | Descriptive richness          | Understated       | Elaborate      |
| `entry_barrier`        | Required background knowledge | Little            | Extensive      |
| `narrative`            | Narrative structure           | Conventional      | Experimental   |
| `factual`              | Perspective                   | Subjective        | Objective      |
| `hierarchy_focus`      | Social focus                  | Society’s margins | Ruling elite   |
| `discussion_potential` | Potential for debate          | Clear-cut         | Debatable      |
| `spice`                | Sexual content                | None              | Explicit       |
| `vocabulary`           | Language complexity           | Accessible        | Demanding      |
| `violence`             | Violence                      | Minimal           | Graphic        |
| `intended_age`         | Target reader age             | Young children    | Adult          |
| `originality`          | Originality                   | Familiar          | Unconventional |
| `pace`                 | Story focus                   | Action-driven     | Introspective  |
| `depth`                | Thematic focus                | Literal           | Philosophical  |
| `political`            | Political leaning             | Left              | Right          |
| `period`               | Story time period             | Ancient past      | Future         |
| `atmosphere`           | Atmosphere                    | Comforting        | Oppressive     |

Political leaning uses Left and Right endpoints without an added explanation.

Surrounding filter copy also uses Themes & tropes, Book characteristics,
Most popular 30% / Least popular 30%, Top 20% by reader rating / Top 10% by
reader rating, and At least one for `any_of`. Keep these terms consistent in
exported UI metadata where applicable. These changes preserve the existing
operator keys and percentile thresholds; they do not alter matching or ordering.

The Adult endpoint needs a scale check: confirm the backend rubric and normalization
actually cover adult readers rather than relabeling a scale capped at older teens.
If reconciling any definition changes numeric meanings, regenerate affected
annotations and derived discovery datasets together. Frontend copy changes alone
do not rescale existing v3 scores. Before export, compare the backend definitions,
exported labels/endpoints and frontend reference, including relative modifier
wording, and resolve discrepancies at their source.

## Remaining product section

1. Match score: define and expose reader fit; adjacency is not a personal-fit percentage.

This still contains a placeholder. It is separate from the completed connections
and discovery features and from search-discovery requirements.

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

Starting-book validation covers signed/invalid deltas, seed-only and combined
filters, saved-search restoration/retry, source replacement, sign-in draft
preservation, account changes and status-gated rank ordering. Full-browser tests
with mocked authenticated Supabase responses cover a zero-rating mobile search,
reload, all three tag operators, explicit retries and source-only empty recovery.
Small-screen checks include nested tag dialogs with enlarged text. Read-only live
catalog lookups confirmed source metadata and genre/keyword projections. All three
operator groups round-trip together, and Fantasy never expands to Urban Fantasy.
Live authenticated recommendation generation
has not been exercised from this workspace.
