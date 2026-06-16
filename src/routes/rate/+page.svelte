<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { SvelteSet, SvelteURLSearchParams } from 'svelte/reactivity';
	import { get } from 'svelte/store';
	import { browser } from '$app/environment';
	import { afterNavigate, beforeNavigate, goto, pushState, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import BookCard from '$lib/components/BookCard.svelte';
	import { ensureAnonymousSessionStarted } from '$lib/auth/anonymous-session';
	import { getSupabase } from '$lib/supabase';
	import { authStore, waitForAuthReady } from '$lib/stores/auth';
	import { refreshRecommendationsCountFromApi } from '$lib/stores/recommendationsCount';
	import {
		scheduleUserLibraryDetailsLoad,
		userLibraryHydrationStore
	} from '$lib/stores/userLibrary';
	import BookCardGridSkeleton from '$lib/components/BookCardGridSkeleton.svelte';
	import RatingsBar from '$lib/components/RatingsBar.svelte';
	import SearchBar from '$lib/components/SearchBar.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import Button from '$lib/components/Button.svelte';
	import { X } from 'lucide-svelte';
	import { getBookById } from '$lib/data/dummyBooks';
	import { mobileMenuOpen } from '$lib/stores/mobileMenu';
	import { ratingsStore } from '$lib/stores/ratings';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { rateBookSummaryHistory } from '$lib/stores/rateBookSummaryHistory';
	import {
		clearRateAuthorSearch,
		clearRateSearchExternalEntry,
		consumeRateAuthorSearch,
		consumeRateSearchExternalEntry,
		markRateAuthorSearch
	} from '$lib/rateSearchExternalNav';
	import { searchBooks, searchBooksByAuthor, SEARCH_MIN_QUERY_LENGTH } from '$lib/search';
	import { insertFeedRequestRow, pollCuratedFeedRequest } from '$lib/feed/warmCuratedFeed';
	import { t } from '$lib/copy';
	import type { Book, RatingValue } from '$lib/types/book';

	const SCROLL_THRESHOLD = 60;
	const FEED_PAGE_SIZE = 20;
	const EMPTY_PAGE_CHAIN_MAX = 25;
	/** After a new feed batch mounts, ignore strict “end of list” briefly so a sentinel already at the viewport bottom does not clear `hasMore` before the user can interact. */
	const STRICT_FEED_END_GRACE_MS = 750;

	type LatestFeedMode = 'newer_completed' | 'cold_start' | 'exhausted';
	type LatestFeedStateResponse = {
		mode: LatestFeedMode;
		books: Book[];
		request_id: string | null;
		latest_request_id: string | null;
		latest_request_status: string | null;
		status: string;
		error_message: string | null;
	};

	// ── Search ─────────────────────────────────────────────────────────────────
	let searchQuery = $state('');
	let debouncedQuery = $state('');
	const normalizedDebouncedQuery = $derived(debouncedQuery.trim());
	/** Author pill uses exact DB match; typed search uses Meilisearch. */
	let searchMode = $state<'fulltext' | 'author'>('fulltext');
	/** Author name from the last pill click; edits to the query reset to fulltext. */
	let authorSearchAnchor = $state('');
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	/**
	 * Bumped only when a new first-page search starts so pagination requests do not
	 * invalidate an in-flight initial load (and vice versa).
	 */
	let searchRequestGeneration = 0;

	/** Ratings drawer instance: shallow-history sync on browser Back (see `onWindowPopstate`). */
	let ratingsBar:
		| {
				closeRatingsDrawerDetailFromBrowserBack: () => boolean;
				syncRatingsBarFromHistoryState: (state: App.PageState) => void;
		  }
		| undefined = $state(undefined);

	$effect(() => {
		const q = searchQuery;
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debouncedQuery = q;
		}, 300);
		return () => {
			if (debounceTimer) clearTimeout(debounceTimer);
		};
	});

	$effect(() => {
		const q = searchQuery.trim();
		if (searchMode === 'author' && q.toLowerCase() !== authorSearchAnchor.toLowerCase()) {
			searchMode = 'fulltext';
		}
	});

	$effect(() => {
		const q = normalizedDebouncedQuery;
		const mode = searchMode;
		const active = q.length > 0 && (mode === 'author' || q.length >= SEARCH_MIN_QUERY_LENGTH);
		if (active) {
			doSearch(q, 0, mode);
		} else {
			searchResults = [];
			searchNextOffset = 0;
			searchHasMore = false;
			searchError = null;
		}
	});

	const isSearching = $derived.by(() => {
		const q = normalizedDebouncedQuery;
		if (q.length === 0) return false;
		if (searchMode === 'author') return true;
		return q.length >= SEARCH_MIN_QUERY_LENGTH;
	});

	let searchOverlayOpen = $state(false);
	let inertSupported = $state(true);
	let overlayDialogEl = $state<HTMLDivElement | undefined>(undefined);
	let overlaySearchBar = $state<{ focusInput: () => void } | undefined>(undefined);

	let savedScrollY = $state(0);

	/** Bumped when a new search overlay session starts; stale feed refreshes ignore flag writes. */
	let searchFeedSessionId = $state(0);
	/** First qualifying mutation consumed the one in-session warm-feed attempt. */
	let searchSessionFeedRefreshIssued = $state(false);
	let searchSessionFeedRefreshInFlightPromise: Promise<void> | null = null;

	function resetSearchSessionFeedFlags() {
		searchFeedSessionId += 1;
		searchSessionFeedRefreshIssued = false;
	}

	function captureFeedScrollForSearchReturn() {
		if (searchOverlayOpen) return;
		savedScrollY = Math.max(savedScrollY, window.scrollY);
	}

	function replaceShallowPageState(next: App.PageState) {
		if (!browser) return;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- preserve search in shallow routing
		replaceState(`${resolve('/rate')}${get(page).url.search}`, next);
	}

	/** Compare location to resolved /rate (includes `base`). */
	function locationIsRatePage(): boolean {
		try {
			return new URL(resolve('/rate'), location.href).pathname === location.pathname;
		} catch {
			return false;
		}
	}

	function focusOverlaySearchInput() {
		overlaySearchBar?.focusInput();
		const input = overlayDialogEl?.querySelector<HTMLInputElement>(
			'.rate-search-overlay__search-row .search-bar__input'
		);
		input?.focus({ preventScroll: true });
	}

	/** Run after the overlay DOM and `bind:this` exist; beats `goto(..., { keepFocus: true })` leaving focus on the toolbar. */
	async function queueFocusOverlaySearch() {
		await tick();
		await tick();
		requestAnimationFrame(() => {
			focusOverlaySearchInput();
			requestAnimationFrame(() => focusOverlaySearchInput());
		});
	}

	async function openSearchOverlay(opts?: { pushHistory?: boolean }) {
		savedScrollY = Math.max(savedScrollY, window.scrollY);
		if (opts?.pushHistory === true && browser) {
			clearRateSearchExternalEntry();
		}
		const wasOpen = searchOverlayOpen;
		/** Only push when transitioning closed → open so we never `history.back()` from UI (fragile vs real stack). */
		const shouldPush = opts?.pushHistory === true && browser && !wasOpen;
		if (shouldPush) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- preserve search in shallow routing
			pushState(`${resolve('/rate')}${get(page).url.search}`, { rateSearchLayer: true });
		}
		if (!wasOpen) {
			resetSearchSessionFeedFlags();
		}
		searchOverlayOpen = true;
		await queueFocusOverlaySearch();
	}

	function blurSearchOverlayIfFocused() {
		if (!browser || !overlayDialogEl) return;
		const a = document.activeElement;
		if (a instanceof HTMLElement && overlayDialogEl.contains(a)) {
			a.blur();
		}
	}

	function restoreFeedScrollAfterOverlayClose() {
		void tick().then(() => {
			requestAnimationFrame(() => {
				window.scrollTo({ top: savedScrollY, left: 0, behavior: 'auto' });
			});
		});
	}

	function clearSearchResultsState() {
		searchResults = [];
		searchNextOffset = 0;
		searchHasMore = false;
		searchError = null;
		loadingSearch = false;
		loadingSearchMore = false;
	}

	/**
	 * @param fromPopstate - History step was already applied (browser Back). Skip a second `history.back()` for external entry; still sync URL when staying on `/rate`.
	 */
	function closeSearchOverlay(opts?: { fromPopstate?: boolean }) {
		if (!searchOverlayOpen) return;
		blurSearchOverlayIfFocused();
		searchOverlayOpen = false;
		searchQuery = '';
		debouncedQuery = '';
		searchMode = 'fulltext';
		authorSearchAnchor = '';
		clearRateAuthorSearch();
		clearSearchResultsState();

		if (browser && consumeRateSearchExternalEntry()) {
			if (opts?.fromPopstate) {
				void goto(resolve('/rate'), { replaceState: true, noScroll: true, keepFocus: false });
				restoreFeedScrollAfterOverlayClose();
				return;
			}
			history.back();
			return;
		}

		/**
		 * On /rate-only search: replace the current history entry to `/rate` (no `q`).
		 * `keepFocus: false` avoids leaving focus on the overlay input while it unmounts.
		 */
		void goto(resolve('/rate'), { replaceState: true, noScroll: true, keepFocus: false });
		restoreFeedScrollAfterOverlayClose();
	}

	/**
	 * Single place to align overlays / bookshelf with `$page.state` after the user goes Back.
	 * Must run when `page.state` is already updated:
	 * - For shallow `pushState` pops, SvelteKit updates `page` synchronously — `queueMicrotask` is enough.
	 * - After a full reload, Back often takes the `navigate({ type: 'popstate' })` path; then `page`
	 *   updates only when navigation finishes — use `afterNavigate` (see below), not only microtasks.
	 */
	function syncRatePageShallowHistoryAfterPopstate() {
		if (!browser || !locationIsRatePage()) return;
		const st = get(page).state as App.PageState;

		if (!get(rateBookSummaryHistory) && st.rateBookSummaryLayer === true) {
			const next = { ...st };
			delete next.rateBookSummaryLayer;
			replaceShallowPageState(next);
			return;
		}

		const bookH = get(rateBookSummaryHistory);
		if (bookH && st.rateBookSummaryLayer !== true) {
			bookH.applyClose();
			rateBookSummaryHistory.set(null);
			return;
		}

		if (!searchOverlayOpen && st.rateSearchLayer === true) {
			const next = { ...st };
			delete next.rateSearchLayer;
			replaceShallowPageState(next);
			return;
		}

		if (searchOverlayOpen && st.rateSearchLayer !== true) {
			closeSearchOverlay({ fromPopstate: true });
			return;
		}

		ratingsBar?.syncRatingsBarFromHistoryState(st);
	}

	function closeBookSummaryFromBrowserBack(): boolean {
		const bookH = get(rateBookSummaryHistory);
		if (!bookH) return false;
		bookH.applyClose();
		rateBookSummaryHistory.set(null);
		return true;
	}

	function closeRatingsDrawerDetailFromBrowserBack(): boolean {
		return ratingsBar?.closeRatingsDrawerDetailFromBrowserBack() === true;
	}

	async function handleSearchAuthor(author: string) {
		clearRateSearchExternalEntry();
		savedScrollY = Math.max(savedScrollY, window.scrollY);
		const trimmed = author.trim();
		if (browser && trimmed) {
			markRateAuthorSearch(trimmed);
		}
		searchMode = 'author';
		authorSearchAnchor = trimmed;
		searchQuery = trimmed;
		debouncedQuery = trimmed;
		if (!searchOverlayOpen) {
			await openSearchOverlay({ pushHistory: true });
		}
		if (browser && trimmed) {
			const active = document.activeElement;
			const inOverlay =
				overlayDialogEl != null && active instanceof Node && overlayDialogEl.contains(active);
			await goto(resolve(`/rate?q=${encodeURIComponent(trimmed)}`), {
				replaceState: true,
				noScroll: true,
				keepFocus: inOverlay
			});
			await queueFocusOverlaySearch();
		}
	}

	beforeNavigate(({ from, to, willUnload }) => {
		if (!browser || willUnload) return;
		const toPath = to?.url.pathname;
		if (!toPath) return;
		if (from?.url.pathname === '/rate' && toPath !== '/rate') {
			clearRateSearchExternalEntry();
			clearRateAuthorSearch();
		}
	});

	afterNavigate((nav) => {
		if (nav.to?.url.pathname !== '/rate') return;

		if (nav.type === 'enter') {
			clearRateSearchExternalEntry();
		}

		if (nav.type === 'popstate' && nav.delta === -1) {
			syncRatePageShallowHistoryAfterPopstate();
			return;
		}

		const q = nav.to.url.searchParams.get('q')?.trim();
		if (q) {
			const wasOpen = searchOverlayOpen;
			searchOverlayOpen = true;
			if (!wasOpen) {
				resetSearchSessionFeedFlags();
			}
			const authorAnchor = consumeRateAuthorSearch();
			if (authorAnchor && authorAnchor.toLowerCase() === q.toLowerCase()) {
				searchMode = 'author';
				authorSearchAnchor = authorAnchor;
			} else if (searchMode !== 'author' || authorSearchAnchor.toLowerCase() !== q.toLowerCase()) {
				searchMode = 'fulltext';
				authorSearchAnchor = '';
			}
			if (searchQuery.trim() !== q) {
				searchQuery = q;
				debouncedQuery = q;
			}
			void queueFocusOverlaySearch();
		}
	});

	$effect(() => {
		if (!browser || !searchOverlayOpen) return;
		void overlayDialogEl;
		const q = normalizedDebouncedQuery;
		const cur = $page.url;
		const curQ = cur.searchParams.get('q')?.trim() ?? '';
		if (cur.pathname === '/rate' && curQ === q) return;
		const active = document.activeElement;
		const keepFocus =
			active instanceof Node && overlayDialogEl != null && overlayDialogEl.contains(active);
		/* eslint-disable svelte/no-navigation-without-resolve -- sync overlay URL with search query */
		void goto(q.length > 0 ? `${resolve('/rate')}?q=${encodeURIComponent(q)}` : resolve('/rate'), {
			replaceState: true,
			noScroll: true,
			keepFocus
		});
		/* eslint-enable svelte/no-navigation-without-resolve */
	});

	$effect(() => {
		if (!browser) return;
		if (searchOverlayOpen) {
			document.documentElement.classList.add('rate-page--search-open');
			document.body.classList.add('rate-page--search-open');
		} else {
			document.documentElement.classList.remove('rate-page--search-open');
			document.body.classList.remove('rate-page--search-open');
		}
	});

	const searchStatusMessage = $derived.by(() => {
		if (!searchOverlayOpen) return '';
		if (searchError) return '';
		const raw = normalizedDebouncedQuery;
		if (raw.length === 0) return t('rate.search.minCharsHint');
		if (raw.length < SEARCH_MIN_QUERY_LENGTH && searchMode !== 'author') return '';
		if (loadingSearch) return t('rate.search.statusSearching');
		/** Skip updates while appending so `aria-live` does not re-announce the count every page. */
		if (loadingSearchMore) return '';
		if (searchResults.length === 0) return t('rate.search.statusNoResults');
		return t('rate.search.statusResults', { count: searchResults.length });
	});

	let lastScrollY = $state(0);
	let headerVisible = $state(true);

	// ── Main list ───────────────────────────────────────────────────────────────
	let popularBooks = $state<Book[]>([]);
	let nextOffset = $state(0);
	let hasMore = $state(true);
	let popularSeed = $state<string | null>(null);
	let popularContinuationOffset = $state(0);
	let loadingInitial = $state(true);
	let loadingMore = $state(false);
	let popularError = $state<string | null>(null);

	let startedFromLatestFeed = $state(false);
	let everHadSessionSignal = $state(false);
	let lastAppendWasFeed = $state(false);
	let engagedWithPendingBatch = $state(false);
	let suppressStrictFeedEndUntil = $state(0);
	/** Cold `loadInitialMainList` used Top 100 because no access token was ready in time; retry feed once auth exists. */
	let mainListFellBackDueToMissingAuthToken = $state(false);
	let initialListDecisionSettled = $state(false);
	let initialMainListLoadInFlight: Promise<void> | null = null;

	let mainListPrefetchPx = $state(600);

	const paginationFeedOnly = $derived(startedFromLatestFeed || everHadSessionSignal);

	const showMainListLoadMoreTile = $derived.by(() => {
		if (popularBooks.length === 0 || loadingInitial) return false;
		return !hasMore || (paginationFeedOnly && lastAppendWasFeed && !engagedWithPendingBatch);
	});

	function armFeedBatchStrictGrace() {
		suppressStrictFeedEndUntil = Date.now() + STRICT_FEED_END_GRACE_MS;
	}

	/**
	 * After “end of list” (`hasMore` false) — Top 100, latest curated hydrate, or strict feed end —
	 * re-open the sentinel when the user engages so `loadCuratedFeedBatch` can run (popular path
	 * switches to feed once `everHadSessionSignal` is set).
	 */
	function reviveMainListPaginationAfterEngagement() {
		if (hasMore) return;
		if (!(startedFromLatestFeed || everHadSessionSignal)) return;
		hasMore = true;
		armFeedBatchStrictGrace();
	}

	/** Explicit “load more” — same loaders as infinite scroll; does not change rating / not-interested revival rules. */
	function handleManualLoadMoreBooks() {
		if (loadingMore || loadingInitial) return;
		if (paginationFeedOnly) {
			if (lastAppendWasFeed) engagedWithPendingBatch = true;
			armFeedBatchStrictGrace();
			void loadCuratedFeedBatch();
			return;
		}
		void loadPopular(nextOffset, 0);
	}

	/** Search unlocks feed pagination and revives a ended main list (Top 100, curated, or strict end). */
	$effect(() => {
		const q = searchQuery.trim();
		const searching = isSearching;
		if (q.length === 0 && !searching) return;
		everHadSessionSignal = true;
		if (lastAppendWasFeed) engagedWithPendingBatch = true;
		reviveMainListPaginationAfterEngagement();
	});

	let searchResults = $state<Book[]>([]);
	let searchNextOffset = $state(0);
	let searchHasMore = $state(false);
	let loadingSearch = $state(false);
	let loadingSearchMore = $state(false);
	let searchError = $state<string | null>(null);

	let sentinelEl = $state<HTMLDivElement | undefined>(undefined);
	/** Scroll container for search results (`overflow-y: auto`); load-more uses this, not the viewport. */
	let searchOverlayScrollEl = $state<HTMLDivElement | undefined>(undefined);

	const SEARCH_SCROLL_LOAD_THRESHOLD_PX = 360;

	/**
	 * Two observers: a large bottom rootMargin prefetches the next page while the user is still
	 * ~3 viewports away, but that same margin makes the sentinel "intersect" while it is still far
	 * below the fold — which incorrectly fired `!engaged` and cleared `hasMore` before the user
	 * could rate. Preload observer only fetches when engagement rules pass; a strict (0px) observer
	 * alone ends the list when the user actually reaches the viewport bottom without engaging.
	 */
	$effect(() => {
		if (!sentinelEl) return;
		void suppressStrictFeedEndUntil;
		const prefetch = mainListPrefetchPx;
		const next = nextOffset;
		const more = hasMore;
		const loading = loadingMore;
		const initial = loadingInitial;
		const overlayBlocksFeed = searchOverlayOpen;
		const feedOnly = paginationFeedOnly;
		const lastFeed = lastAppendWasFeed;
		const engaged = engagedWithPendingBatch;

		const preloadObserver = new IntersectionObserver(
			(entries) => {
				if (!entries[0].isIntersecting || loading || initial || overlayBlocksFeed || !more) return;
				if (!feedOnly) {
					void loadPopular(next, 0);
					return;
				}
				if (lastFeed && !engaged) return;
				void loadCuratedFeedBatch();
			},
			{ rootMargin: `0px 0px ${prefetch}px 0px` }
		);

		const strictEndObserver = new IntersectionObserver(
			(entries) => {
				if (!entries[0].isIntersecting || loading || initial || overlayBlocksFeed || !more) return;
				if (Date.now() < suppressStrictFeedEndUntil) return;
				if (feedOnly && lastFeed && !engaged) {
					hasMore = false;
				}
			},
			{ rootMargin: '0px' }
		);

		preloadObserver.observe(sentinelEl);
		strictEndObserver.observe(sentinelEl);
		return () => {
			preloadObserver.disconnect();
			strictEndObserver.disconnect();
		};
	});

	/**
	 * Search results live in a nested scroll container (not the viewport). IntersectionObserver
	 * with the default viewport root misses that, and re-creating observers on every offset/load
	 * change drops “already intersecting” targets so the next page never fires — so we use scroll.
	 */
	function tryLoadMoreSearchNearBottom() {
		if (!browser) return;
		const root = searchOverlayScrollEl;
		if (!root || !searchOverlayOpen) return;
		if (!searchHasMore || loadingSearch || loadingSearchMore || searchError) return;
		const q = normalizedDebouncedQuery;
		if (!isSearching) return;
		const distance = root.scrollHeight - root.scrollTop - root.clientHeight;
		if (distance <= SEARCH_SCROLL_LOAD_THRESHOLD_PX) {
			void doSearch(q, searchNextOffset, searchMode);
		}
	}

	$effect(() => {
		if (!browser) return;
		if (!searchOverlayScrollEl || !searchOverlayOpen || !isSearching) return;
		const el = searchOverlayScrollEl;
		let raf = 0;
		const onScroll = () => {
			if (raf) return;
			raf = requestAnimationFrame(() => {
				raf = 0;
				tryLoadMoreSearchNearBottom();
			});
		};
		el.addEventListener('scroll', onScroll, { passive: true });
		queueMicrotask(onScroll);
		return () => {
			el.removeEventListener('scroll', onScroll);
			if (raf) cancelAnimationFrame(raf);
		};
	});

	function findBookById(id: string): Book | undefined {
		const rated = ratingsStore.getRatedBook(id);
		const fromPopular = popularBooks.find((b) => b.id === id);
		const fromSearch = searchResults.find((b) => b.id === id);
		const fromDummy = getBookById(id);

		const base = rated ?? fromPopular ?? fromSearch ?? fromDummy;
		if (!base) return undefined;

		const candidates = [rated, fromPopular, fromSearch, fromDummy].filter(
			(b): b is Book => b != null
		);

		const longestSummary = (): string | undefined => {
			let best: string | undefined;
			let bestLen = 0;
			for (const b of candidates) {
				const trimmed = b.summary?.trim();
				if (trimmed && trimmed.length > bestLen) {
					best = b.summary;
					bestLen = trimmed.length;
				}
			}
			return best;
		};

		const firstNonEmpty = (pick: (b: Book) => string | undefined): string | undefined => {
			for (const b of candidates) {
				const v = pick(b);
				if (v != null && v.trim() !== '') return v;
			}
			return undefined;
		};

		const richestGenres = (): string[] | undefined => {
			let best: string[] | undefined;
			let bestLen = 0;
			for (const b of candidates) {
				const g = b.genres;
				const len = g?.length ?? 0;
				if (len > bestLen) {
					best = g;
					bestLen = len;
				}
			}
			return best;
		};

		const mergedSummary = longestSummary();
		const mergedCover =
			base.coverUrl != null && base.coverUrl.trim() !== ''
				? base.coverUrl
				: (firstNonEmpty((b) => b.coverUrl) ?? base.coverUrl);
		const mergedYear =
			base.year != null && base.year.trim() !== ''
				? base.year
				: (firstNonEmpty((b) => b.year) ?? base.year);
		const mergedGenres =
			(base.genres?.length ?? 0) > 0 ? base.genres : (richestGenres() ?? base.genres);
		const mergedType = base.type ?? candidates.find((b) => b.type)?.type;

		return {
			...base,
			summary: mergedSummary ?? base.summary,
			coverUrl: mergedCover,
			year: mergedYear,
			genres: mergedGenres,
			type: mergedType ?? base.type
		};
	}

	/** Resolve a book by ULID `book_id` for ratings drawer (NI tab, etc.). */
	function findBookByBookId(bookUlid: string): Book | undefined {
		if (!bookUlid) return undefined;
		for (const bookId of get(ratingsStore).keys()) {
			const b = ratingsStore.getRatedBook(bookId);
			if (b?.book_id === bookUlid) return b;
		}
		const fromPopular = popularBooks.find((b) => b.book_id === bookUlid);
		if (fromPopular) return fromPopular;
		return searchResults.find((b) => b.book_id === bookUlid);
	}

	const ratedEntries = $derived(
		Array.from($ratingsStore.entries())
			.map(([bookId, rating]) => {
				const book = findBookById(bookId);
				return book ? { book, rating } : null;
			})
			.filter((e): e is { book: Book; rating: RatingValue } => e !== null)
	);

	const MIN_RATINGS_FOR_RECOMMENDATIONS = 10;

	const libraryIdsReady = $derived.by(() => {
		const user = $authStore.user;
		const hydration = $userLibraryHydrationStore;
		if (!user?.id) return true;
		if (hydration.userId !== user.id) return false;
		return hydration.idsReady;
	});

	const ratingsSyncMeta = ratingsStore.syncMeta;
	const ratedCount = $derived($ratingsStore.size);
	const canGetRecommendations = $derived(ratedCount >= MIN_RATINGS_FOR_RECOMMENDATIONS);
	/** No queued rating writes and not mid-flush — safe to start a recommendations run. */
	const ratingsSyncedForRecommendations = $derived(
		$ratingsSyncMeta.queuedCount === 0 && !$ratingsSyncMeta.isFlushing
	);
	type BottomBarDisplayState = {
		userId: string | null;
		triggerCount: number;
		canGetRecommendations: boolean;
		recommendationsLabel: string;
	};

	let bottomBarDisplayState = $state<BottomBarDisplayState | null>(null);
	let bottomBarConfirmedRatedCount = $state(0);
	let bottomBarDisplayUserId = $state<string | null>(null);
	const bottomBarUserId = $derived($authStore.user?.id ?? null);
	const ratingsSyncFailedForRecommendations = $derived(
		$ratingsSyncMeta.queuedCount > 0 &&
			!$ratingsSyncMeta.isFlushing &&
			$ratingsSyncMeta.failedCount > 0
	);

	function recommendationsLabelForCount(count: number): string {
		const remaining = Math.max(0, MIN_RATINGS_FOR_RECOMMENDATIONS - count);
		if (remaining === 0) return t('rate.getRecommendations');
		if (remaining === 1) return t('rate.remainingToRecommend_one');
		return t('rate.remainingToRecommend_other', { remaining });
	}

	function recommendationsDisplayCount(): number {
		if (ratingsSyncedForRecommendations) return ratedCount;
		if (ratingsSyncFailedForRecommendations) return bottomBarConfirmedRatedCount;
		if (ratedCount >= MIN_RATINGS_FOR_RECOMMENDATIONS) {
			return MIN_RATINGS_FOR_RECOMMENDATIONS - 1;
		}
		return ratedCount;
	}

	$effect(() => {
		const userId = bottomBarUserId;
		if (bottomBarDisplayUserId !== userId) {
			bottomBarDisplayUserId = userId;
			bottomBarDisplayState = null;
			bottomBarConfirmedRatedCount = 0;
		}
		if (!libraryIdsReady) return;
		if (ratingsSyncedForRecommendations && bottomBarConfirmedRatedCount !== ratedCount) {
			bottomBarConfirmedRatedCount = ratedCount;
		}
		if (ratedCount < 1) {
			bottomBarDisplayState = null;
			return;
		}
		const recommendationCount = recommendationsDisplayCount();
		const nextState = {
			userId,
			triggerCount: ratedCount,
			canGetRecommendations:
				ratingsSyncedForRecommendations && ratedCount >= MIN_RATINGS_FOR_RECOMMENDATIONS,
			recommendationsLabel: recommendationsLabelForCount(recommendationCount)
		};
		if (
			bottomBarDisplayState?.triggerCount === nextState.triggerCount &&
			bottomBarDisplayState.canGetRecommendations === nextState.canGetRecommendations &&
			bottomBarDisplayState.recommendationsLabel === nextState.recommendationsLabel
		) {
			return;
		}
		bottomBarDisplayState = nextState;
	});

	/** Resolve access token after layout session restore; optionally start lazy anonymous sign-in. */
	async function resolveAccessToken(opts?: { lazyAnonymous?: boolean }): Promise<string | null> {
		await waitForAuthReady();
		let token = get(authStore).session?.access_token ?? null;
		if (token || opts?.lazyAnonymous !== true) return token;
		await ensureAnonymousSessionStarted();
		return get(authStore).session?.access_token ?? null;
	}

	async function fetchLatestFeedState(token: string): Promise<LatestFeedStateResponse> {
		const url = new URL(resolve('/api/feed/latest'), location.href);
		const res = await fetch(url.toString(), {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!res.ok) {
			throw new Error(`Failed to load latest feed state: HTTP ${res.status}`);
		}
		return (await res.json()) as LatestFeedStateResponse;
	}

	function mainListKey(book: Book): string {
		return `book:${book.book_id}`;
	}

	function filterReactedBooksForRateFeed(books: Book[]): Book[] {
		const ratings = get(ratingsStore);
		const notInterested = get(notInterestedStore);
		const bookmarks = get(planToReadStore);

		return books.filter((book) => {
			const bookId = book.book_id;
			return !ratings.has(book.id) && !notInterested.has(bookId) && !bookmarks.has(book.id);
		});
	}

	/** Assign main list from API payload; append keeps the rendered keyspace unique. */
	function setMainListBooks(incoming: Book[], mode: 'replace' | 'append'): Book[] {
		const eligibleBooks = filterReactedBooksForRateFeed(incoming);
		if (mode === 'replace') {
			popularBooks = eligibleBooks;
			return eligibleBooks;
		}

		const existing = new Set(popularBooks.map(mainListKey));
		const appended = eligibleBooks.filter((book) => !existing.has(mainListKey(book)));
		popularBooks = [...popularBooks, ...appended];
		return appended;
	}

	function armPendingFeedBatchEngagement() {
		engagedWithPendingBatch = false;
		armFeedBatchStrictGrace();
	}

	function commitInitialCuratedChoice(books: Book[]) {
		initialListDecisionSettled = true;
		mainListFellBackDueToMissingAuthToken = false;
		startedFromLatestFeed = true;
		setMainListBooks(books, 'replace');
		lastAppendWasFeed = true;
		armPendingFeedBatchEngagement();
		hasMore = true;
	}

	async function commitInitialTop100Choice(skipInitialLoading: boolean) {
		initialListDecisionSettled = true;
		startedFromLatestFeed = false;
		await loadPopular(0, 0, { skipInitialLoading });
	}

	async function ensureAnonymousSessionIfNeeded(): Promise<void> {
		if (get(authStore).session) return;
		await ensureAnonymousSessionStarted();
		await tick();
	}

	async function runSearchSessionFeedRefreshAfterLibraryMutation() {
		await ensureAnonymousSessionIfNeeded();
		scheduleSearchSessionFeedRefresh();
	}

	function handleMainListAfterRate() {
		everHadSessionSignal = true;
		if (lastAppendWasFeed) engagedWithPendingBatch = true;
		reviveMainListPaginationAfterEngagement();
		void ensureAnonymousSessionIfNeeded();
	}

	function handleRateBookmark(book: Book, id: string) {
		const wasBookmarked = planToReadStore.has(book.id);
		planToReadStore.toggle(id, book.book_id);
		if (!wasBookmarked) {
			notInterestedStore.remove(book.book_id);
		}
		if (searchOverlayOpen) {
			void runSearchSessionFeedRefreshAfterLibraryMutation();
		} else {
			void ensureAnonymousSessionIfNeeded();
		}
	}

	function handleMainListNotInterested(book: Book) {
		const bid = book.book_id;
		const now = notInterestedStore.toggle(bid);
		if (now) {
			if (planToReadStore.has(book.id)) {
				planToReadStore.toggle(book.id, book.book_id);
			}
			if (get(ratingsStore).has(book.id)) {
				ratingsStore.removeRating(book.id, book.book_id);
			}
			everHadSessionSignal = true;
			if (lastAppendWasFeed) engagedWithPendingBatch = true;
			reviveMainListPaginationAfterEngagement();
		}
		void ensureAnonymousSessionIfNeeded();
		if (searchOverlayOpen) {
			void runSearchSessionFeedRefreshAfterLibraryMutation();
		}
	}

	function handleSearchAfterRate() {
		everHadSessionSignal = true;
		if (lastAppendWasFeed) engagedWithPendingBatch = true;
		reviveMainListPaginationAfterEngagement();
		void runSearchSessionFeedRefreshAfterLibraryMutation();
	}

	function handleSearchNotInterested(book: Book) {
		const bid = book.book_id;
		const now = notInterestedStore.toggle(bid);
		if (now) {
			if (planToReadStore.has(book.id)) {
				planToReadStore.toggle(book.id, book.book_id);
			}
			if (get(ratingsStore).has(book.id)) {
				ratingsStore.removeRating(book.id, book.book_id);
			}
			everHadSessionSignal = true;
			if (lastAppendWasFeed) engagedWithPendingBatch = true;
			reviveMainListPaginationAfterEngagement();
		}
		void runSearchSessionFeedRefreshAfterLibraryMutation();
	}

	function scheduleSearchSessionFeedRefresh() {
		if (!searchOverlayOpen) return;
		if (searchSessionFeedRefreshIssued) return;
		searchSessionFeedRefreshIssued = true;
		beginSearchSessionFeedRefresh();
	}

	function beginSearchSessionFeedRefresh() {
		if (searchSessionFeedRefreshInFlightPromise != null) return;
		const sid = searchFeedSessionId;
		const p = refreshMainFeedAfterSearchSession({ sid });
		searchSessionFeedRefreshInFlightPromise = p.finally(() => {
			searchSessionFeedRefreshInFlightPromise = null;
		});
	}

	/**
	 * Persist ratings, insert one `feed_requests` row per search session, and poll until complete.
	 * This intentionally does not replace the current visible `/rate` list mid-session.
	 */
	async function refreshMainFeedAfterSearchSession(opts: { sid: number }) {
		const { sid } = opts;

		try {
			await resolveAccessToken({ lazyAnonymous: true });
			if (sid !== searchFeedSessionId) return;
			await tick();

			await ratingsStore.flushPending();
			await planToReadStore.flushPending();
			await notInterestedStore.flushPending();
			if (sid !== searchFeedSessionId) return;

			const token = get(authStore).session?.access_token ?? null;
			if (!token) return;

			const supabase = getSupabase();
			const user = get(authStore).user;
			if (!supabase || !user?.id) return;

			if (sid !== searchFeedSessionId) return;
			const requestId = await insertFeedRequestRow(supabase, user.id);
			if (sid !== searchFeedSessionId) return;

			if (requestId == null) return;

			await pollCuratedFeedRequest(requestId, token);
			if (sid !== searchFeedSessionId) return;
		} catch (e) {
			console.error('[rate] refreshMainFeedAfterSearchSession', e);
		}
	}

	function scheduleLibraryHydrationAfterFirstList() {
		const userId = get(authStore).user?.id;
		scheduleUserLibraryDetailsLoad(userId);
		const token = get(authStore).session?.access_token ?? null;
		if (token) void refreshRecommendationsCountFromApi(token);
	}

	function resolveExhaustedFeedRefreshRequestId(feedState: LatestFeedStateResponse): string | null {
		const latestId = feedState.latest_request_id;
		const latestStatus = feedState.latest_request_status;
		const completedId = feedState.request_id;
		if (!latestId || !latestStatus || latestId === completedId) return null;
		if (latestStatus === 'completed' || latestStatus === 'failed' || latestStatus === 'skipped') {
			return null;
		}
		return latestId;
	}

	async function commitInitialExhaustedFeedChoice(
		skipInitialLoading: boolean,
		feedState: LatestFeedStateResponse
	): Promise<boolean> {
		const token = get(authStore).session?.access_token ?? null;
		const supabase = getSupabase();
		const user = get(authStore).user;
		if (!token || !supabase || !user?.id) return false;

		const requestId =
			resolveExhaustedFeedRefreshRequestId(feedState) ??
			(await insertFeedRequestRow(supabase, user.id));
		if (requestId == null) return false;

		const outcome = await pollCuratedFeedRequest(requestId, token);
		if (outcome.kind === 'completed' && outcome.books.length > 0) {
			commitInitialCuratedChoice(outcome.books);
			return true;
		}
		return false;
	}

	async function loadInitialMainListInternal(listOpts?: { skipInitialLoading?: boolean }) {
		const skip = listOpts?.skipInitialLoading === true;
		if (!skip) {
			loadingInitial = true;
		}
		popularError = null;

		try {
			const token = await resolveAccessToken();
			if (!token) {
				mainListFellBackDueToMissingAuthToken = true;
				await commitInitialTop100Choice(skip);
				scheduleLibraryHydrationAfterFirstList();
				return;
			}

			mainListFellBackDueToMissingAuthToken = false;
			const data = await fetchLatestFeedState(token);

			if (data.mode === 'newer_completed' && data.books.length > 0) {
				commitInitialCuratedChoice(data.books);
				scheduleLibraryHydrationAfterFirstList();
				return;
			}

			if (data.mode === 'exhausted') {
				const refreshed = await commitInitialExhaustedFeedChoice(skip, data);
				if (refreshed) {
					scheduleLibraryHydrationAfterFirstList();
					return;
				}
			}

			await commitInitialTop100Choice(skip);
			scheduleLibraryHydrationAfterFirstList();
		} catch {
			await commitInitialTop100Choice(skip);
			scheduleLibraryHydrationAfterFirstList();
		} finally {
			if (!skip) {
				loadingInitial = false;
			}
		}
	}

	function loadInitialMainList(listOpts?: { skipInitialLoading?: boolean }) {
		if (initialMainListLoadInFlight != null) {
			return initialMainListLoadInFlight;
		}
		const p = loadInitialMainListInternal(listOpts).finally(() => {
			if (initialMainListLoadInFlight === p) {
				initialMainListLoadInFlight = null;
			}
		});
		initialMainListLoadInFlight = p;
		return p;
	}

	$effect(() => {
		if (!browser) return;
		if (initialListDecisionSettled) return;
		if (!mainListFellBackDueToMissingAuthToken) return;
		if (!$authStore.session?.access_token) return;
		if (isSearching) return;
		if (loadingInitial) return;
		void loadInitialMainList();
	});

	async function loadPopular(
		offset: number,
		depth: number,
		loadOpts?: { skipInitialLoading?: boolean }
	) {
		if (depth > EMPTY_PAGE_CHAIN_MAX) {
			hasMore = false;
			return;
		}
		const skipInit = offset === 0 && loadOpts?.skipInitialLoading === true;
		if (offset === 0 && !skipInit) {
			loadingInitial = true;
		} else if (offset !== 0) {
			loadingMore = true;
		}
		popularError = null;

		try {
			const params = new SvelteURLSearchParams({ offset: String(offset) });
			if (popularSeed) params.set('seed', popularSeed);
			if (offset >= 100 && popularBooks.length > 0) {
				const exclude = popularBooks
					.map((b) => b.book_id)
					.filter(Boolean)
					.join(',');
				if (exclude) params.set('exclude', exclude);
			}
			const headers: Record<string, string> = {};
			const accessToken = get(authStore).session?.access_token ?? null;
			if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
			const res = await fetch(`${resolve('/api/books/popular')}?${params.toString()}`, { headers });
			if (!res.ok) {
				if (offset > 0) hasMore = false;
				throw new Error(`HTTP ${res.status}`);
			}
			const data: { books: Book[]; nextOffset: number; hasMore: boolean; seed?: string } =
				await res.json();

			const mode = offset === 0 ? 'replace' : 'append';
			setMainListBooks(data.books, mode);
			if (offset === 0 && data.seed) popularSeed = data.seed;

			nextOffset = data.nextOffset;
			popularContinuationOffset = data.nextOffset;
			lastAppendWasFeed = false;
			engagedWithPendingBatch = false;

			hasMore = data.hasMore ?? data.books.length > 0;

			if (data.books.length === 0 && hasMore) {
				await loadPopular(data.nextOffset, depth + 1);
				return;
			}
		} catch {
			popularError = t('rate.errors.loadBooks');
			if (offset > 0) hasMore = false;
		} finally {
			if (offset === 0 && !skipInit) {
				loadingInitial = false;
			} else if (offset !== 0) {
				loadingMore = false;
			}
		}
	}

	async function loadCuratedFeedBatch() {
		if (loadingMore || loadingInitial) return;
		loadingMore = true;
		popularError = null;
		try {
			const supabase = getSupabase();
			const token = get(authStore).session?.access_token ?? null;
			const user = get(authStore).user;
			if (!supabase || !token || !user?.id) {
				loadingMore = false;
				await loadPopular(popularContinuationOffset, 0);
				return;
			}

			const requestId = await insertFeedRequestRow(supabase, user.id);

			if (requestId == null) {
				loadingMore = false;
				await loadPopular(popularContinuationOffset, 0);
				return;
			}

			const outcome = await pollCuratedFeedRequest(requestId, token);

			if (outcome.kind === 'completed') {
				const books = setMainListBooks(outcome.books, 'append');
				if (books.length === 0) {
					hasMore = false;
				} else {
					hasMore = books.length >= FEED_PAGE_SIZE;
					lastAppendWasFeed = true;
					armPendingFeedBatchEngagement();
				}
				return;
			}

			loadingMore = false;
			await loadPopular(popularContinuationOffset, 0);
		} catch (e) {
			console.error('[rate] loadCuratedFeedBatch:', e);
			popularError = t('rate.errors.loadBooks');
			loadingMore = false;
			await loadPopular(popularContinuationOffset, 0);
		} finally {
			loadingMore = false;
		}
	}

	async function doSearch(query: string, offset = 0, mode: 'fulltext' | 'author' = searchMode) {
		const trimmedQuery = query.trim();
		if (offset === 0) {
			searchRequestGeneration += 1;
		}
		const generation = searchRequestGeneration;
		if (offset === 0) {
			loadingSearch = true;
		} else {
			loadingSearchMore = true;
		}
		searchError = null;

		try {
			const data =
				mode === 'author'
					? await searchBooksByAuthor(query, offset)
					: await searchBooks(query, offset);
			if (generation !== searchRequestGeneration) return;
			if (trimmedQuery !== normalizedDebouncedQuery) return;

			if (offset === 0) {
				const seen = new SvelteSet<string>();
				searchResults = data.books.filter((b) => {
					if (seen.has(b.id)) return false;
					seen.add(b.id);
					return true;
				});
				searchNextOffset = data.nextOffset;
				searchHasMore = data.hasMore;
			} else {
				const existingIds = new Set(searchResults.map((b) => b.id));
				const newBooks = data.books.filter((b) => !existingIds.has(b.id));
				searchResults = [...searchResults, ...newBooks];
				searchNextOffset = data.nextOffset;
				// Do not clear hasMore when a page yields no new rows: hits can duplicate
				// across offsets, or Postgres can drop ids Meilisearch still counts — offset
				// still advances and `queueMicrotask` can fetch the next page while at bottom.
				searchHasMore = data.hasMore;
			}
			queueMicrotask(() => tryLoadMoreSearchNearBottom());
		} catch {
			if (generation !== searchRequestGeneration) return;
			if (trimmedQuery !== normalizedDebouncedQuery) return;
			searchError = t('rate.errors.searchFailed');
			if (offset === 0) searchResults = [];
		} finally {
			if (offset === 0) {
				loadingSearch = false;
			} else {
				loadingSearchMore = false;
			}
		}
	}

	async function handleSubmit() {
		if (!canGetRecommendations) return;
		const sync = get(ratingsSyncMeta);
		if (sync.queuedCount > 0 || sync.isFlushing) return;
		const user = get(authStore).user;
		if (!user?.id) {
			goto(resolve('/rate/recommendations'));
			return;
		}
		const supabase = getSupabase();
		if (supabase) {
			try {
				const { data, error } = await supabase
					.from('recommendation_requests')
					.insert({ user_id: user.id })
					.select('id')
					.single();
				if (!error && data?.id != null) {
					/* eslint-disable svelte/no-navigation-without-resolve -- pass recommendation request id in query */
					goto(
						`${resolve('/rate/recommendations')}?request_id=${encodeURIComponent(String(data.id))}`
					);
					/* eslint-enable svelte/no-navigation-without-resolve */
					return;
				}
			} catch {
				// fall through
			}
		}
		goto(resolve('/rate/recommendations'));
	}

	function handleToolbarSearchActivate() {
		captureFeedScrollForSearchReturn();
		if (!searchOverlayOpen) {
			void openSearchOverlay({ pushHistory: true });
		}
	}

	function getFocusableInDialog(root: HTMLElement): HTMLElement[] {
		const nodes = root.querySelectorAll<HTMLElement>(
			'a[href]:not([disabled]), button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
		);
		return Array.from(nodes).filter((el) => {
			if (el.closest('[inert]')) return false;
			if (el.getAttribute('aria-hidden') === 'true') return false;
			return true;
		});
	}

	function handleSearchOverlayKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeSearchOverlay();
			return;
		}
		if (e.key !== 'Tab' || !overlayDialogEl) return;
		const focusables = getFocusableInDialog(overlayDialogEl);
		if (focusables.length === 0) return;
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		const active = document.activeElement;
		const inDialog = active instanceof Node && overlayDialogEl.contains(active);
		if (e.shiftKey) {
			if (!inDialog || active === first) {
				e.preventDefault();
				last.focus();
			}
		} else {
			if (!inDialog || active === last) {
				e.preventDefault();
				first.focus();
			}
		}
	}

	onMount(() => {
		inertSupported = typeof HTMLElement !== 'undefined' && 'inert' in HTMLElement.prototype;

		const syncPrefetch = () => {
			mainListPrefetchPx = 3 * window.innerHeight;
		};
		syncPrefetch();
		window.addEventListener('resize', syncPrefetch);
		window.visualViewport?.addEventListener('resize', syncPrefetch);

		void (async () => {
			await waitForAuthReady();
			void loadInitialMainList();
		})();

		const handleScroll = () => {
			const y = window.scrollY;
			if (y <= SCROLL_THRESHOLD) {
				headerVisible = true;
			} else if (y > lastScrollY) {
				headerVisible = false;
			} else {
				headerVisible = true;
			}
			lastScrollY = y;
		};
		window.addEventListener('scroll', handleScroll, { passive: true });

		/**
		 * Shallow `pushState` pops update `page.state` synchronously without `navigate()`, so
		 * `afterNavigate({ type: 'popstate' })` does not run — keep this listener for that path.
		 * Async `popstate` (e.g. first Back after full reload) is handled in `afterNavigate` instead.
		 */
		const onWindowPopstate = () => {
			if (closeBookSummaryFromBrowserBack()) return;
			if (closeRatingsDrawerDetailFromBrowserBack()) return;
			queueMicrotask(() => {
				syncRatePageShallowHistoryAfterPopstate();
			});
		};
		window.addEventListener('popstate', onWindowPopstate);

		return () => {
			window.removeEventListener('scroll', handleScroll);
			window.removeEventListener('resize', syncPrefetch);
			window.visualViewport?.removeEventListener('resize', syncPrefetch);
			window.removeEventListener('popstate', onWindowPopstate);
		};
	});
