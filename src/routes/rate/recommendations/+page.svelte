<script lang="ts">
	import { untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import Button from '$lib/components/Button.svelte';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookCardGridSkeleton from '$lib/components/BookCardGridSkeleton.svelte';
	import RecommendationsEmpty from '$lib/components/RecommendationsEmpty.svelte';
	import NavStyleTabList from '$lib/components/NavStyleTabList.svelte';
	import { ChevronDown } from 'lucide-svelte';
	import { planToReadStore } from '$lib/stores/planToRead';
	import {
		recommendationsCountStore,
		refreshRecommendationsCountFromApi
	} from '$lib/stores/recommendationsCount';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import RecommendationsLoading from '$lib/components/RecommendationsLoading.svelte';
	import { authStore } from '$lib/stores/auth';
	import { ratingsStore } from '$lib/stores/ratings';
	import {
		recommendationsPageStore,
		type RecommendationRun
	} from '$lib/stores/recommendationsPage';
	import { ratedSummarySheetKeepAlive } from '$lib/stores/ratedSummarySheetKeepAlive';
	import { t } from '$lib/copy';
	import type { Book } from '$lib/types/book';

	const FILTER_IDS = ['recommended', 'bookmarked', 'not-interested'] as const;
	type RecFilterId = (typeof FILTER_IDS)[number];

	const LS_FILTER_KEY = 'book-doctor:recommendations-filter';
	const LS_SORT_KEY = 'book-doctor:recommendations-sort';

	const REC_SORT_IDS = ['newest', 'oldest', 'best-fit'] as const;
	type RecSortId = (typeof REC_SORT_IDS)[number];

	function isValidRecSortId(s: string | null | undefined): s is RecSortId {
		return s != null && (REC_SORT_IDS as readonly string[]).includes(s);
	}

	function isValidRecFilter(s: string | null | undefined): s is RecFilterId {
		return s != null && (FILTER_IDS as readonly string[]).includes(s);
	}

	function readRecSortFromLs(): RecSortId {
		if (!browser) return 'best-fit';
		try {
			const s = localStorage.getItem(LS_SORT_KEY);
			if (isValidRecSortId(s)) return s;
		} catch {
			// ignore
		}
		return 'best-fit';
	}

	function isNotInterested(book: Book, niNums: Set<number>): boolean {
		return niNums.has(book.book_id ?? 0);
	}

	/**
	 * `newest` / `oldest`: by last batch that included the book.
	 * `best-fit`: more recommendation runs first, then best list position (rank 1 beats 10), then recency, then title.
	 */
	function sortRecHistoryBooks(
		books: Book[],
		order: RecSortId,
		lastAt: Record<string, number>,
		appearances: Record<string, number>,
		bestRank: Record<string, number>
	): Book[] {
		const arr = [...books];
		const key = (b: Book) => String(b.book_id ?? 0);
		const ms = (b: Book) => lastAt[key(b)] ?? 0;
		const cnt = (b: Book) => appearances[key(b)] ?? 0;
		const br = (b: Book) => bestRank[key(b)] ?? 999;
		const titleCmp = (a: Book, b: Book) => (a.title ?? '').localeCompare(b.title ?? '');

		if (order === 'newest') {
			arr.sort((a, b) => {
				const diff = ms(b) - ms(a);
				if (diff !== 0) return diff;
				return titleCmp(a, b);
			});
			return arr;
		}
		if (order === 'oldest') {
			arr.sort((a, b) => {
				const diff = ms(a) - ms(b);
				if (diff !== 0) return diff;
				return titleCmp(a, b);
			});
			return arr;
		}
		arr.sort((a, b) => {
			const dc = cnt(b) - cnt(a);
			if (dc !== 0) return dc;
			const dr = br(a) - br(b);
			if (dr !== 0) return dr;
			const dm = ms(b) - ms(a);
			if (dm !== 0) return dm;
			return titleCmp(a, b);
		});
		return arr;
	}

	const POLL_INTERVAL_MS = 3000;
	const POLL_TIMEOUT_MS = 60000;

	const initialHistorySnapshot = recommendationsPageStore.getHistorySnapshot();

	let books = $state<Book[]>([]);
	let uniqueBooks = $state<Book[]>(initialHistorySnapshot.uniqueBooks);
	let uniqueBooksLoading = $state(
		initialHistorySnapshot.runs.length > 0 && !initialHistorySnapshot.uniqueLoaded
	);
	let loading = $state(!initialHistorySnapshot.loaded);
	let error = $state<string | null>(null);
	let timedOut = $state(false);
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let viewMode = $state<'loading' | 'history' | 'empty' | 'single' | 'timedOut' | 'error'>(
		initialHistorySnapshot.loaded
			? initialHistorySnapshot.runs.length === 0
				? 'empty'
				: 'history'
			: 'loading'
	);
	let gridEl = $state<HTMLDivElement | null>(null);
	let activeRouteLoadId = 0;

	let allRecommendedBookIds = $state<number[]>(initialHistorySnapshot.allRecommendedBookIds ?? []);
	let lastRecommendedAt = $state<Record<string, number>>(initialHistorySnapshot.lastRecommendedAt ?? {});
	let recommendationAppearanceCount = $state<Record<string, number>>(
		initialHistorySnapshot.recommendationAppearanceCount ?? {}
	);
	let bestRecommendationRank = $state<Record<string, number>>(
		initialHistorySnapshot.bestRecommendationRank ?? {}
	);
	let bookmarkBooks = $state<Book[]>([]);
	let niBooks = $state<Book[]>([]);
	let bmNiLoading = $state(false);
	let bmNiLoadRequestId = 0;

	let activeFilter = $state<RecFilterId>('recommended');
	let prevRecFilterForSummaryKeepAlive = $state<RecFilterId | undefined>(undefined);
	let sortOrder = $state<RecSortId>(readRecSortFromLs());

	$effect(() => {
		const f = activeFilter;
		if (prevRecFilterForSummaryKeepAlive !== undefined && prevRecFilterForSummaryKeepAlive !== f) {
			ratedSummarySheetKeepAlive.set(null);
		}
		prevRecFilterForSummaryKeepAlive = f;
	});

	const niNums = $derived.by(() => new Set([...$notInterestedStore]));

	const allRecIdSet = $derived(new Set(allRecommendedBookIds));

	const countsReady = $derived(!$authStore.session?.access_token || !bmNiLoading);

	const recommendedRawList = $derived.by(() =>
		uniqueBooks.filter((b) => !isNotInterested(b, niNums))
	);

	const bookmarkTabBooksRaw = $derived.by(() =>
		bookmarkBooks.filter(
			(b) =>
				allRecIdSet.has(b.book_id ?? 0) && !isNotInterested(b, niNums)
		)
	);

	const niTabBooksRaw = $derived.by(() =>
		niBooks.filter((b) => allRecIdSet.has(b.book_id ?? 0) && $notInterestedStore.has(b.book_id ?? 0))
	);

	const recommendedTabBooks = $derived.by(() =>
		sortRecHistoryBooks(
			recommendedRawList,
			sortOrder,
			lastRecommendedAt,
			recommendationAppearanceCount,
			bestRecommendationRank
		)
	);

	const bookmarkTabBooks = $derived.by(() =>
		sortRecHistoryBooks(
			bookmarkTabBooksRaw,
			sortOrder,
			lastRecommendedAt,
			recommendationAppearanceCount,
			bestRecommendationRank
		)
	);

	const niTabBooks = $derived.by(() =>
		sortRecHistoryBooks(
			niTabBooksRaw,
			sortOrder,
			lastRecommendedAt,
			recommendationAppearanceCount,
			bestRecommendationRank
		)
	);

	const tabItems = $derived([
		{ id: 'recommended' as RecFilterId, label: t('recommendations.tabs.recommended') },
		{ id: 'bookmarked' as RecFilterId, label: t('rated.tabs.bookmarked') },
		{ id: 'not-interested' as RecFilterId, label: t('rated.tabs.notInterested') }
	]);

	const sortOptionLabel = $derived.by((): string => {
		switch (sortOrder) {
			case 'newest':
				return t('recommendations.sort.newest');
			case 'oldest':
				return t('recommendations.sort.oldest');
			case 'best-fit':
				return t('recommendations.sort.bestFit');
			default: {
				const _x: never = sortOrder;
				return _x;
			}
		}
	});

	function setRecSortOrder(next: RecSortId) {
		sortOrder = next;
		try {
			localStorage.setItem(LS_SORT_KEY, next);
		} catch {
			// ignore
		}
	}

	function countForTab(id: RecFilterId): number {
		if (id === 'recommended') return recommendedTabBooks.length;
		if (id === 'bookmarked') return bookmarkTabBooks.length;
		return niTabBooks.length;
	}

	const listNeedsBmNi = $derived(activeFilter === 'bookmarked' || activeFilter === 'not-interested');

	const listLoading = $derived(
		$authStore.session?.access_token && viewMode === 'history' && listNeedsBmNi && bmNiLoading
	);

	const currentHistoryBooks = $derived.by((): Book[] => {
		const list: Book[] =
			activeFilter === 'recommended'
				? recommendedTabBooks
				: activeFilter === 'bookmarked'
					? bookmarkTabBooks
					: niTabBooks;

		const keep = $ratedSummarySheetKeepAlive;
		if (keep && !list.some((b) => b.id === keep.bookId)) {
			return [...list, keep.book];
		}
		return list;
	});

	function selectRecTab(id: RecFilterId) {
		activeFilter = id;
		try {
			localStorage.setItem(LS_FILTER_KEY, id);
		} catch {
			// ignore
		}
		void goto(`/rate/recommendations?filter=${encodeURIComponent(id)}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	function handleGridKeydown(e: KeyboardEvent) {
		const key = e.key;
		if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') return;
		if (!gridEl || books.length === 0) return;

		const cards = Array.from(gridEl.querySelectorAll<HTMLElement>('.book-card'));
		const currentCard = cards.find((card) => card.contains(document.activeElement as Node));
		const currentIndex = currentCard ? cards.indexOf(currentCard) : -1;
		if (currentIndex === -1) return;

		const prev = key === 'ArrowLeft' || key === 'ArrowUp';
		const nextIndex = prev ? currentIndex - 1 : currentIndex + 1;
		if (nextIndex < 0 || nextIndex >= cards.length) return;

		e.preventDefault();
		const targetCard = cards[nextIndex];
		const firstFocusable = targetCard.querySelector<HTMLElement>('button, [role="button"]');
		firstFocusable?.focus();
	}

	async function fetchRecommendations(
		accessToken: string | null,
		requestId: string | null
	): Promise<{ books: Book[] }> {
		const url = requestId
			? `/api/recommendations?request_id=${encodeURIComponent(requestId)}`
			: '/api/recommendations';
		const headers: Record<string, string> = {};
		if (accessToken) {
			headers['Authorization'] = `Bearer ${accessToken}`;
		}
		const res = await fetch(url, { headers });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data: { books: Book[]; request_id: string | null } = await res.json();
		return { books: data.books ?? [] };
	}

	async function fetchHistory(accessToken: string | null): Promise<RecommendationRun[]> {
		const headers: Record<string, string> = {};
		if (accessToken) {
			headers['Authorization'] = `Bearer ${accessToken}`;
		}
		const res = await fetch('/api/recommendations/history', { headers });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data: { runs: RecommendationRun[] } = await res.json();
		return data.runs ?? [];
	}

	async function fetchUniqueBooks(accessToken: string | null): Promise<{
		books: Book[];
		allRecommendedBookIds: number[];
		lastRecommendedAt: Record<string, number>;
		recommendationAppearanceCount: Record<string, number>;
		bestRecommendationRank: Record<string, number>;
	}> {
		const headers: Record<string, string> = {};
		if (accessToken) {
			headers['Authorization'] = `Bearer ${accessToken}`;
		}
		const res = await fetch('/api/recommendations/unique', { headers });
		if (!res.ok) {
			return {
				books: [],
				allRecommendedBookIds: [],
				lastRecommendedAt: {},
				recommendationAppearanceCount: {},
				bestRecommendationRank: {}
			};
		}
		const data: {
			books: Book[];
			allRecommendedBookIds?: number[];
			lastRecommendedAt?: Record<string, number>;
			recommendationAppearanceCount?: Record<string, number>;
			bestRecommendationRank?: Record<string, number>;
		} = await res.json();
		return {
			books: data.books ?? [],
			allRecommendedBookIds: data.allRecommendedBookIds ?? [],
			lastRecommendedAt: data.lastRecommendedAt ?? {},
			recommendationAppearanceCount: data.recommendationAppearanceCount ?? {},
			bestRecommendationRank: data.bestRecommendationRank ?? {}
		};
	}

	function handleNotInterested(book: Book) {
		const bid = book.book_id ?? 0;
		const wasNotInterested = notInterestedStore.has(bid);
		const nowNotInterested = notInterestedStore.toggle(bid);
		if (nowNotInterested && !wasNotInterested) {
			if (planToReadStore.has(book.id)) {
				planToReadStore.toggle(book.id, book.book_id);
				bookmarkBooks = bookmarkBooks.filter((b) => b.id !== book.id);
			}
			if (get(ratingsStore).has(book.id)) {
				ratingsStore.removeRating(book.id, book.book_id);
			}
			if (!niBooks.some((b) => b.id === book.id)) {
				const rest = niBooks.filter((b) => b.id !== book.id);
				niBooks = [book, ...rest];
			}
		} else if (wasNotInterested && !nowNotInterested) {
			niBooks = niBooks.filter((b) => b.book_id !== book.book_id);
		}
		if (nowNotInterested) {
			recommendationsCountStore.update((n) => Math.max(0, n - 1));
		} else {
			recommendationsCountStore.update((n) => n + 1);
		}
	}

	function handleBookmark(book: Book, id: string) {
		const wasBookmarked = planToReadStore.has(book.id);
		planToReadStore.toggle(id, book.book_id);
		if (!wasBookmarked && book.book_id != null) {
			notInterestedStore.remove(book.book_id);
			niBooks = niBooks.filter((b) => b.book_id !== book.book_id);
			if (!bookmarkBooks.some((b) => b.id === book.id)) {
				const rest = bookmarkBooks.filter((b) => b.id !== book.id);
				bookmarkBooks = [book, ...rest];
			}
		}
		if (wasBookmarked) {
			bookmarkBooks = bookmarkBooks.filter((b) => b.id !== book.id);
		}
	}

	function isActiveRouteLoad(loadId: number, requestId: string | null): boolean {
		return loadId === activeRouteLoadId && (page.url.searchParams.get('request_id')?.trim() ?? null) === requestId;
	}

	function applyHistorySnapshot() {
		const snapshot = recommendationsPageStore.getHistorySnapshot();
		uniqueBooks = snapshot.uniqueBooks;
		allRecommendedBookIds = snapshot.allRecommendedBookIds ?? [];
		lastRecommendedAt = snapshot.lastRecommendedAt ?? {};
		recommendationAppearanceCount = snapshot.recommendationAppearanceCount ?? {};
		bestRecommendationRank = snapshot.bestRecommendationRank ?? {};
		loading = !snapshot.loaded;
		uniqueBooksLoading = snapshot.runs.length > 0 && !snapshot.uniqueLoaded;
		error = null;
		timedOut = false;
		viewMode = snapshot.loaded ? (snapshot.runs.length === 0 ? 'empty' : 'history') : 'loading';
		// Only sync header count when snapshot is trustworthy. Initial store state also has
		// `runs.length === 0` before any fetch — syncing then cleared the count and hid the main nav
		// until history loaded (flash navigating bookshelf ↔ recommendations).
		if (
			snapshot.uniqueLoaded ||
			(snapshot.loaded && snapshot.runs.length === 0)
		) {
			recommendationsCountStore.set(snapshot.uniqueBooks.length);
		}
	}

	/** Sync filter from URL when on the history list (no `request_id`). */
	$effect(() => {
		if (!browser) return;
		const url = page.url;
		if (url.searchParams.get('request_id')?.trim()) return;
		if (url.pathname !== '/rate/recommendations') return;

		const param = url.searchParams.get('filter');
		if (isValidRecFilter(param)) {
			const current = untrack(() => activeFilter);
			if (current !== param) activeFilter = param;
			try {
				localStorage.setItem(LS_FILTER_KEY, param);
			} catch {
				// ignore
			}
			return;
		}
		let next: RecFilterId = 'recommended';
		try {
			const stored = localStorage.getItem(LS_FILTER_KEY);
			if (isValidRecFilter(stored)) next = stored;
		} catch {
			// ignore
		}
		const current = untrack(() => activeFilter);
		if (current !== next) activeFilter = next;
		void goto(`/rate/recommendations?filter=${encodeURIComponent(next)}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	});

	/** Bookmarks + not-interested lists for recommendation tabs (history view). */
	$effect(() => {
		const token = $authStore.session?.access_token ?? null;
		// Tracked: token + `viewMode` only — not `?filter=`. Reading `page.url` here re-ran this
		// effect on every client-side tab click (see `selectRecTab`), so `bmNiLoading` flashed
		// true and showed skeletons on every switch. That matched bookshelf only if the URL
		// never changed. Single-run / full-page views read `request_id` via `untrack`.
		if (!token || viewMode !== 'history') {
			bmNiLoading = false;
			return;
		}
		if (untrack(() => page.url.searchParams.get('request_id')?.trim())) {
			bmNiLoading = false;
			return;
		}

		const requestId = ++bmNiLoadRequestId;
		bmNiLoading = true;

		const bmPromise = fetch('/api/bookmarks', {
			headers: { Authorization: `Bearer ${token}` }
		})
			.then((res) => {
				if (!res.ok) throw new Error('bm');
				return res.json() as Promise<{ books: Book[] }>;
			})
			.then((d) => d.books ?? [])
			.catch(() => [] as Book[]);

		const niPromise = fetch('/api/not-interested/books', {
			headers: { Authorization: `Bearer ${token}` }
		})
			.then((res) => {
				if (!res.ok) throw new Error('ni');
				return res.json() as Promise<{ books: Book[] }>;
			})
			.then((d) => d.books ?? [])
			.catch(() => [] as Book[]);

		void Promise.all([bmPromise, niPromise]).then(([bm, ni]) => {
			if (requestId !== bmNiLoadRequestId) return;
			bookmarkBooks = bm;
			niBooks = ni;
			bmNiLoading = false;
		});
	});

	// React to URL changes (client-side navigation from history "View" link, etc.)
	$effect(() => {
		const url = page.url;
		const requestId = url.searchParams.get('request_id')?.trim() ?? null;
		const fromHistory = url.searchParams.get('from') === 'history';
		const accessToken = $authStore.session?.access_token ?? null;
		const loadId = ++activeRouteLoadId;

		// Clean up previous poll when URL or effect re-runs
		if (pollTimer != null) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}

		if (requestId) {
			if (fromHistory) {
				const cachedBooks = recommendationsPageStore.getRunBooks(requestId);
				books = cachedBooks ? [...cachedBooks] : [];
				loading = !cachedBooks;
				error = null;
				timedOut = false;
				viewMode = cachedBooks ? 'single' : 'loading';
				if (cachedBooks && cachedBooks.length > 0) {
					void refreshRecommendationsCountFromApi(accessToken);
				}
				const requestedId = requestId;
				fetchRecommendations(accessToken, requestId)
					.then(({ books: nextBooks }) => {
						// Only apply if still on this request (user didn't navigate away)
						if (isActiveRouteLoad(loadId, requestedId)) {
							books = nextBooks;
							recommendationsPageStore.setRunBooks(requestedId, nextBooks);
							error = null;
							viewMode = 'single';
							if (nextBooks.length > 0) {
								void refreshRecommendationsCountFromApi(accessToken);
							}
						}
					})
					.catch((e) => {
						if (!isActiveRouteLoad(loadId, requestedId)) return;
						if (cachedBooks) {
							error = null;
							return;
						}
						error = e instanceof Error ? e.message : t('recommendations.failedToLoad');
						viewMode = 'error';
					})
					.finally(() => {
						if (isActiveRouteLoad(loadId, requestedId)) {
							loading = false;
						}
					});
				return;
			}

			const start = Date.now();

			const schedule = async () => {
				if (!isActiveRouteLoad(loadId, requestId)) return;
				let done = false;
				try {
					const { books: nextBooks } = await fetchRecommendations(accessToken, requestId);
					if (!isActiveRouteLoad(loadId, requestId)) return;
					if (nextBooks.length > 0) {
						books = nextBooks;
						recommendationsPageStore.setRunBooks(requestId, nextBooks);
						loading = false;
						error = null;
						timedOut = false;
						viewMode = 'single';
						void refreshRecommendationsCountFromApi(accessToken);
						done = true;
					} else if (Date.now() - start >= POLL_TIMEOUT_MS) {
						timedOut = true;
						loading = false;
						error = null;
						viewMode = 'timedOut';
						done = true;
					}
				} catch (e) {
					if (!isActiveRouteLoad(loadId, requestId)) return;
					error = e instanceof Error ? e.message : t('recommendations.failedToLoad');
					viewMode = 'error';
					loading = false;
					done = true;
				}

				if (!isActiveRouteLoad(loadId, requestId)) return;
				if (done) {
					if (pollTimer != null) {
						clearTimeout(pollTimer);
						pollTimer = null;
					}
				} else {
					pollTimer = setTimeout(schedule, POLL_INTERVAL_MS);
				}
			};

			books = [];
			loading = true;
			error = null;
			timedOut = false;
			viewMode = 'loading';
			void schedule();
		} else {
			const cachedHistory = recommendationsPageStore.getHistorySnapshot();
			applyHistorySnapshot();

			const refreshUniqueBooks = async (): Promise<void> => {
				if (!cachedHistory.uniqueLoaded) {
					uniqueBooksLoading = true;
				}

				try {
					const payload = await fetchUniqueBooks(accessToken);
					if (!isActiveRouteLoad(loadId, null)) return;
					uniqueBooks = payload.books;
					allRecommendedBookIds = payload.allRecommendedBookIds;
					lastRecommendedAt = payload.lastRecommendedAt;
					recommendationAppearanceCount = payload.recommendationAppearanceCount;
					bestRecommendationRank = payload.bestRecommendationRank;
					recommendationsPageStore.setUniqueBooks(payload.books, {
						allRecommendedBookIds: payload.allRecommendedBookIds,
						lastRecommendedAt: payload.lastRecommendedAt,
						recommendationAppearanceCount: payload.recommendationAppearanceCount,
						bestRecommendationRank: payload.bestRecommendationRank
					});
					recommendationsCountStore.set(payload.books.length);
				} catch {
					if (!isActiveRouteLoad(loadId, null)) return;
					if (!cachedHistory.uniqueLoaded) {
						uniqueBooks = [];
						allRecommendedBookIds = [];
						lastRecommendedAt = {};
						recommendationAppearanceCount = {};
						bestRecommendationRank = {};
						recommendationsCountStore.set(0);
					}
				} finally {
					if (isActiveRouteLoad(loadId, null)) {
						uniqueBooksLoading = false;
					}
				}
			};

			fetchHistory(accessToken)
				.then((historyRuns) => {
					if (!isActiveRouteLoad(loadId, null)) return;
					recommendationsPageStore.setRuns(historyRuns);
					error = null;
					viewMode = historyRuns.length === 0 ? 'empty' : 'history';
					if (historyRuns.length === 0) {
						uniqueBooks = [];
						allRecommendedBookIds = [];
						lastRecommendedAt = {};
						recommendationAppearanceCount = {};
						bestRecommendationRank = {};
						uniqueBooksLoading = false;
						recommendationsPageStore.setUniqueBooks([]);
						recommendationsCountStore.set(0);
					} else {
						void refreshUniqueBooks();
					}
				})
				.catch((e) => {
					if (!isActiveRouteLoad(loadId, null)) return;
					if (cachedHistory.loaded) {
						error = null;
						viewMode = cachedHistory.runs.length === 0 ? 'empty' : 'history';
						if (cachedHistory.runs.length > 0) {
							void refreshUniqueBooks();
						}
						return;
					}
					error = e instanceof Error ? e.message : t('recommendations.failedToLoadHistory');
					viewMode = 'error';
				})
				.finally(() => {
					if (isActiveRouteLoad(loadId, null)) {
						loading = false;
					}
				});
		}
	});
