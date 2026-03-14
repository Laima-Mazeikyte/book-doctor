<script lang="ts">
	import BookCard from '$lib/components/BookCard.svelte';
	import BookCardSkeleton from '$lib/components/BookCardSkeleton.svelte';
	import RecommendationsEmpty from '$lib/components/RecommendationsEmpty.svelte';
	import { getSupabase } from '$lib/supabase';
	import { authStore } from '$lib/stores/auth';
	import { ratingsStore } from '$lib/stores/ratings';
	import type { Book } from '$lib/types/book';

	let books = $state<Book[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	async function loadRecommendations(accessToken: string | null) {
		loading = true;
		error = null;
		try {
			const requestId =
				typeof window !== 'undefined'
					? new URLSearchParams(window.location.search).get('request_id')?.trim() ?? null
					: null;
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
			books = data.books ?? [];
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load recommendations';
			books = [];
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const session = $authStore.session;
		loadRecommendations(session?.access_token ?? null);
	});
</script>

<div class="recommendations-page">
	{#if loading}
		<h1 class="recommendations-page__title">Recommendations</h1>
		<ul class="recommendations-page__list" aria-label="Loading recommendations…" aria-live="polite">
			{#each Array(6) as _}
				<li><BookCardSkeleton /></li>
			{/each}
		</ul>
	{:else if error || books.length === 0}
		<RecommendationsEmpty
			ratedCount={$ratingsStore.size}
			message={error ?? 'No recommendations yet. Rate more books and try again.'}
		/>
	{:else}
		<h1 class="recommendations-page__title">Recommendations</h1>
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
