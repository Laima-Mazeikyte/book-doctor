<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookCardSkeleton from '$lib/components/BookCardSkeleton.svelte';
	import RatingsBar from '$lib/components/RatingsBar.svelte';
	import { getBookById } from '$lib/data/dummyBooks';
	import { ratingsStore } from '$lib/stores/ratings';
	import type { Book, RatingValue } from '$lib/types/book';

	const SCROLL_THRESHOLD = 60;

	// ── Search ─────────────────────────────────────────────────────────────────
	let searchQuery = $state('');
	let debouncedQuery = $state('');
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

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

	// Fire search only when 3+ chars; clear results otherwise.
	$effect(() => {
		const q = debouncedQuery.trim();
		if (q.length >= 3) {
			doSearch(q);
		} else {
			searchResults = [];
			searchError = null;
		}
	});

	const isSearching = $derived(debouncedQuery.trim().length >= 3);

	// ── Header visibility on scroll ────────────────────────────────────────────
	let lastScrollY = $state(0);
	let headerVisible = $state(true);

	// ── Popular books ──────────────────────────────────────────────────────────
	let popularBooks = $state<Book[]>([]);
	let nextOffset = $state(0);
	let hasMore = $state(true);
	let loadingInitial = $state(true);
	let loadingMore = $state(false);
	let popularError = $state<string | null>(null);

	// ── Search results ─────────────────────────────────────────────────────────
	let searchResults = $state<Book[]>([]);
	let loadingSearch = $state(false);
	let searchError = $state<string | null>(null);

	// ── Sentinel for IntersectionObserver (lazy load) ──────────────────────────
	let sentinelEl = $state<HTMLDivElement | undefined>(undefined);

	$effect(() => {
		if (!sentinelEl) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (
					entries[0].isIntersecting &&
					!loadingMore &&
					!loadingInitial &&
					!isSearching &&
					hasMore
				) {
					loadPopular(nextOffset);
				}
			},
			{ rootMargin: '300px' }
		);

		observer.observe(sentinelEl);
		return () => observer.disconnect();
	});

	// ── Book lookup (popular + search + dummy fallback) ────────────────────────
	function findBookById(id: string): Book | undefined {
		return (
			popularBooks.find((b) => b.id === id) ??
			searchResults.find((b) => b.id === id) ??
			getBookById(id)
		);
	}

	// ── Ratings ────────────────────────────────────────────────────────────────
	const ratedEntries = $derived(
		Array.from($ratingsStore.entries())
			.map(([bookId, rating]) => {
				const book = findBookById(bookId);
				return book ? { book, rating } : null;
			})
			.filter((e): e is { book: Book; rating: RatingValue } => e !== null)
	);

	const ratedCount = $derived($ratingsStore.size);
	const showBottomBar = $derived(ratedCount >= 1);
	const canGetRecommendations = $derived(ratedCount >= 10);

	// ── Data fetching ──────────────────────────────────────────────────────────
	async function loadPopular(offset: number) {
		if (offset === 0) {
			loadingInitial = true;
		} else {
			loadingMore = true;
		}
		popularError = null;

		try {
			const res = await fetch(`/api/books/popular?offset=${offset}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data: { books: Book[]; nextOffset: number; fallback?: boolean } = await res.json();

			if (offset === 0) {
				popularBooks = data.books;
			} else {
				popularBooks = [...popularBooks, ...data.books];
			}
			nextOffset = data.nextOffset;
			hasMore = data.books.length > 0;
		} catch {
			popularError = 'Could not load books right now. Showing a default selection.';
		} finally {
			if (offset === 0) {
				loadingInitial = false;
			} else {
				loadingMore = false;
			}
		}
	}

	async function doSearch(query: string) {
		loadingSearch = true;
		searchError = null;

		try {
			const res = await fetch(`/api/books/search?q=${encodeURIComponent(query)}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data: { books: Book[] } = await res.json();
			searchResults = data.books;
		} catch {
			searchError = 'Search failed. Please try again.';
			searchResults = [];
		} finally {
			loadingSearch = false;
		}
	}

	function handleSubmit() {
		if (canGetRecommendations) {
			goto('/rate/recommendations');
		}
	}

	onMount(() => {
		loadPopular(0);

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
</script>

<div class="rate-page">
	<header
		class="rate-page__sticky-header"
		class:rate-page__sticky-header--hidden={!headerVisible}
	>
		<div class="rate-page__search">
			<span class="rate-page__search-icon" aria-hidden="true">
				<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="11" cy="11" r="8"/>
					<path d="m21 21-4.35-4.35"/>
				</svg>
			</span>
			<input
				id="book-search"
				type="search"
				autocomplete="off"
				placeholder="Search books"
				bind:value={searchQuery}
				aria-label="Search books"
			/>
		</div>
	</header>

	<div class="rate-page__content">
		{#if isSearching}
			<!-- ── Search results ── -->
			<h2 class="rate-page__section-title">Search results</h2>

			{#if searchError}
				<div class="rate-page__error" role="alert">
					<span>{searchError}</span>
					<button
						type="button"
						class="rate-page__error-dismiss"
						onclick={() => (searchError = null)}
						aria-label="Dismiss error"
					>✕</button>
				</div>
			{/if}

			{#if loadingSearch}
				<ul class="rate-page__list" aria-label="Searching…" aria-live="polite">
					{#each Array(6) as _}
						<li><BookCardSkeleton /></li>
					{/each}
				</ul>
			{:else if searchResults.length === 0 && !searchError}
				<p class="rate-page__empty">No books found for that search.</p>
			{:else}
				<ul class="rate-page__list">
					{#each searchResults as book (book.id)}
						<li><BookCard {book} /></li>
					{/each}
				</ul>
			{/if}

		{:else}
			<!-- ── Popular books ── -->
			<h2 class="rate-page__section-title">Popular books</h2>

			{#if popularError}
				<div class="rate-page__error" role="alert">
					<span>{popularError}</span>
					<button
						type="button"
						class="rate-page__error-dismiss"
						onclick={() => (popularError = null)}
						aria-label="Dismiss error"
					>✕</button>
				</div>
			{/if}

			{#if loadingInitial}
				<ul class="rate-page__list" aria-label="Loading books…" aria-live="polite">
					{#each Array(8) as _}
						<li><BookCardSkeleton /></li>
					{/each}
				</ul>
			{:else}
				<ul class="rate-page__list">
					{#each popularBooks as book (book.id)}
						<li><BookCard {book} /></li>
					{/each}
				</ul>

				{#if loadingMore}
					<div class="rate-page__spinner-wrap rate-page__spinner-wrap--bottom" aria-live="polite">
						<span class="rate-page__spinner" aria-hidden="true"></span>
					</div>
				{/if}

				<!-- Sentinel triggers lazy load when scrolled into view -->
				{#if hasMore}
					<div bind:this={sentinelEl} class="rate-page__sentinel" aria-hidden="true"></div>
				{/if}
			{/if}
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
		padding-bottom: 0;
	}
	.rate-page__sticky-header {
		position: sticky;
		top: 0;
		z-index: 50;
		background: transparent;
		padding-top: 1rem;
		padding-bottom: 1rem;
		margin-bottom: 0.5rem;
		transition: transform 0.25s ease;
	}
	.rate-page__sticky-header--hidden {
		transform: translateY(-100%);
	}
	.rate-page__search {
		position: relative;
		margin-bottom: 0;
	}
	.rate-page__search-icon {
		position: absolute;
		left: 1rem;
		top: 50%;
		transform: translateY(-50%);
		z-index: 1;
		color: var(--color-text-muted);
		pointer-events: none;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.rate-page__search input {
		width: 100%;
		min-height: var(--min-tap);
		padding: 0.625rem 1rem 0.625rem 2.75rem;
		font-size: 1rem;
		border: 1px solid var(--color-border);
		border-radius: 9999px;
		background: var(--color-card-bg);
		color: var(--color-text);
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
		transition: border-color 0.15s ease, box-shadow 0.15s ease;
	}
	@media (prefers-color-scheme: dark) {
		.rate-page__search input {
			box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
		}
	}
	.rate-page__search input:focus {
		outline: none;
		border-color: var(--color-focus);
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08), 0 0 0 3px var(--color-accent-bg);
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

	/* ── Spinner ── */
	.rate-page__spinner-wrap {
		display: flex;
		justify-content: center;
		align-items: center;
		padding: 3rem 1rem;
	}
	.rate-page__spinner-wrap--bottom {
		padding: 1.5rem 1rem;
	}
	.rate-page__spinner {
		display: inline-block;
		width: 2rem;
		height: 2rem;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* ── Error banner ── */
	.rate-page__error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: var(--radius-sm);
		font-size: 0.875rem;
		color: #991b1b;
	}
	@media (prefers-color-scheme: dark) {
		.rate-page__error {
			background: #2d1515;
			border-color: #7f1d1d;
			color: #fca5a5;
		}
	}
	.rate-page__error-dismiss {
		flex-shrink: 0;
		background: none;
		border: none;
		cursor: pointer;
		font-size: 1rem;
		color: inherit;
		opacity: 0.7;
		line-height: 1;
		padding: 0.125rem;
	}
	.rate-page__error-dismiss:hover {
		opacity: 1;
	}

	/* ── Sentinel ── */
	.rate-page__sentinel {
		height: 1px;
	}

	/* ── Bottom bar (floating, no bg) ── */
	.rate-page__bottom-bar {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 100;
		padding: 0.75rem 1rem;
		padding-bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
		background: transparent;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
		justify-content: space-between;
		pointer-events: none;
	}
	.rate-page__bottom-bar > * {
		pointer-events: auto;
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
</style>
