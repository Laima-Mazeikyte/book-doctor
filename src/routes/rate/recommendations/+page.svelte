<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookCardGridSkeleton from '$lib/components/BookCardGridSkeleton.svelte';
	import RecommendationsEmpty from '$lib/components/RecommendationsEmpty.svelte';
	import { ChevronDown } from 'lucide-svelte';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { recommendationsCountStore } from '$lib/stores/recommendationsCount';
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

	const LS_SORT_KEY = 'book-doctor:recommendations-sort';

	const REC_SORT_IDS = ['newest', 'oldest', 'best-fit'] as const;
	type RecSortId = (typeof REC_SORT_IDS)[number];

	function isValidRecSortId(s: string | null | undefined): s is RecSortId {
		return s != null && (REC_SORT_IDS as readonly string[]).includes(s);
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

	function isNotInterested(book: Book, notInterestedIds: Set<string>): boolean {
		return notInterestedIds.has(book.book_id);
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
		const key = (b: Book) => b.book_id;
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

	const initialHistorySnapshot = recommendationsPageStore.getHistorySnapshot();

	let uniqueBooks = $state<Book[]>(initialHistorySnapshot.uniqueBooks);
	let uniqueBooksLoading = $state(
		initialHistorySnapshot.runs.length > 0 && !initialHistorySnapshot.uniqueLoaded
	);
	let loading = $state(!initialHistorySnapshot.loaded);
	let error = $state<string | null>(null);
	let viewMode = $state<'loading' | 'history' | 'empty' | 'error'>(
		initialHistorySnapshot.loaded
			? initialHistorySnapshot.runs.length === 0
				? 'empty'
				: 'history'
			: 'loading'
	);
	let activeRouteLoadId = 0;

	let allRecommendedBookIds = $state<string[]>(initialHistorySnapshot.allRecommendedBookIds ?? []);
	let lastRecommendedAt = $state<Record<string, number>>(initialHistorySnapshot.lastRecommendedAt ?? {});
	let recommendationAppearanceCount = $state<Record<string, number>>(
		initialHistorySnapshot.recommendationAppearanceCount ?? {}
	);
	let bestRecommendationRank = $state<Record<string, number>>(
		initialHistorySnapshot.bestRecommendationRank ?? {}
	);
	let sortOrder = $state<RecSortId>(readRecSortFromLs());

	const notInterestedIds = $derived.by(() => new Set([...$notInterestedStore]));

	const recommendedRawList = $derived.by(() =>
		uniqueBooks.filter((b) => !isNotInterested(b, notInterestedIds))
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

	const currentHistoryBooks = $derived.by((): Book[] => {
		const list = recommendedTabBooks;
		const keep = $ratedSummarySheetKeepAlive;
		if (keep && !list.some((b) => b.id === keep.bookId)) {
			return [...list, keep.book];
		}
		return list;
	});

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
		allRecommendedBookIds: string[];
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
			allRecommendedBookIds?: string[];
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
		const bid = book.book_id;
		const wasNotInterested = notInterestedStore.has(bid);
		const nowNotInterested = notInterestedStore.toggle(bid);
		if (nowNotInterested && !wasNotInterested) {
			if (planToReadStore.has(book.id)) {
				planToReadStore.toggle(book.id, book.book_id);
			}
			if (get(ratingsStore).has(book.id)) {
				ratingsStore.removeRating(book.id, book.book_id);
			}
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
		if (!wasBookmarked) {
			notInterestedStore.remove(book.book_id);
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

	/** Legacy and external links: ?request_id= opens the shortlist route. */
	$effect(() => {
		if (!browser) return;
		const url = page.url;
		if (url.pathname !== '/rate/recommendations') return;
		const requestId = url.searchParams.get('request_id')?.trim();
		if (!requestId) return;
		const params = new URLSearchParams({ request_id: requestId });
		if (url.searchParams.get('from') === 'history') params.set('from', 'history');
		void goto(`/rate/recommendations/shortlist?${params.toString()}`, { replaceState: true });
	});

	$effect(() => {
		const url = page.url;
		if (url.pathname !== '/rate/recommendations') return;
		if (url.searchParams.get('request_id')?.trim()) return;

		// Re-fetch when the signed-in user changes, not when the access token refreshes alone
		// (e.g. anonymous → permanent on the same user id should keep the current list).
		const userId = $authStore.user?.id ?? null;
		const loadId = ++activeRouteLoadId;

		const cachedHistory = recommendationsPageStore.getHistorySnapshot();
			applyHistorySnapshot();

			const refreshUniqueBooks = async (): Promise<void> => {
				if (!cachedHistory.uniqueLoaded) {
					uniqueBooksLoading = true;
				}

				try {
					const accessToken = get(authStore).session?.access_token ?? null;
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

			fetchHistory(get(authStore).session?.access_token ?? null)
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
	});
</script>

<svelte:head>
	<title>{t('recommendations.title')} — {t('shared.header.siteName')}</title>
	<meta name="description" content={t('recommendations.metaDescription')} />
</svelte:head>

<div class="recommendations-page">
	{#if viewMode === 'loading'}
		<h1 class="recommendations-page__title recommendations-page__title--spaced typ-display2 typ-display2--content">{t('recommendations.title')}</h1>
		<RecommendationsLoading />
	{:else if viewMode === 'error' || viewMode === 'empty'}
		<RecommendationsEmpty
			ratedCount={$ratingsStore.size}
			message={error ?? t('recommendations.noRecommendationsYet')}
		/>
	{:else if viewMode === 'history'}
		<h1
			class="recommendations-page__title recommendations-page__title--spaced typ-display2 typ-display2--content"
		>{t('recommendations.myRecommendations')}</h1>

		<div class="recommendations-page__toolbar">
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

		<div class="recommendations-page__unique">
			{#if uniqueBooksLoading}
				<BookCardGridSkeleton
					class="recommendations-page__unique-grid"
					ariaLabel={t('recommendations.allUniqueTitles')}
				/>
			{:else if currentHistoryBooks.length === 0}
				<p class="recommendations-page__empty">{t('recommendations.emptyRecommendedTab')}</p>
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
								notInterested={$notInterestedStore.has(book.book_id)}
								onNotInterested={() => handleNotInterested(book)}
							/>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
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
	.recommendations-page__toolbar {
		display: flex;
		justify-content: flex-end;
		align-self: stretch;
		margin: 0 0 var(--space-5) 0;
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
</style>
