# Route-specific font preloads (2026-10-25)

The eight global font preloads are replaced by two shared hints (Bespoke Light and
Inter Regular) plus route-specific hints rendered by `FontPreloads.svelte`. Landing
adds Bespoke Variable; `/rate` also adds Bespoke Bold. The links are in server-rendered
HTML and update during client navigation. Font files, face definitions, family/weight
tokens, stylesheet order, and `font-display` policies are unchanged.

Other routes retain their measured needs: the public book page adds Inter Medium,
filter/lab controls add Inter SemiBold, and the standalone Not interested heading keeps
Beth Ellen. Recommendation empty-state Beth Ellen/Regular hints belong to the rendered
empty-state component rather than every recommendation visit. Remaining faces still
load through their existing CSS when used.

This follows [preload's purpose of requesting resources needed soon](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload).
It changes download timing/priority; it does not change typography or Supabase reads.

## Measured download reduction

Fresh isolated Chromium contexts used the same production build settings and synthetic
application responses. Every former page downloaded the eight hinted WOFF2 files,
totalling **222,940 bytes**. These figures are font-file body bytes, excluding HTTP
headers and other page assets. They are not measured page-load speedups.

| Page                      | Preloads before → after | Font files downloaded after |    Font bytes after | Reduction |
| ------------------------- | ----------------------: | --------------------------: | ------------------: | --------: |
| Landing                   |                   8 → 3 |                           3 |   84,168 (82.2 KiB) |     62.2% |
| `/rate`                   |                   8 → 4 |                           4 | 108,964 (106.4 KiB) |     51.1% |
| FAQ                       |                   8 → 3 |                           4 |             108,964 |     51.1% |
| Public book page          |                   8 → 5 |                           5 |             133,236 |     40.2% |
| Standalone Not interested |                   8 → 5 |                           5 |             135,720 |     39.1% |

FAQ's closed answer content still causes Bold to load through CSS; that face no longer
gets an unconditional early preload. Dynamic/empty states can require additional
fonts, so these counts describe the tested states rather than every possible visit.
An anticipated card font can still be unused on a route with no books. This change
reduces unnecessary preloads; it does not promise zero warnings in every state/browser.

## Validation

The before/after survey covers **15 routes at both 1440×1000 and 390×844**, with a new
browser context per document. It includes landing, rate, FAQ, bookshelf, dismissals,
recommendation/history/filter/shortlist views, public book detail, reset-password, and
all lab routes. No page errors occurred in the final survey. API/auth responses and
the public book's server read used fixtures; no real credentials or live writes were
used. Measurements are recorded in [the result data](font-preload-results-2026-10-25.json).

Chromium's [rendered-font inspection](https://chromedevtools.github.io/devtools-protocol/tot/CSS/#method-getPlatformFontsForNode)
confirmed the intended custom faces in the updated views. One baseline filtered-page
run rendered system fallbacks for Inter despite its preload; the updated run used Inter.
Inter's existing `font-display: optional` policy remains unchanged, so slow conditions
can still choose a fallback for a load. The script also sampled geometry and cumulative
layout shift. Landing/rate had no added sampled CLS; existing recommendation-state
transitions remain in the baseline. One mobile rate snapshot admitted a different
fixture book before exclusions settled; its author-position difference is not a valid
font geometry comparison. These observations are not a guarantee against every
first-paint font swap under arbitrary network conditions.

Additional Chromium and Firefox checks cover desktop/mobile landing → rate → landing
→ FAQ client navigation, sign-in/forgot-password fonts, library drawers, and conditional
recommendation empty states. Screenshots were reviewed after transitions settled.
The modal/drawer faces remain discoverable on first use. A face that is not needed by
the initial page can still be downloaded when a later interaction first needs it,
under the existing display policy.

Source checks: production build, Svelte/TypeScript check (zero errors/warnings), changed
Svelte-file lint, formatting, and whitespace checks passed. The intentional navigation
fade and quiet-save UI remain in place. No user-facing loading/saving copy was added.

When a route's initial typography changes, review its entry in `FontPreloads.svelte`.
An unlisted route retains the shared faces and Variable hint; CSS still supplies all
other faces. Future validation should use cold browser loads and inspect the actual
rendered font, not only the computed `font-family` string.

The later [font text-share inventory](font-text-share-2026-10-25.md) measures approximate
character percentages with representative public catalog strings and working covers.
This differs from the missing-cover fixtures used in the download comparison above:
cover-image lettering is artwork, while missing-cover titles are live Bespoke text.
The inventory includes desktop/mobile full-page and initial-viewport breakdowns.
