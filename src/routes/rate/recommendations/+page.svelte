<script lang="ts">
	import { page } from '$app/stores';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import Button from '$lib/components/Button.svelte';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookCardSkeleton from '$lib/components/BookCardSkeleton.svelte';
	import RecommendationsEmpty from '$lib/components/RecommendationsEmpty.svelte';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { recommendationsCountStore } from '$lib/stores/recommendationsCount';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import RecommendationsLoading from '$lib/components/RecommendationsLoading.svelte';
	import { authStore } from '$lib/stores/auth';
	import { ratingsStore } from '$lib/stores/ratings';
	import { t } from '$lib/copy';
	import type { Book } from '$lib/types/book';

	type RecommendationRun = { request_id: string; created_at: string };

	const POLL_INTERVAL_MS = 3000;
	const POLL_TIMEOUT_MS = 60000;

	let books = $state<Book[]>([]);
	let runs = $state<RecommendationRun[]>([]);
	let uniqueBooks = $state<Book[]>([]);
	let uniqueBooksLoading = $state(false);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let timedOut = $state(false);
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let viewMode = $state<'loading' | 'history' | 'empty' | 'single' | 'timedOut' | 'error'>('loading');
	let gridEl: HTMLUListElement | null = null;

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

	async function fetchUniqueBooks(accessToken: string | null): Promise<Book[]> {
		const headers: Record<string, string> = {};
		if (accessToken) {
			headers['Authorization'] = `Bearer ${accessToken}`;
		}
		const res = await fetch('/api/recommendations/unique', { headers });
		if (!res.ok) return [];
		const data: { books: Book[] } = await res.json();
		return data.books ?? [];
	}

	function formatRunDate(createdAt: string): string {
		if (!createdAt) return '';
		const d = new Date(createdAt);
		return Number.isNaN(d.getTime()) ? createdAt : d.toLocaleDateString(undefined, {
			dateStyle: 'medium'
		});
	}

	function handleNotInterested(book: Book) {
		const bid = book.book_id ?? 0;
		const wasNotInterested = notInterestedStore.has(bid);
		const nowNotInterested = notInterestedStore.toggle(bid);
		// Mutually exclusive with bookmark: when marking not interested, remove from bookmarks
		if (!wasNotInterested && planToReadStore.has(book.id)) {
			planToReadStore.toggle(book.id, book.book_id);
		}
		// Keep header count in sync (book stays in list for undo)
		if (nowNotInterested) {
			recommendationsCountStore.update((n) => Math.max(0, n - 1));
		} else {
			recommendationsCountStore.update((n) => n + 1);
		}
	}

	function handleBookmark(book: Book, id: string) {
		const wasBookmarked = planToReadStore.has(book.id);
		planToReadStore.toggle(id, book.book_id);
		// Mutually exclusive with not interested: when adding bookmark, clear not interested
		if (!wasBookmarked && book.book_id != null) {
			notInterestedStore.remove(book.book_id);
		}
	}

	// React to URL changes (client-side navigation from history "View" link, etc.)
	$effect(() => {
		const url = $page.url;
		const requestId = url.searchParams.get('request_id')?.trim() ?? null;
		const fromHistory = url.searchParams.get('from') === 'history';
		const accessToken = $authStore.session?.access_token ?? null;

		// Clean up previous poll when URL or effect re-runs
		if (pollTimer != null) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}

		if (requestId) {
			if (fromHistory) {
				loading = true;
				error = null;
				viewMode = 'loading';
				const requestedId = requestId;
				fetchRecommendations(accessToken, requestId)
					.then(({ books: nextBooks }) => {
						// Only apply if still on this request (user didn't navigate away)
						if ($page.url.searchParams.get('request_id')?.trim() === requestedId) {
							books = nextBooks;
							viewMode = 'single';
						}
					})
					.catch((e) => {
						if ($page.url.searchParams.get('request_id')?.trim() === requestedId) {
							error = e instanceof Error ? e.message : t('recommendations.failedToLoad');
							viewMode = 'error';
						}
					})
					.finally(() => {
						if ($page.url.searchParams.get('request_id')?.trim() === requestedId) {
							loading = false;
						}
					});
				return;
			}

			const start = Date.now();

			const schedule = async () => {
				let done = false;
				try {
					const { books: nextBooks } = await fetchRecommendations(accessToken, requestId);
					if (nextBooks.length > 0) {
						books = nextBooks;
						loading = false;
						error = null;
						timedOut = false;
						viewMode = 'single';
						done = true;
					} else if (Date.now() - start >= POLL_TIMEOUT_MS) {
						timedOut = true;
						loading = false;
						error = null;
						viewMode = 'timedOut';
						done = true;
					}
				} catch (e) {
						error = e instanceof Error ? e.message : t('recommendations.failedToLoad');
					viewMode = 'error';
					loading = false;
					done = true;
				}

				if (done) {
					if (pollTimer != null) {
						clearTimeout(pollTimer);
						pollTimer = null;
					}
				} else {
					pollTimer = setTimeout(schedule, POLL_INTERVAL_MS);
				}
			};

			loading = true;
			error = null;
			timedOut = false;
			viewMode = 'loading';
			schedule();
		} else {
			loading = true;
			error = null;
			fetchHistory(accessToken)
				.then((historyRuns) => {
					if (!$page.url.searchParams.get('request_id')?.trim()) {
						runs = historyRuns;
						viewMode = historyRuns.length === 0 ? 'empty' : 'history';
						if (historyRuns.length === 0) {
							recommendationsCountStore.set(0);
						} else if (historyRuns.length > 0) {
							uniqueBooksLoading = true;
							fetchUniqueBooks(accessToken).then((list) => {
								uniqueBooks = list;
								recommendationsCountStore.set(list.length);
								uniqueBooksLoading = false;
							});
						}
					}
				})
				.catch((e) => {
					if (!$page.url.searchParams.get('request_id')?.trim()) {
						error = e instanceof Error ? e.message : t('recommendations.failedToLoadHistory');
						viewMode = 'error';
					}
				})
				.finally(() => {
					if (!$page.url.searchParams.get('request_id')?.trim()) {
						loading = false;
					}
				});
		}
	});
