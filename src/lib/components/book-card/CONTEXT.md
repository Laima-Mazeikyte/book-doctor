# BookCard route contracts

Single component: [`../BookCard.svelte`](../BookCard.svelte). Pass **`context`** from the owning route.

| `context` | Rating wiring | Notes |
|-----------|---------------|--------|
| `rate` | Internal `ratingsStore` | Body: stars only. Optional `onSearchAuthor` for summary overlay search. |
| `bookmarks` | Props + callbacks | Full actions + overlay. |
| `rated` | Props + callbacks | Typically star-only when rated. |
| `not-interested` | Props + callbacks | `notInterested` styling; third action present. |
| `recommendations` | Props + callbacks | Same as bookmarks flow; parent may set `role="grid"` / keyboard nav. |

Summary text: [`summaryStub.ts`](./summaryStub.ts) (placeholder until API). Grid: [`.book-card-grid`](../../../app.css) only — do not override columns/gap on route pages.