</script>

<svelte:head>
	<title>{t('rate.pageTitle')} — {t('shared.header.siteName')}</title>
	<meta name="description" content={t('rate.metaDescription')} />
</svelte:head>

<div class="rate-page" class:rate-page--mobile-menu-open={$mobileMenuOpen}>
	<div
		class="rate-page__below-overlay"
		class:rate-page__below-overlay--inert-fallback={searchOverlayOpen && !inertSupported}
		inert={searchOverlayOpen && inertSupported}
		aria-hidden={searchOverlayOpen ? true : undefined}
	>
		<h1 class="rate-page__title typ-display2 typ-display2--content">{t('rate.pageTitle')}</h1>
		<header
			class="rate-page__sticky-header"
			class:rate-page__sticky-header--hidden={!headerVisible}
		>
			<div class="rate-page__toolbar">
				<div class="rate-page__search" class:rate-page__search--obscured={searchOverlayOpen}>
					<SearchBar
						asTrigger={true}
						bind:value={searchQuery}
						placeholder={t('rate.search.placeholder')}
						ariaLabel={t('rate.search.ariaLabel')}
						onActivate={handleToolbarSearchActivate}
					/>
				</div>
			</div>
		</header>

		<div class="rate-page__content">
			<div class="rate-page__panel">
				{#if popularError}
					<ErrorBanner message={popularError} onDismiss={() => (popularError = null)} />
				{/if}

				{#if loadingInitial}
					<BookCardGridSkeleton
						class="rate-page__list"
						ariaLabel={t('rate.aria.loadingBooks')}
						ariaLive="polite"
					/>
				{:else}
					<ul class="rate-page__list book-card-grid">
						{#each popularBooks as book (mainListKey(book))}
							<li>
								<BookCard
									context="rate"
									{book}
									onSearchAuthor={handleSearchAuthor}
									bookmarked={$planToReadStore.has(book.id)}
									onBookmark={(id) => handleRateBookmark(book, id)}
									notInterested={$notInterestedStore.has(book.book_id)}
									onNotInterested={() => handleMainListNotInterested(book)}
									onAfterRate={handleMainListAfterRate}
								/>
							</li>
						{/each}
						{#if showMainListLoadMoreTile}
							<li class="book-card-grid__cell rate-page__load-more-cell">
								<button
									type="button"
									class="rate-page__load-more-card typ-interactive-1"
									onclick={handleManualLoadMoreBooks}
									disabled={loadingMore || loadingInitial}
									aria-busy={loadingMore || loadingInitial ? 'true' : undefined}
									aria-label={t('rate.loadMoreBooksAriaLabel')}
								>
									{t('rate.loadMoreBooks')}
								</button>
							</li>
						{/if}
					</ul>

					{#if loadingMore}
						<div class="rate-page__spinner-wrap rate-page__spinner-wrap--bottom" aria-live="polite">
							<Spinner />
						</div>
					{/if}

					{#if hasMore}
						<div bind:this={sentinelEl} class="rate-page__sentinel" aria-hidden="true"></div>
					{/if}
				{/if}
			</div>
		</div>

		{#if bottomBarDisplayState}
			<div id="rate-bottom-bar" class="rate-page__bottom-bar" tabindex="-1">
				<RatingsBar
					bind:this={ratingsBar}
					{ratedEntries}
					triggerDisplayCount={bottomBarDisplayState.triggerCount}
					resolveBook={findBookById}
					resolveBookByBookId={findBookByBookId}
					summaryHooks={{
						onSearchAuthor: handleSearchAuthor,
						onBookmark: (book) => handleRateBookmark(book, book.id),
						onNotInterested: (book) =>
							searchOverlayOpen
								? handleSearchNotInterested(book)
								: handleMainListNotInterested(book),
						onAfterRate: () =>
							searchOverlayOpen ? handleSearchAfterRate() : handleMainListAfterRate()
					}}
				/>
				{#if bottomBarDisplayState.canGetRecommendations}
					<div class="rate-page__recommendations-cta">
						<Button
							variant="primary"
							pill
							class="rate-page__recommendations-submit"
							aria-disabled={!ratingsSyncedForRecommendations ? 'true' : undefined}
							onclick={(e) => {
								if (!ratingsSyncedForRecommendations) {
									e.preventDefault();
									return;
								}
								void handleSubmit();
							}}
						>
							{bottomBarDisplayState.recommendationsLabel}
						</Button>
					</div>
				{:else}
					<div class="rate-page__recommendations-hint-wrap">
						<div
							class="btn btn--primary btn--pill rate-page__recommendations-hint"
							role="status"
							aria-live="polite"
						>
							<span class="btn__label">{bottomBarDisplayState.recommendationsLabel}</span>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	{#if searchOverlayOpen}
		<div
			bind:this={overlayDialogEl}
			class="rate-search-overlay"
			role="dialog"
			aria-modal="true"
			aria-labelledby="rate-search-dialog-title"
			tabindex="-1"
			onkeydown={handleSearchOverlayKeydown}
		>
			<div class="rate-search-overlay__scrim" aria-hidden="true"></div>
			<div class="rate-search-overlay__panel">
				<header class="rate-search-overlay__header">
					<div class="rate-search-overlay__header-row">
						<div class="rate-search-overlay__search-row">
							<h1 id="rate-search-dialog-title" class="rate-search-overlay__sr-only">
								{t('rate.search.dialogTitle')}
							</h1>
							<SearchBar
								bind:this={overlaySearchBar}
								bind:value={searchQuery}
								autofocus={true}
								placeholder={t('rate.search.placeholder')}
								ariaLabel={t('rate.search.ariaLabel')}
							/>
						</div>
						<button
							type="button"
							class="rate-search-overlay__icon-btn"
							aria-label={t('rate.search.closeAriaLabel')}
							onclick={() => closeSearchOverlay()}
						>
							<X size={22} strokeWidth={2} aria-hidden="true" />
						</button>
					</div>
				</header>

				<div class="rate-search-overlay__body" bind:this={searchOverlayScrollEl}>
					<p class="rate-search-overlay__live" aria-live="polite" aria-atomic="true">
						{searchStatusMessage}
					</p>

					{#if searchError}
						<ErrorBanner message={searchError} onDismiss={() => (searchError = null)} />
					{/if}

					{#if normalizedDebouncedQuery.length === 0}
						<p class="rate-search-overlay__helper">{t('rate.search.minCharsHint')}</p>
					{:else if isSearching}
						{#if loadingSearch}
							<BookCardGridSkeleton class="rate-page__list" ariaLabel={t('rate.aria.searching')} />
						{:else if searchError}
							<!-- Error surfaced via ErrorBanner (role="alert") above -->
						{:else if searchResults.length === 0}
							<p class="rate-page__empty">
								{t('rate.emptySearch', { query: normalizedDebouncedQuery })}
							</p>
						{:else}
							<p id="rate-search-results-summary" class="rate-search-overlay__results-summary">
								{t('rate.search.statusResults', { count: searchResults.length })}
							</p>
							<ul
								class="rate-page__list book-card-grid"
								aria-labelledby="rate-search-results-summary"
							>
								{#each searchResults as book (book.id)}
									<li>
										<BookCard
											context="rate"
											{book}
											onSearchAuthor={handleSearchAuthor}
											bookmarked={$planToReadStore.has(book.id)}
											onBookmark={(id) => handleRateBookmark(book, id)}
											notInterested={$notInterestedStore.has(book.book_id)}
											onNotInterested={() => handleSearchNotInterested(book)}
											onAfterRate={() => handleSearchAfterRate()}
										/>
									</li>
								{/each}
							</ul>

							{#if loadingSearchMore}
								<div
									class="rate-page__spinner-wrap rate-page__spinner-wrap--bottom"
									aria-live="polite"
								>
									<Spinner />
								</div>
							{/if}
						{/if}
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.rate-page {
		padding-bottom: 0;
	}
	.rate-page--mobile-menu-open .rate-page__bottom-bar {
		display: none;
	}
	.rate-page__sticky-header {
		position: sticky;
		top: 0;
		z-index: 50;
		background: transparent;
		padding-top: var(--space-4);
		padding-bottom: 0;
		margin-bottom: var(--space-2);
		transition: transform 0.25s ease;
	}
	/* Title sits above the bar; avoid doubling top padding with the sticky block. */
	.rate-page__title + .rate-page__sticky-header {
		padding-top: 0;
	}
	.rate-page__title {
		margin-top: 0;
		padding-top: 0;
		text-align: center;
	}
	/* Stay visible while the search (or clear control) is focused so the field is not off-screen. */
	.rate-page__sticky-header--hidden:not(:focus-within) {
		transform: translateY(-100%);
		pointer-events: none;
	}
	.rate-page__toolbar {
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		justify-content: center;
		vertical-align: middle;
		text-align: left;
		gap: var(--space-3);
		width: 100%;
		min-height: var(--min-tap);
		padding-top: 16px;
		padding-bottom: 16px;
	}
	.rate-page__search {
		flex: 1 1 auto;
		min-width: 0;
		max-width: min(48rem, 100%);
	}
	@media (max-width: 767px) {
		.rate-page__search {
			max-width: none;
		}
	}
	.rate-page__empty {
		color: var(--color-text-muted);
		margin: var(--space-4) 0;
	}

	.rate-page__load-more-cell {
		display: flex;
		min-width: 0;
		min-height: 0;
	}

	.rate-page__load-more-card {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		aspect-ratio: 2 / 3;
		min-height: 12rem;
		padding: var(--space-4);
		margin: 0;
		border-radius: var(--book-card-radius, var(--radius));
		border: 1px solid var(--color-border);
		background: var(--color-card-bg);
		box-shadow: var(--shadow-card);
		color: var(--color-text-muted);
		text-align: center;
		cursor: pointer;
		transition:
			box-shadow var(--duration-normal) var(--ease-default),
			border-color var(--duration-normal) var(--ease-default),
			color var(--duration-normal) var(--ease-default);
	}

	.rate-page__load-more-card:hover:not(:disabled) {
		box-shadow: var(--shadow-card-hover);
		border-color: var(--color-border-hover);
		color: var(--color-text);
	}

	.rate-page__load-more-card:focus-visible {
		outline: none;
		box-shadow:
			var(--shadow-card-hover),
			0 0 0 2px var(--color-focus);
	}

	.rate-page__load-more-card:disabled {
		cursor: wait;
		opacity: 0.72;
	}
	.rate-page__empty {
		text-align: center;
	}

	.rate-page__below-overlay--inert-fallback {
		pointer-events: none;
		user-select: none;
	}

	.rate-page__search--obscured {
		visibility: hidden;
	}

	.rate-search-overlay {
		position: fixed;
		inset: 0;
		z-index: 130;
		display: flex;
		flex-direction: column;
		animation: rate-search-overlay-in 0.22s var(--ease-default, ease) both;
	}
	.rate-search-overlay__scrim {
		position: absolute;
		inset: 0;
		background: var(--color-card-bg);
	}
	.rate-search-overlay__panel {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		flex: 1;
		max-height: 100%;
		background: var(--color-card-bg);
	}
	.rate-search-overlay__header {
		flex-shrink: 0;
		z-index: 2;
		padding: var(--space-4);
		padding-top: calc(var(--space-4) + env(safe-area-inset-top, 0px));
		background: var(--color-card-bg);
		border-bottom: 1px solid var(--color-border);
	}
	.rate-search-overlay__header-row {
		position: relative;
		display: flex;
		justify-content: center;
		align-items: center;
		min-width: 0;
		/* Keep the field clear of the absolutely positioned close control */
		padding-inline-end: calc(var(--min-tap) + var(--space-2));
	}
	.rate-search-overlay__sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	.rate-search-overlay__icon-btn {
		position: absolute;
		top: 50%;
		right: 0;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--min-tap);
		height: var(--min-tap);
		min-width: var(--min-tap);
		min-height: var(--min-tap);
		padding: 0;
		border: none;
		border-radius: var(--radius-pill);
		background: var(--color-floating-control-bg);
		color: var(--color-text);
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease-default);
	}
	.rate-search-overlay__icon-btn:hover {
		background: var(--color-floating-control-bg-hover);
	}
	.rate-search-overlay__icon-btn:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.rate-search-overlay__search-row {
		position: relative;
		flex: 0 1 auto;
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		/* Match `.rate-page__search` so overlay field caps like the toolbar trigger */
		max-width: min(48rem, 100%);
	}
	@media (max-width: 767px) {
		.rate-search-overlay__search-row {
			max-width: none;
		}
	}
	.rate-search-overlay__search-row :global(.search-bar) {
		width: 100%;
	}
	.rate-search-overlay__body {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
		overscroll-behavior: contain;
		/* html/body use `touch-action: none` while search is open; allow vertical pan inside the list. */
		touch-action: pan-y;
		padding: var(--space-4);
		padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
	}
	.rate-search-overlay__helper {
		margin: var(--space-4) 0;
		text-align: center;
		color: var(--color-text-muted);
		font-family: var(--typ-body-font-family);
		font-size: var(--typ-body-font-size);
		line-height: var(--typ-body-line-height);
	}
	.rate-search-overlay__results-summary {
		margin: 0 0 var(--space-3) 0;
		color: var(--color-text-muted);
		font-family: var(--typ-body-font-family);
		font-size: var(--typ-body-font-size);
		line-height: var(--typ-body-line-height);
		font-weight: 400;
	}
	.rate-search-overlay__live {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	@keyframes rate-search-overlay-in {
		from {
			opacity: 0.001;
		}
		to {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.rate-search-overlay {
			animation: none;
		}
	}

	.rate-page__spinner-wrap {
		display: flex;
		justify-content: center;
		align-items: center;
		padding: var(--space-12) var(--space-4);
	}
	.rate-page__spinner-wrap--bottom {
		padding: var(--space-6) var(--space-4);
	}

	.rate-page__sentinel {
		height: 1px;
	}

	.rate-page__bottom-bar {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 100;
		padding: var(--space-3) var(--space-4);
		padding-bottom: calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
		background: transparent;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
		justify-content: space-between;
		pointer-events: none;
	}
	:global(.rate-page__bottom-bar > *) {
		pointer-events: auto;
	}

	:global(html.rate-page--search-open),
	:global(body.rate-page--search-open) {
		overflow: hidden;
		overscroll-behavior: none;
		touch-action: none;
		/* Let the fixed overlay use the full viewport width (no reserved root gutter). */
		scrollbar-gutter: auto;
	}

	.rate-page__recommendations-cta,
	.rate-page__recommendations-hint-wrap {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-1);
		max-width: min(20rem, 100%);
	}
	:global(.rate-page__recommendations-hint.btn) {
		pointer-events: none;
		user-select: none;
		cursor: default;
		margin: 0;
		text-align: center;
	}
</style>