</script>

<div class="recommendations-page">
	{#if viewMode === 'loading'}
		<h1 class="recommendations-page__title recommendations-page__title--spaced typ-display2">{t('recommendations.title')}</h1>
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
		<h1 class="recommendations-page__title typ-display2">{t('recommendations.myRecommendations')}</h1>

		<section class="recommendations-page__unique" aria-labelledby="unique-books-heading">
			<h2 id="unique-books-heading" class="recommendations-page__unique-heading typ-body">
				{#if uniqueBooksLoading}
					{t('recommendations.allUniqueTitles')}
				{:else}
					{t('recommendations.uniqueBooksCount', { count: uniqueBooks.length })}{uniqueBooks.length === 1 ? '' : t('recommendations.uniqueBooksCountPlural')}
				{/if}
			</h2>
			{#if uniqueBooksLoading}
				<ul class="recommendations-page__unique-grid book-card-grid" aria-busy="true" aria-label={t('recommendations.allUniqueTitles')}>
					{#each Array(6) as _}
						<li><BookCardSkeleton /></li>
					{/each}
				</ul>
			{:else if uniqueBooks.length > 0}
				<ul class="recommendations-page__unique-grid book-card-grid" aria-label={t('recommendations.allUniqueTitles')}>
					{#each uniqueBooks as book (book.id)}
						<li>
							<BookCard
								context="recommendations"
								{book}
								bookmarked={$planToReadStore.has(book.id)}
								onBookmark={(id) => handleBookmark(book, id)}
								currentRating={$ratingsStore.get(book.id) ?? null}
								onRate={(id, value) => {
									ratingsStore.setRating(id, value, book.book_id, book);
									if (get(planToReadStore).has(id)) planToReadStore.toggle(id, book.book_id);
								}}
								onRemoveRating={(id) => ratingsStore.removeRating(id, book.book_id)}
								notInterested={$notInterestedStore.has(book.book_id ?? 0)}
								onNotInterested={() => handleNotInterested(book)}
							/>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="recommendations-page__batches" aria-labelledby="batches-heading">
			<h2 id="batches-heading" class="recommendations-page__batches-title typ-h3">{t('recommendations.recommendationBatches')}</h2>
			<ul class="recommendations-page__history" aria-label={t('recommendations.aria.pastRuns')}>
				{#each runs as run (run.request_id)}
					<li class="recommendations-page__history-item">
						<span class="recommendations-page__history-date">{formatRunDate(run.created_at)}</span>
						<Button
							href="/rate/recommendations?request_id={encodeURIComponent(run.request_id)}&from=history"
							variant="tertiary"
							compact
							aria-label={t('recommendations.historyView') + ' ' + formatRunDate(run.created_at)}
						>
							{t('recommendations.historyView')}
						</Button>
					</li>
				{/each}
			</ul>
		</section>
	{:else if viewMode === 'single'}
		<h1 class="recommendations-page__title typ-display2">{t('recommendations.title')}</h1>
		{#if $page.url.searchParams.get('from') === 'history'}
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
			<ul
				role="grid"
				aria-label={t('recommendations.aria.recommendedBooks')}
				class="recommendations-page__list book-card-grid"
				bind:this={gridEl}
				onkeydown={handleGridKeydown}
			>
				{#each books as book (book.id)}
					<li role="gridcell">
						<BookCard
							context="recommendations"
							{book}
							bookmarked={$planToReadStore.has(book.id)}
							onBookmark={(id) => handleBookmark(book, id)}
							currentRating={$ratingsStore.get(book.id) ?? null}
							onRate={(id, value) => {
								ratingsStore.setRating(id, value, book.book_id, book);
								if (get(planToReadStore).has(id)) planToReadStore.toggle(id, book.book_id);
							}}
							onRemoveRating={(id) => ratingsStore.removeRating(id, book.book_id)}
							notInterested={$notInterestedStore.has(book.book_id ?? 0)}
							onNotInterested={() => handleNotInterested(book)}
						/>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<style>
	.recommendations-page {
		padding-bottom: var(--space-8);
		text-align: center;
	}
	.recommendations-page__title {
		margin: 0 0 var(--space-3) 0;
		text-align: center;
	}
	.recommendations-page__title--spaced {
		margin-bottom: var(--space-8);
	}
	.recommendations-page__unique {
		margin-bottom: var(--space-8);
	}
	.recommendations-page__unique-heading {
		font-weight: var(--font-weight-normal);
		margin: 0 0 var(--space-3) 0;
		text-align: center;
	}
	.recommendations-page__unique-grid {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.recommendations-page__batches {
		margin-bottom: var(--space-8);
	}
	.recommendations-page__batches-title {
		margin: 0 0 var(--space-3) 0;
	}
	.recommendations-page__empty-run {
		color: var(--color-text-muted);
		margin: 0;
	}
	.recommendations-page__history {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.recommendations-page__history-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
	.recommendations-page__history-date {
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--typ-caption-font-weight);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
		color: var(--color-text);
	}
	.recommendations-page__back-wrap {
		margin: 0 0 var(--space-4) 0;
	}
</style>
