# Changes

Two-sentence descriptions of every change performed in this refactor/review session, grouped by phase. All changes are behavior-preserving unless explicitly noted.

## Phase 1 — Duplication & dead-code refactor

### Shared book-row mapping (`src/lib/server/catalogBooks.ts`)
Added `fetchBooksByUlidsInOrder` and `fetchBooksByUlids` helpers that query the `books` table and map rows through the existing `mapBookRowToBook`, replacing six hand-rolled `row → Book` transformations across the API routes. The ordered variant preserves the caller's input order (created-at for bookmarks/not-interested, rank for recommendations), so list ordering is unchanged.

### Shared request-auth helpers (`src/lib/server/requestAuth.ts`)
Extracted the duplicated Bearer-token parsing into `getAccessToken` and `requireAccessToken` (the latter throws a 401 when no token is present). This removed the copy-pasted `getAccessToken` function and inline token logic from five API endpoints.

### User-library mutation factories (`src/lib/server/userLibraryMutations.ts`)
Factored the near-identical `POST`/`DELETE` handlers for `user_bookmarks` and `user_not_interested` into `createUserLibraryPostHandler` and `createUserLibraryDeleteHandler`. The 401 guard, JSON/query `book_id` parsing, and RLS-scoped upsert/delete semantics are preserved exactly.

### Layout decomposition — auth bootstrap (`src/lib/auth/bootstrap-auth.ts`)
Moved session restore, lazy anonymous sign-in, the `PASSWORD_RECOVERY` handler, and the ratings retry/migration listeners out of `+layout.svelte` into `createLayoutAuthController` and mount helpers. The URL-hash token retry loop and anonymous-sign-in dedup promise were preserved verbatim.

### Layout decomposition — library loaders (`src/lib/auth/user-library-loaders.ts`)
Extracted ratings/bookmarks/not-interested hydration, persistence wiring, sign-out reset, and post-migration reload into dedicated functions coordinated by a `LibraryLoadCoordinator`. The staleness guarding and ULID→UUID resolution logic were carried over unchanged (then later hardened — see Phase 2).

### Layout decomposition — id resolver (`src/lib/auth/book-id-resolver.ts`)
Pulled the ULID/UUID join-row helpers (`bookUuidFromJoinRow`, `bookmarkUlidFromRow`, `fetchUuidByUlid`) into a standalone module. `+layout.svelte` shrank from ~800 to ~320 lines while keeping the same runtime behavior.

### Dead-code removal (`src/lib/data/dummyBooks.ts`, `Hero.svelte`)
Trimmed `dummyBooks.ts` to the only used export (`getBookById`), removing the unused `getBooksPage`, `getStarterBooks`, `searchBooks`, and `STARTER_LIST_SIZE`. Deleted the unreferenced `Hero.svelte` component.

## Phase 2 — Silent-fallback hardening

### ULID-as-UUID fallback removed (`book-id-resolver.ts` + callers)
`bookUuidFromJoinRow` now returns `string | null` and never falls back to treating a ULID as a UUID, keeping the in-memory ratings/bookmarks maps strictly keyed by `books.id`. The hydration callers `flatMap`-skip unresolved rows and log a warning, so a data mismatch surfaces instead of silently splitting state.

### Tokenless GETs now return 401 (all `/api/*` routes)
Every API `GET` switched from `getAccessToken` to `requireAccessToken`, so a missing `Authorization` header returns a 401 instead of silently degrading to the anon client and an empty result. Anonymous users are unaffected because they carry a real anonymous JWT.

### `getUserIdFromToken` shape hardening (`src/lib/server/auth.ts`)
Removed the speculative `data?.user?.id` fallback in favor of validating the single documented `data.id` shape, and added an explicit error log when the Supabase URL/anon key is missing. This turns a silent misconfiguration into a visible failure.

### Recommendation timestamp/rank parsing (`src/lib/server/recommendationFilters.ts`)
Added `parseRecommendationTimestamp` and `parseRecommendationRank` that return `null` for missing/invalid values instead of collapsing to a `0` epoch or a coerced integer. The unique-recommendations route now skips books with unparseable timestamps and sorts them last via `compareBooksByLastRecommended`, rather than reporting a fake "Jan 1970" date.

### Redundant session re-fetch removed (`bootstrap-auth.ts`)
`getSessionAfterUrlTokens` now returns immediately after a single `getSession` when there is no URL token, and `return null` after the retry loop. This eliminated the always-redundant trailing `getSession()` call.

## Phase 3 — ESLint cleanup

### Unused variables and imports
Removed `genreOrder` (`scripts/seed-top-100.mjs`), the unused `Star`/`Book` imports (`BookCard.svelte`), the unused `book` parameter of `handleMainListAfterRate` (`rate/+page.svelte`), and the redundant `loading`/`timedOut` state (`recommendations/+page.svelte`, which already renders from `viewMode`). None of these were referenced, so there is no behavior change.

### AuthModal focus trap (`src/lib/components/AuthModal.svelte`)
Replaced the no-op `getFocusableElements(panelEl)[0]?.focus() ?? panelEl.focus()` expression with an explicit `if (first) first.focus(); else panelEl.focus();`. NOTE: this is an intentional behavior change — focus escaping the modal now lands on the first focusable element instead of always snapping to the panel container.

### SearchBar prop rename (`src/lib/components/SearchBar.svelte`)
Renamed the `'aria-label'` prop to `ariaLabel` to satisfy `svelte/no-unused-props`, and updated the only caller (`rate/+page.svelte`). The rendered `aria-label` attribute value is unchanged, so there is no accessibility/display difference.

### Unsafe finally (`src/lib/stores/ratings.ts`)
Inverted the `finally` block from an early `return` to an `if (activeFlushGeneration === currentFlushGeneration) { … }` guard. Cleanup still runs only when the flush was not superseded, but exceptions thrown in the `try` are no longer swallowed.

### Keyed each blocks (`book-card/BookRatingStarsRow.svelte`, `book-card/BookSummarySheetBody.svelte`)
Added keys to the star `{#each RATING_OPTIONS as value (value)}` loops (stable unique primitives) and the genre `{#each book.genres as genre (genre)}` loop. The genre key is safe because genres are now deduplicated at the source (see below).

### Genre deduplication (`src/lib/book-catalog-fields.ts`)
`genresFromGenreColumns` now tracks a `seen` set and skips repeated labels, so the genre array can never contain duplicates and the `(genre)` keyed each cannot throw a duplicate-key error. NOTE: minor display effect — a book with the same label in two genre slots now renders that chip once instead of twice.

### Svelte reactive collections (`RatingsBar.svelte`, `rate/+page.svelte`, `my-bookshelf/+page.svelte`)
Replaced native `Set`/`Map`/`URLSearchParams` with `SvelteSet`/`SvelteMap`/`SvelteURLSearchParams` from `svelte/reactivity`, declared without a redundant `$state` wrapper. Component-level collections are now correctly reactive on mutation; the remaining conversions are throwaway locals and are behavior-neutral.

### Navigation resolved through `$app/paths` (`Accordion`, `AppHeader`, `AppFooter`, `AppHeaderMobileMenuAction`, `Button`, `BookCard`, `RatingsBar`, `reset-password`, `my-bookshelf`, `rate`, `recommendations`)
Wrapped internal links and `goto`/`replaceState` targets in `resolve()` to satisfy `svelte/no-navigation-without-resolve`. Query-string navigations use targeted `eslint-disable` blocks so the resolved route still preserves its `request_id`/`filter` search params, leaving the resulting URLs functionally identical.
