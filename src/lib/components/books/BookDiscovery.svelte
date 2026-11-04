<script lang="ts">
	import { untrack } from 'svelte';
	import { BookOpen } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import { bookPath } from '$lib/books/bookUrl';
	import { coverUrlForBookIdAtSize } from '$lib/book-cover';
	import {
		loadBookDiscovery,
		visibleDiscoveryBooks,
		discoveryReason,
		type BookDiscoveryResult
	} from '$lib/books/discovery';
	import { getSupabase } from '$lib/supabase';
	import { authStore, authReady } from '$lib/stores/auth';
	import { ratingsStore } from '$lib/stores/ratings';
	import { userLibraryHydrationStore } from '$lib/stores/userLibrary';
	import { librarySaves } from '$lib/stores/librarySaves';

	let { bookId, imagesReady = false }: { bookId: string; imagesReady?: boolean } = $props();
	let result = $state<BookDiscoveryResult | null>(null);
	let status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let attempt = $state(0);
	const details = ratingsStore.ratedBooksDetails;
	const libraryOwner = $derived($librarySaves.ownerId);
	const readIds = $derived.by(() => {
		const ratings = $ratingsStore;
		const books = $details;
		const owner = $authStore.user?.id;
		const hydration = $userLibraryHydrationStore;
		// Never apply the previous account's library while the new one loads.
		if (
			owner
				? libraryOwner !== owner ||
					hydration.userId !== owner ||
					!hydration.collections.ratings.hasSnapshot
				: !libraryOwner.startsWith('guest:')
		)
			return new Set<string>();
		const snapshot = ratingsStore.getSnapshot();
		return new Set(
			snapshot
				? snapshot.entries.map((entry) => entry.book_id)
				: [...books.values()].filter((book) => ratings.has(book.id)).map((book) => book.book_id)
		);
	});
	const sections = $derived(
		result?.bookId === bookId
			? [
					{
						id: 'similar-title',
						title: 'Similar experience',
						books: visibleDiscoveryBooks(result.similarExperience, readIds)
					},
					{
						id: 'different-title',
						title: 'A different direction',
						books: visibleDiscoveryBooks(result.differentDirection, readIds)
					}
				].filter((section) => section.books.length)
			: []
	);

	$effect(() => {
		const target = bookId;
		const ready = imagesReady && $authReady;
		void attempt;
		result = null;
		status = 'idle';
		if (!ready) return;
		const controller = new AbortController();
		status = 'loading';
		untrack(() => {
			const supabase = getSupabase();
			if (!supabase) {
				status = 'error';
				return;
			}
			void loadBookDiscovery(supabase, target, controller.signal)
				.then((data) => {
					if (controller.signal.aborted) return;
					result = data;
					status = 'ready';
				})
				.catch(() => {
					if (!controller.signal.aborted) status = 'error';
				});
		});
		return () => controller.abort();
	});
</script>

{#if status === 'loading' || status === 'error' || sections.length}
	<div class="discovery-sections" class:single-section={sections.length === 1}>
		{#if status === 'loading'}
			<p class="discovery-status" role="status">Loading related books…</p>
		{:else if status === 'error'}
			<div class="discovery-status">
				<p>Related books are temporarily unavailable.</p>
				<button onclick={() => attempt++}>Try again</button>
			</div>
		{:else}
			{#each sections as section (section.id)}
				<section aria-labelledby={section.id}>
					<h2 id={section.id}>{section.title}</h2>
					<ul class="discovery-books">
						{#each section.books as item (item.book_id)}
							{@const cover = coverUrlForBookIdAtSize(item.book_id, 200)}
							{@const reason = discoveryReason(item.reason)}
							<li>
								<a class="mini-book" href={resolve(bookPath(item))}>
									<span class="mini-cover">
										<BookOpen size={22} aria-hidden="true" />
										{#if cover}<img
												src={cover}
												alt=""
												width="200"
												height="300"
												loading="lazy"
												fetchpriority="low"
												decoding="async"
												onerror={(event) =>
													((event.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
											/>{/if}
									</span>
									<span class="book-label"
										><strong>{item.title}</strong><span class="author">{item.author}</span>
										{#if reason}<span class="reason">{reason}</span>{/if}
									</span>
								</a>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		{/if}
	</div>
{/if}

<style>
	.discovery-sections {
		grid-column: 1 / 3;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 1.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--color-border);
		min-width: 0;
	}
	.discovery-sections.single-section {
		grid-template-columns: minmax(0, 1fr);
	}
	section {
		min-width: 0;
	}
	section + section {
		border-left: 1px solid var(--color-border);
		padding-left: 1.5rem;
	}
	h2 {
		font-size: 1.5rem;
		line-height: 1.2;
	}
	.discovery-status {
		font-family: var(--font-family-interactive);
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}
	.discovery-status {
		grid-column: 1 / -1;
	}
	.discovery-books {
		list-style: none;
		display: grid;
		gap: 1rem;
		padding: 0;
		margin-block: 1.25rem 0;
	}
	.mini-book {
		display: flex;
		align-items: start;
		gap: 0.7rem;
		text-decoration: none;
		min-width: 0;
		color: var(--color-text);
	}
	.mini-cover {
		position: relative;
		display: grid;
		place-items: center;
		width: 3.2rem;
		aspect-ratio: 2 / 3;
		border-radius: var(--radius-sm);
		flex-shrink: 0;
		overflow: hidden;
		background: var(--color-bg-muted);
	}
	.mini-cover img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.book-label {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	strong {
		display: block;
		font-family: var(--font-family-content);
		font-size: 1rem;
		font-weight: 400;
	}
	.author,
	.reason {
		display: block;
		font-family: var(--font-family-interactive);
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	.reason {
		margin-top: 0.3rem;
	}
	button {
		padding: 0;
		border: 0;
		background: none;
		color: var(--color-text);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
	a:focus-visible,
	button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 4px;
	}
	@media (max-width: 1100px) {
		.discovery-sections {
			grid-column: 1 / -1;
		}
	}
	@media (max-width: 600px) {
		.discovery-sections {
			grid-column: 1;
			grid-template-columns: minmax(0, 1fr);
		}
		section + section {
			border-left: 0;
			border-top: 1px solid var(--color-border);
			padding: 1.5rem 0 0;
		}
	}
</style>
