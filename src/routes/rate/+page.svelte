<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import BookCard from '$lib/components/BookCard.svelte';
	import RatingsBar from '$lib/components/RatingsBar.svelte';
	import { getStarterBooks, searchBooks, getBookById } from '$lib/data/dummyBooks';
	import { ratingsStore } from '$lib/stores/ratings';
	import type { Book, RatingValue } from '$lib/types/book';

	const SCROLL_THRESHOLD = 60;

	let searchQuery = $state('');
	let debouncedQuery = $state('');
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let lastScrollY = $state(0);
	let headerVisible = $state(true);

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

	onMount(() => {
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
		return () => window.removeEventListener('scroll', handleScroll);
	});

	const starterBooks = $derived(getStarterBooks());
	const searchResults = $derived(
		debouncedQuery.trim() ? searchBooks(debouncedQuery) : []
	);
	const isSearching = $derived(debouncedQuery.trim().length > 0);

	const ratedEntries = $derived(
		Array.from($ratingsStore.entries())
			.map(([bookId, rating]) => {
				const book = getBookById(bookId);
				return book ? { book, rating } : null;
			})
			.filter((e): e is { book: Book; rating: RatingValue } => e !== null)
	);

	const ratedCount = $derived($ratingsStore.size);
	const showBottomBar = $derived(ratedCount >= 1);
	const canGetRecommendations = $derived(ratedCount >= 10);

	function handleSubmit() {
		if (canGetRecommendations) {
			goto('/rate/recommendations');
		}
	}
</script>

<div class="rate-page">
	<header
		class="rate-page__sticky-header"
		class:rate-page__sticky-header--hidden={!headerVisible}
	>
		<h1>Rate books</h1>
		<p class="rate-page__intro">
			Search or pick from popular books below. Rate at least 10 to get recommendations.
		</p>
		<div class="rate-page__search">
			<label for="book-search">Search by title or author</label>
			<input
				id="book-search"
				type="search"
				autocomplete="off"
				placeholder="e.g. Tolkien, 1984"
				bind:value={searchQuery}
				aria-describedby="search-hint"
			/>
			<span id="search-hint" class="rate-page__hint">
				Results update as you type.
			</span>
		</div>
	</header>

	<div class="rate-page__content">
	{#if isSearching}
		<h2 class="rate-page__section-title">Search results</h2>
		{#if searchResults.length === 0}
			<p class="rate-page__empty">No books match.</p>
		{:else}
			<ul class="rate-page__list">
				{#each searchResults as book (book.id)}
					<li>
						<BookCard {book} />
					</li>
				{/each}
			</ul>
		{/if}
	{:else}
		<h2 class="rate-page__section-title">Popular books</h2>
		<ul class="rate-page__list">
			{#each starterBooks as book (book.id)}
				<li>
					<BookCard {book} />
				</li>
			{/each}
		</ul>
	{/if}
	</div>

	{#if showBottomBar}
		<div class="rate-page__bottom-bar">
			<RatingsBar ratedEntries={ratedEntries} />
			{#if canGetRecommendations}
				<button
					type="button"
					class="rate-page__cta"
					onclick={handleSubmit}
				>
					Get Book Recommendations
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.rate-page {
		/* Extra bottom padding for sticky bar + FAB; main.rate-page adds base */
		padding-bottom: 0;
	}
	.rate-page__sticky-header {
		position: sticky;
		top: 0;
		z-index: 50;
		background: var(--color-bg);
		padding-bottom: 1rem;
		margin-bottom: 0.5rem;
		transition: transform 0.25s ease;
	}
	.rate-page__sticky-header--hidden {
		transform: translateY(-100%);
	}
	.rate-page__sticky-header h1 {
		font-size: 1.5rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		margin: 0 0 0.5rem 0;
	}
	.rate-page__intro {
		color: var(--color-text-muted);
		margin: 0 0 1.5rem 0;
		font-size: 0.9375rem;
		line-height: 1.5;
	}
	.rate-page__search {
		margin-bottom: 0;
	}
	.rate-page__content {
		/* scrollable content below header */
	}
	.rate-page__bottom-bar {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 100;
		padding: 0.75rem 1rem;
		padding-bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
		background: var(--color-bg);
		box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.08);
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
		justify-content: space-between;
	}
	.rate-page__cta {
		min-height: var(--min-tap);
		padding: 0.75rem 1.5rem;
		font-size: 0.9375rem;
		font-weight: 500;
		background: var(--color-accent);
		color: #fff;
		border: none;
		border-radius: 9999px;
		cursor: pointer;
		transition: opacity 0.15s ease;
	}
	.rate-page__cta:hover {
		opacity: 0.92;
	}
	.rate-page__cta:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.rate-page__search label {
		display: block;
		font-weight: 500;
		font-size: 0.875rem;
		margin-bottom: 0.375rem;
	}
	.rate-page__search input {
		width: 100%;
		min-height: var(--min-tap);
		padding: 0.625rem 0.875rem;
		font-size: 1rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
		transition: border-color 0.15s ease, box-shadow 0.15s ease;
	}
	.rate-page__search input:focus {
		outline: none;
		border-color: var(--color-focus);
		box-shadow: 0 0 0 3px var(--color-accent-bg);
	}
	.rate-page__hint {
		display: block;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
	}
	.rate-page__section-title {
		font-size: 1.0625rem;
		font-weight: 600;
		margin: 0 0 0.75rem 0;
		color: var(--color-text-muted);
	}
	.rate-page__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		/* Single column when narrow; multi-column only when each card fits stars in one line (~12rem) */
		grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
		gap: 0.5rem;
	}
	@media (min-width: 640px) {
		.rate-page__list {
			gap: 0.6rem;
		}
	}
	.rate-page__list li {
		margin: 0;
		min-height: 0;
	}
	.rate-page__empty {
		color: var(--color-text-muted);
		margin: 1rem 0;
	}
</style>
