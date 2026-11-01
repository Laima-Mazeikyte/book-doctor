<script lang="ts">
	import { untrack } from 'svelte';
	import { get } from 'svelte/store';
	import { BookOpen } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import { bookPath } from '$lib/books/bookUrl';
	import { coverUrlForBookIdAtSize } from '$lib/book-cover';
	import { loadBookConnections, type BookConnection } from '$lib/books/connections';
	import { authStore, authReady } from '$lib/stores/auth';
	import { ratingsStore } from '$lib/stores/ratings';
	import { getSupabase } from '$lib/supabase';

	let { bookId, imagesReady = false }: { bookId: string; imagesReady?: boolean } = $props();
	let connections = $state<BookConnection[]>([]);
	let status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	// A token refresh for the same reader is not a new page visit.
	const readerId = $derived(
		$authReady && $authStore.session ? ($authStore.user?.id ?? null) : null
	);

	$effect(() => {
		const owner = readerId;
		const target = bookId;
		const ready = imagesReady;
		connections = [];
		status = 'idle';
		if (!owner || !ready) return;
		const controller = new AbortController();
		status = 'loading';
		untrack(() => {
			const supabase = getSupabase();
			if (!supabase) {
				status = 'error';
				return;
			}
			// Metadata is a snapshot too: local rating edits never retrigger the query.
			void loadBookConnections(
				supabase,
				target,
				controller.signal,
				get(ratingsStore.ratedBooksDetails).values()
			)
				.then((result) => {
					if (controller.signal.aborted) return;
					connections = result;
					status = 'ready';
				})
				.catch(() => {
					if (!controller.signal.aborted) status = 'error';
				});
		});
		return () => controller.abort();
	});
</script>

{#if status === 'loading' || status === 'error' || connections.length}
	<section class="book-connections" aria-labelledby="book-connections-title">
		<h2 id="book-connections-title">Similar books you’ve read</h2>
		{#if status === 'loading'}
			<p class="muted" role="status">Loading connections…</p>
		{:else if status === 'error'}
			<p class="muted">Book connections are temporarily unavailable.</p>
		{:else}
			<div class="reference-books">
				{#each connections as connection (connection.book.book_id)}
					{@const item = connection.book}
					{@const cover = coverUrlForBookIdAtSize(item.book_id, 200)}
					<a class="mini-book" href={resolve(bookPath(item))}>
						{#if cover}
							<img
								src={cover}
								alt=""
								width="200"
								height="300"
								loading="lazy"
								fetchpriority="low"
								decoding="async"
								onerror={(event) => {
									(event.currentTarget as HTMLImageElement).style.visibility = 'hidden';
								}}
							/>
						{:else}
							<span class="mini-cover"><BookOpen size={22} aria-hidden="true" /></span>
						{/if}
						<span
							><strong>{item.title}</strong><span class="muted">{item.author}</span>
							<span class="muted">Your rating: {connection.rating} / 5</span></span
						>
					</a>
				{/each}
			</div>
		{/if}
	</section>
{/if}

<style>
	h2 {
		font-size: 1.2rem;
		margin-top: 1.75rem;
	}
	.muted {
		font-family: var(--font-family-interactive);
		font-size: 0.85rem;
	}
	.reference-books {
		display: grid;
		gap: 1rem;
		margin-block: 1rem;
	}
	.mini-book {
		display: flex;
		align-items: start;
		gap: 0.7rem;
		text-decoration: none;
		min-width: 0;
		color: var(--color-text);
	}
	.mini-book img,
	.mini-cover {
		width: 3.2rem;
		height: auto;
		aspect-ratio: 2 / 3;
		object-fit: cover;
		border-radius: var(--radius-sm);
		flex-shrink: 0;
	}
	.mini-cover {
		display: grid;
		place-items: center;
		background: var(--color-bg-muted);
	}
	.mini-book strong {
		display: block;
		font-family: var(--font-family-content);
		font-size: 1rem;
		font-weight: 400;
	}
	.mini-book .muted {
		display: block;
		font-size: 0.75rem;
	}
</style>
