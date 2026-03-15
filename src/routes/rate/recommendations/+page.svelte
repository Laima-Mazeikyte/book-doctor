<script lang="ts">
	import { page } from '$app/stores';
	import BookCard from '$lib/components/BookCard.svelte';
	import RecommendationsEmpty from '$lib/components/RecommendationsEmpty.svelte';
	import RecommendationsLoading from '$lib/components/RecommendationsLoading.svelte';
	import { authStore } from '$lib/stores/auth';
	import { ratingsStore } from '$lib/stores/ratings';
	import Button from '$lib/components/Button.svelte';
	import type { Book } from '$lib/types/book';

	type RecommendationRun = { request_id: string; created_at: string };

	const POLL_INTERVAL_MS = 3000;
	const POLL_TIMEOUT_MS = 60000;

	let books = $state<Book[]>([]);
	let runs = $state<RecommendationRun[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let timedOut = $state(false);
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let viewMode = $state<'loading' | 'history' | 'empty' | 'single' | 'timedOut' | 'error'>('loading');

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

	function formatRunDate(createdAt: string): string {
		if (!createdAt) return '';
		const d = new Date(createdAt);
		return Number.isNaN(d.getTime()) ? createdAt : d.toLocaleDateString(undefined, {
			dateStyle: 'medium'
		});
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
							error = e instanceof Error ? e.message : 'Failed to load recommendations';
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
					error = e instanceof Error ? e.message : 'Failed to load recommendations';
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
					}
				})
				.catch((e) => {
					if (!$page.url.searchParams.get('request_id')?.trim()) {
						error = e instanceof Error ? e.message : 'Failed to load recommendation history';
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
		<h1 class="recommendations-page__title">Recommendations</h1>
		<RecommendationsLoading />
	{:else if viewMode === 'timedOut'}
		<RecommendationsEmpty
			ratedCount={$ratingsStore.size}
			message="Taking longer than expected. Please try again later."
		/>
	{:else if viewMode === 'error' || viewMode === 'empty'}
		<RecommendationsEmpty
			ratedCount={$ratingsStore.size}
			message={error ?? 'No recommendations yet. Rate more books and try again.'}
		/>
	{:else if viewMode === 'history'}
		<h1 class="recommendations-page__title">My recommendations</h1>
		<p class="recommendations-page__back">
			<a href="/rate">Back to rating</a>
		</p>
		<ul class="recommendations-page__history" aria-label="Past recommendation runs">
			{#each runs as run (run.request_id)}
				<li class="recommendations-page__history-item">
					<span class="recommendations-page__history-date">{formatRunDate(run.created_at)}</span>
					<a href="/rate/recommendations?request_id={encodeURIComponent(run.request_id)}&from=history" class="recommendations-page__history-link">
						<Button variant="secondary" compact>View</Button>
					</a>
				</li>
			{/each}
		</ul>
	{:else if viewMode === 'single'}
		<h1 class="recommendations-page__title">Recommendations</h1>
		<p class="recommendations-page__back">
			<a href="/rate/recommendations">Back to list</a>
			·
			<a href="/rate">Back to rating</a>
		</p>
		{#if books.length === 0}
			<p class="recommendations-page__empty-run">No books in this recommendation run.</p>
		{:else}
			<ul class="recommendations-page__list" aria-label="Recommended books">
				{#each books as book (book.id)}
					<li><BookCard {book} /></li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<style>
	.recommendations-page {
		padding-bottom: var(--space-8);
	}
	.recommendations-page__title {
		font-size: var(--font-size-2xl);
		margin: 0 0 var(--space-4) 0;
	}
	.recommendations-page__back {
		margin: 0 0 var(--space-4) 0;
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
		font-size: var(--font-size-base);
		color: var(--color-text);
	}
	.recommendations-page__history-link {
		text-decoration: none;
	}
	.recommendations-page__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
		gap: var(--space-2);
	}
	@media (min-width: 640px) {
		.recommendations-page__list {
			gap: var(--space-3);
		}
	}
	.recommendations-page__list li {
		margin: 0;
		min-height: 0;
	}
</style>
