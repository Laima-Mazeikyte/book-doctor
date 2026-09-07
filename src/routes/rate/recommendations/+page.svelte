<script lang="ts">
	import {
		normalizeDimensionMatchSnapshots,
		type DimensionMatchSnapshotsByBookId
	} from '$lib/recommendations/dimensionMatches';
	import { browser } from '$app/environment';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookCardGridSkeleton from '$lib/components/BookCardGridSkeleton.svelte';
	import RecommendationsEmpty from '$lib/components/RecommendationsEmpty.svelte';
	import { ChevronDown } from 'lucide-svelte';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import { recommendationsCountStore } from '$lib/stores/recommendationsCount';
	import RecommendationsLoading from '$lib/components/RecommendationsLoading.svelte';
	import { authStore } from '$lib/stores/auth';
	import { ratingsStore } from '$lib/stores/ratings';
	import {
		coverPriorityFor,
		estimateGridColumns,
		trackGridColumns
	} from '$lib/components/book-card/coverPriority';
	import {
		buildCleanLikedAuthorSet,
		filterAuthorRelationshipAuthors,
		type AuthorRelationshipAuthorsByBookId
	} from '$lib/recommendations/authorRelationships';
	import { filterRatedLikedBookPrecedents } from '$lib/recommendations/likedBookPrecedents';
	import {
		createEmptyRecommendationsUniquePayload,
		recommendationsPageStore,
		type RecommendationsUniquePayload
	} from '$lib/stores/recommendationsPage';
	import {
		isValidRecSortId,
		sortRecHistoryBooks,
		type RecSortId
	} from '$lib/recommendations/sortRecHistoryBooks';
	import { ratedSummarySheetKeepAlive } from '$lib/stores/ratedSummarySheetKeepAlive';
	import { t } from '$lib/copy';
	import type { Book } from '$lib/types/book';

	const LS_SORT_KEY = 'book-doctor:recommendations-sort';

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

	if (browser) recommendationsPageStore.ensureUser(get(authStore).user?.id ?? null);
	let activeUserId: string | null = null;
	const initialSnapshot = recommendationsPageStore.getSnapshot();

	let uniquePayload = $state<RecommendationsUniquePayload>(initialSnapshot.unique);
	let uniqueLoaded = $state(initialSnapshot.uniqueLoaded);
	let uniqueBooksLoading = $state(!initialSnapshot.uniqueLoaded);
	let error = $state<string | null>(null);
	let viewMode = $state<'loading' | 'history' | 'empty' | 'error'>(
		initialSnapshot.uniqueLoaded
			? initialSnapshot.unique.hasRuns
				? 'history'
				: 'empty'
			: 'loading'
	);
	let activeRouteLoadId = 0;
	let gridColumns = $state(estimateGridColumns());
	let sortOrder = $state<RecSortId>(readRecSortFromLs());

	const ratedBooksStore = ratingsStore.ratedBooks;
	const cleanLikedAuthorNames = $derived(buildCleanLikedAuthorSet($ratedBooksStore));
	const authorRelationshipAuthorsForDisplay = $derived.by((): AuthorRelationshipAuthorsByBookId => {
		const filtered: AuthorRelationshipAuthorsByBookId = {};
		for (const [bookId, candidates] of Object.entries(
			uniquePayload.authorRelationshipAuthorsByBookId
		)) {
			filtered[bookId] = filterAuthorRelationshipAuthors(candidates, cleanLikedAuthorNames);
		}
		return filtered;
	});
	const likedBookPrecedentsForDisplay = $derived.by((): Record<string, Book[]> => {
		const filtered: Record<string, Book[]> = {};
		for (const [bookId, precedents] of Object.entries(uniquePayload.likedBookPrecedentsByBookId)) {
			filtered[bookId] = filterRatedLikedBookPrecedents(precedents, $ratingsStore);
		}
		return filtered;
	});

	const recommendedRawList = $derived.by(() =>
		uniquePayload.books.filter(
			(book) => !$notInterestedStore.has(book.book_id) && !$ratingsStore.has(book.id)
		)
	);

	const recommendedTabBooks = $derived.by(() =>
		sortRecHistoryBooks(
			recommendedRawList,
			sortOrder,
			uniquePayload.lastRecommendedAt,
			uniquePayload.recommendationAppearanceCount,
			uniquePayload.bestRecommendationRank
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

	$effect(() => {
		if (uniqueLoaded) recommendationsCountStore.set(recommendedRawList.length);
	});

	async function fetchUniqueBooks(
		accessToken: string | null
	): Promise<RecommendationsUniquePayload> {
		const headers: Record<string, string> = {};
		if (accessToken) {
			headers['Authorization'] = `Bearer ${accessToken}`;
		}
		const res = await fetch('/api/recommendations/unique', { headers });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data: {
			books?: Book[];
			hasRuns?: boolean;
			lastRecommendedAt?: Record<string, number>;
			recommendationAppearanceCount?: Record<string, number>;
			bestRecommendationRank?: Record<string, number>;
			likedBookPrecedentsByBookId?: Record<string, Book[]>;
			authorRelationshipAuthorsByBookId?: AuthorRelationshipAuthorsByBookId;
			dimensionMatchSnapshotsByBookId?: DimensionMatchSnapshotsByBookId;
		} = await res.json();
		if (!Array.isArray(data.books) || typeof data.hasRuns !== 'boolean') {
			throw new Error('Invalid recommendation response');
		}
		return {
			books: data.books,
			hasRuns: data.hasRuns,
			lastRecommendedAt: data.lastRecommendedAt ?? {},
			recommendationAppearanceCount: data.recommendationAppearanceCount ?? {},
			bestRecommendationRank: data.bestRecommendationRank ?? {},
			likedBookPrecedentsByBookId: data.likedBookPrecedentsByBookId ?? {},
			authorRelationshipAuthorsByBookId: data.authorRelationshipAuthorsByBookId ?? {},
			dimensionMatchSnapshotsByBookId: normalizeDimensionMatchSnapshots(
				data.dimensionMatchSnapshotsByBookId
			)
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
	}

	function handleBookmark(book: Book, id: string) {
		const wasBookmarked = planToReadStore.has(book.id);
		planToReadStore.toggle(id, book.book_id);
		if (!wasBookmarked) {
			notInterestedStore.remove(book.book_id);
		}
	}

	function isActiveRouteLoad(loadId: number): boolean {
		return (
			loadId === activeRouteLoadId &&
			activeUserId === (get(authStore).user?.id ?? null) &&
			page.url.pathname === '/rate/recommendations' &&
			!page.url.searchParams.get('request_id')?.trim()
		);
	}

	function applyUniquePayload(
		payload: RecommendationsUniquePayload,
		{
			loaded = true,
			persist = false,
			errorMessage = null
		}: { loaded?: boolean; persist?: boolean; errorMessage?: string | null } = {}
	) {
		uniquePayload = payload;
		uniqueLoaded = loaded;
		error = errorMessage;
		viewMode = errorMessage
			? 'error'
			: loaded
				? payload.hasRuns
					? 'history'
					: 'empty'
				: 'loading';
		if (persist) recommendationsPageStore.setUnique(payload);
	}

	function applyCachedSnapshot(snapshot = recommendationsPageStore.getSnapshot()) {
		applyUniquePayload(snapshot.unique, { loaded: snapshot.uniqueLoaded });
		uniqueBooksLoading = !snapshot.uniqueLoaded;
	}

	/** Legacy and external links: ?request_id= opens the shortlist route. */
	$effect(() => {
		if (!browser) return;
		const url = page.url;
		if (url.pathname !== '/rate/recommendations') return;
		const requestId = url.searchParams.get('request_id')?.trim();
		if (!requestId) return;
		const params = new SvelteURLSearchParams({ request_id: requestId });
		if (url.searchParams.get('from') === 'history') params.set('from', 'history');
		void goto(resolve(`/rate/recommendations/shortlist?${params.toString()}`), {
			replaceState: true
		});
	});

	$effect(() => {
		const url = page.url;
		if (url.pathname !== '/rate/recommendations') return;
		if (url.searchParams.get('request_id')?.trim()) return;

		// Re-fetch when the signed-in user changes, not when the access token refreshes alone
		// (e.g. anonymous → permanent on the same user id should keep the current list).
		const userId = $authStore.user?.id ?? null;
		const loadId = ++activeRouteLoadId;
		activeUserId = userId;
		recommendationsPageStore.ensureUser(userId);

		const cachedSnapshot = recommendationsPageStore.getSnapshot();
		applyCachedSnapshot(cachedSnapshot);

		const refreshUniqueBooks = async (): Promise<void> => {
			if (!cachedSnapshot.uniqueLoaded) {
				uniqueBooksLoading = true;
			}

			try {
				const accessToken = get(authStore).session?.access_token ?? null;
				const payload = await fetchUniqueBooks(accessToken);
				if (!isActiveRouteLoad(loadId)) return;
				applyUniquePayload(payload, { persist: true });
			} catch (e) {
				if (!isActiveRouteLoad(loadId)) return;
				console.error('[recommendations] Failed to load unique recommendations:', e);
				if (!cachedSnapshot.uniqueLoaded) {
					applyUniquePayload(createEmptyRecommendationsUniquePayload(), {
						loaded: false,
						errorMessage: t('recommendations.failedToLoad')
					});
				}
			} finally {
				if (isActiveRouteLoad(loadId)) {
					uniqueBooksLoading = false;
				}
			}
		};

		void refreshUniqueBooks();
	});
</script>

<svelte:head>
	<title>{t('recommendations.title')} — {t('shared.header.siteName')}</title>
	<meta name="description" content={t('recommendations.metaDescription')} />
</svelte:head>

<div class="recommendations-page">
	{#if viewMode === 'loading'}
		<h1
			class="recommendations-page__title recommendations-page__title--spaced typ-display2 typ-display2--content"
		>
			{t('recommendations.title')}
		</h1>
		<RecommendationsLoading />
	{:else if viewMode === 'error' || viewMode === 'empty'}
		<RecommendationsEmpty
			ratedCount={$ratingsStore.size}
			message={error ?? t('recommendations.noRecommendationsYet')}
		/>
	{:else if viewMode === 'history'}
		<h1
			class="recommendations-page__title recommendations-page__title--spaced typ-display2 typ-display2--content"
		>
			{t('recommendations.myRecommendations')}
		</h1>

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
				<ul
					class="recommendations-page__unique-grid book-card-grid"
					aria-label={t('recommendations.allUniqueTitles')}
					use:trackGridColumns={(columns) => (gridColumns = columns)}
				>
					{#each currentHistoryBooks as book, i (book.id)}
						<li>
							<BookCard
								context="recommendations"
								{book}
								coverPriority={coverPriorityFor(i, gridColumns)}
								likedBookPrecedents={likedBookPrecedentsForDisplay[book.book_id] ?? []}
								authorRelationshipAuthors={authorRelationshipAuthorsForDisplay[book.book_id] ?? []}
								dimensionMatches={uniquePayload.dimensionMatchSnapshotsByBookId[book.book_id]
									?.matches ?? []}
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
