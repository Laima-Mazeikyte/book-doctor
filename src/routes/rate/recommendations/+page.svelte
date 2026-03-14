<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { page } from '$app/stores';
	import BookCard from '$lib/components/BookCard.svelte';
	import RecommendationsEmpty from '$lib/components/RecommendationsEmpty.svelte';
	import RecommendationsLoading from '$lib/components/RecommendationsLoading.svelte';
	import { authStore } from '$lib/stores/auth';
	import { ratingsStore } from '$lib/stores/ratings';
	import type { Book } from '$lib/types/book';

	const POLL_INTERVAL_MS = 3000;
	const POLL_TIMEOUT_MS = 60000;

	let books = $state<Book[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let timedOut = $state(false);
	let pollTimer: ReturnType<typeof setTimeout> | null = null;

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

	onMount(() => {
		const requestId = get(page).url.searchParams.get('request_id')?.trim() ?? null;
		const accessToken = get(authStore).session?.access_token ?? null;

		if (requestId) {
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
						done = true;
					} else if (Date.now() - start >= POLL_TIMEOUT_MS) {
						timedOut = true;
						loading = false;
						error = null;
						done = true;
					}
				} catch (e) {
					error = e instanceof Error ? e.message : 'Failed to load recommendations';
					// Continue polling on error; will retry next interval
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
			schedule();
		} else {
			(async () => {
				loading = true;
				error = null;
				timedOut = false;
				try {
					const { books: nextBooks } = await fetchRecommendations(accessToken, null);
					books = nextBooks;
				} catch (e) {
					error = e instanceof Error ? e.message : 'Failed to load recommendations';
				} finally {
					loading = false;
				}
			})();
		}
	});

	onDestroy(() => {
		if (pollTimer != null) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
	});
</script>

<div class="recommendations-page">
	{#if loading}
		<h1 class="recommendations-page__title">Recommendations</h1>
		<RecommendationsLoading />
	{:else if timedOut}
		<RecommendationsEmpty
			ratedCount={$ratingsStore.size}
			message="Taking longer than expected. Please try again later."
		/>
	{:else if error || books.length === 0}
		<RecommendationsEmpty
			ratedCount={$ratingsStore.size}
			message={error ?? 'No recommendations yet. Rate more books and try again.'}
		/>
	{:else}
		<h1 class="recommendations-page__title">Recommendations</h1>
		<p class="recommendations-page__back">
			<a href="/rate">Back to rating</a>
		</p>
		<ul class="recommendations-page__list" aria-label="Recommended books">
			{#each books as book (book.id)}
				<li><BookCard {book} /></li>
			{/each}
		</ul>
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