</script>

<div class="recommendations-page">
	{#if viewMode === 'loading'}
		<h1 class="recommendations-page__title recommendations-page__title--spaced typ-display2 typ-display2--content">{t('recommendations.title')}</h1>
		<RecommendationsLoading />
	{:else if viewMode === 'timedOut'}
		<RecommendationsEmpty
			ratedCount={$ratingsStore.size}
			message={t('recommendations.timeoutMessage')}
		/>
	{:else if viewMode === 'error' || viewMode === 'empty'}
		<RecommendationsEmpty
			ratedCount={$ratingsStore.size}
			message={error ?? t('recommendations.noRecommendationsYet')}
		/>
	{:else if viewMode === 'history'}
		<h1
			class="recommendations-page__title recommendations-page__title--spaced typ-display2 typ-display2--content"
		>{t('recommendations.myRecommendations')}</h1>

		<div class="recommendations-page__tabs-wrap">
			<NavStyleTabList
				ariaLabel={t('recommendations.tabs.ariaLabel')}
				panelId="recommendations-panel"
				idPrefix="recommendations-tab"
				items={tabItems}
				selectedId={activeFilter}
				countsReady={countsReady}
				getCount={(id) => countForTab(id as RecFilterId)}
				onSelect={(id) => selectRecTab(id as RecFilterId)}
			/>
			<div class="recommendations-page__tabs-sort-divider" aria-hidden="true"></div>
			<div class="recommendations-page__sort">
				<span class="recommendations-page__sort-sizer" aria-hidden="true">{sortOptionLabel}</span>
				<select
					id="recommendations-sort"
					class="recommendations-page__sort-select"
					aria-label={t('recommendations.sort.ariaLabel')}
					value={sortOrder}
					onchange={(e) => {
						const v = (e.currentTarget as HTMLSelectElement).value;
						if (isValidRecSortId(v)) setRecSortOrder(v);
					}}
				>
					<option value="newest">{t('recommendations.sort.newest')}</option>
					<option value="oldest">{t('recommendations.sort.oldest')}</option>
					<option value="best-fit">{t('recommendations.sort.bestFit')}</option>
				</select>
				<span class="recommendations-page__sort-chevron" aria-hidden="true">
					<ChevronDown size={18} strokeWidth={2} />
				</span>
			</div>
		</div>

		<div
			id="recommendations-panel"
			class="recommendations-page__unique"
			role="tabpanel"
			aria-labelledby="recommendations-tab-{activeFilter}"
		>
			{#if uniqueBooksLoading}
				<BookCardGridSkeleton
					class="recommendations-page__unique-grid"
					ariaLabel={t('recommendations.allUniqueTitles')}
				/>
			{:else if listLoading}
				<p class="recommendations-page__loading typ-body">{t('recommendations.loadingList')}</p>
				<BookCardGridSkeleton
					class="recommendations-page__unique-grid"
					ariaLabel={t('recommendations.allUniqueTitles')}
				/>
			{:else if currentHistoryBooks.length === 0}
				<p class="recommendations-page__empty">
					{#if activeFilter === 'recommended'}
						{t('recommendations.emptyRecommendedTab')}
					{:else if activeFilter === 'bookmarked'}
						{t('recommendations.emptyBookmarkedTab')}
					{:else}
						{t('recommendations.emptyNotInterestedTab')}
					{/if}
				</p>
			{:else}
				<ul class="recommendations-page__unique-grid book-card-grid" aria-label={t('recommendations.allUniqueTitles')}>
					{#each currentHistoryBooks as book (book.id)}
						<li>
							<BookCard
								context="recommendations"
								{book}
								bookmarked={$planToReadStore.has(book.id)}
								onBookmark={(id) => handleBookmark(book, id)}
								currentRating={$ratingsStore.get(book.id) ?? null}
								onRate={(id, value) => {
									ratingsStore.setRating(id, value, book.book_id, book);
								}}
								onRemoveRating={(id) => ratingsStore.removeRating(id, book.book_id)}
								notInterested={$notInterestedStore.has(book.book_id ?? 0)}
								onNotInterested={() => handleNotInterested(book)}
							/>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{:else if viewMode === 'single'}
		<h1 class="recommendations-page__title typ-display2 typ-display2--content">{t('recommendations.title')}</h1>
		{#if page.url.searchParams.get('from') === 'history'}
			<p class="recommendations-page__back-wrap">
				<Button
					variant="tertiary"
					compact
					aria-label={t('recommendations.backToList')}
					onclick={() => goto('/rate/recommendations')}
				>
					{t('recommendations.backToList')}
				</Button>
			</p>
		{/if}
		{#if books.length === 0}
			<p class="recommendations-page__empty-run">{t('recommendations.emptyRun')}</p>
		{:else}
			<div
				role="grid"
				tabindex="-1"
				aria-label={t('recommendations.aria.recommendedBooks')}
				class="recommendations-page__list book-card-grid"
				bind:this={gridEl}
				onkeydown={handleGridKeydown}
			>
				{#each books as book (book.id)}
					<div class="book-card-grid__cell" role="gridcell">
						<BookCard
							context="recommendations"
							{book}
							bookmarked={$planToReadStore.has(book.id)}
							onBookmark={(id) => handleBookmark(book, id)}
							currentRating={$ratingsStore.get(book.id) ?? null}
							onRate={(id, value) => {
								ratingsStore.setRating(id, value, book.book_id, book);
							}}
							onRemoveRating={(id) => ratingsStore.removeRating(id, book.book_id)}
							notInterested={$notInterestedStore.has(book.book_id ?? 0)}
							onNotInterested={() => handleNotInterested(book)}
						/>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.recommendations-page {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		width: 100%;
		padding-bottom: var(--space-8);
	}
	.recommendations-page__title {
		margin: 0 0 var(--space-3) 0;
		text-align: center;
	}
	.recommendations-page__title--spaced {
		margin-bottom: var(--space-8);
	}
	.recommendations-page__tabs-wrap {
		display: flex;
		flex-wrap: nowrap;
		align-items: flex-end;
		justify-content: flex-start;
		width: fit-content;
		gap: var(--space-3);
		margin: 0 0 var(--space-5) 0;
	}
	.recommendations-page__tabs-wrap :global(.nav-style-tabs__wrap) {
		width: auto;
		flex: 1 1 auto;
		min-width: 0;
	}
	.recommendations-page__tabs-wrap :global(.nav-style-tabs__list) {
		width: auto;
	}
	.recommendations-page__tabs-sort-divider {
		flex: 0 0 auto;
		width: 1px;
		height: 1.125rem;
		align-self: center;
		background: color-mix(in srgb, var(--color-border) 55%, transparent);
	}
	@media (max-width: 767px) {
		.recommendations-page__tabs-wrap {
			align-self: stretch;
			width: 100%;
			max-width: 100%;
			min-width: 0;
		}
		.recommendations-page__tabs-wrap :global(.nav-style-tabs__wrap) {
			flex: 1 1 auto;
			min-width: 0;
			max-width: 100%;
		}
	}
	.recommendations-page__sort {
		position: relative;
		display: inline-flex;
		align-items: stretch;
		flex-shrink: 0;
		max-width: 100%;
		vertical-align: middle;
		border-radius: var(--radius-pill);
		background: transparent;
		cursor: pointer;
		transition: background 0.15s ease;
	}
	.recommendations-page__sort:hover {
		background: var(--color-interactive-hover-subtle);
	}
	.recommendations-page__sort-sizer {
		display: inline-block;
		padding: var(--chrome-menu-padding-block)
			calc(var(--chrome-menu-padding-inline) + var(--space-1) + 1.125rem)
			var(--chrome-menu-padding-block) var(--chrome-menu-padding-inline);
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		white-space: nowrap;
		visibility: hidden;
		pointer-events: none;
	}
	.recommendations-page__sort-select {
		appearance: none;
		-webkit-appearance: none;
		position: absolute;
		inset: 0;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		margin: 0;
		min-width: 0;
		padding: var(--chrome-menu-padding-block)
			calc(var(--chrome-menu-padding-inline) + var(--space-1) + 1.125rem)
			var(--chrome-menu-padding-block) var(--chrome-menu-padding-inline);
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text-muted);
		background: transparent;
		border: none;
		border-radius: inherit;
		cursor: pointer;
		transition: color 0.15s ease;
	}
	.recommendations-page__sort:hover .recommendations-page__sort-select {
		color: var(--color-text);
	}
	.recommendations-page__sort-select:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.recommendations-page__sort-chevron {
		position: absolute;
		right: var(--chrome-menu-padding-inline);
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		color: var(--color-text-muted);
		pointer-events: none;
	}
	.recommendations-page__sort:hover .recommendations-page__sort-chevron {
		color: var(--color-text);
	}
	.recommendations-page__loading {
		margin: 0 0 var(--space-3) 0;
		text-align: start;
		color: var(--color-text-muted);
	}
	.recommendations-page__empty {
		color: var(--color-text-muted);
		margin: 0;
		text-align: start;
	}
	.recommendations-page__unique {
		align-self: stretch;
		min-width: 0;
		margin-bottom: var(--space-8);
	}
	.recommendations-page__unique-grid {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.recommendations-page__empty-run {
		color: var(--color-text-muted);
		margin: 0;
		text-align: center;
	}
	.recommendations-page__back-wrap {
		margin: 0 0 var(--space-4) 0;
		text-align: center;
	}
</style>
