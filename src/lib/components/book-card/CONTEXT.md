# BookCard route contracts

Single component: [`../BookCard.svelte`](../BookCard.svelte). Pass **`context`** from the owning route.

| `context`         | Rating wiring           | Notes                                                                           |
| ----------------- | ----------------------- | ------------------------------------------------------------------------------- |
| `rate`            | Internal `ratingsStore` | Cover pills + body stars. Optional `onSearchAuthor` for summary overlay search. |
| `bookmarks`       | Props + callbacks       | Same card chrome as `rate` (cover pills + stars).                               |
| `rated`           | Props + callbacks       | Same as `bookmarks`.                                                            |
| `not-interested`  | Props + callbacks       | Same as `bookmarks`; list is NI titles; `notInterested` prop usually true.      |
| `recommendations` | Props + callbacks       | Same as `bookmarks`; parent may set `role="grid"` / keyboard nav.               |

Summary text: [`summaryStub.ts`](./summaryStub.ts) uses the catalog summary or the shared unavailable message. The shared [`BookSummarySheet.svelte`](./BookSummarySheet.svelte) renders the drawer and preloads a ready book's stored-slug route. Grid: [`.book-card-grid`](../../../app.css) only — do not override columns/gap on route pages.
