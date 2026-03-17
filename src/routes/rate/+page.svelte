<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import BookCard from '$lib/components/BookCard.svelte';
	import { getSupabase } from '$lib/supabase';
	import { authStore } from '$lib/stores/auth';
	import BookCardSkeleton from '$lib/components/BookCardSkeleton.svelte';
	import RatingsBar from '$lib/components/RatingsBar.svelte';
	import SearchBar from '$lib/components/SearchBar.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import SectionTitle from '$lib/components/SectionTitle.svelte';
	import Button from '$lib/components/Button.svelte';
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
			doSearch(q, 0);
		} else {
			searchResults = [];
			searchNextOffset = 0;
			searchHasMore = false;
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
	let searchNextOffset = $state(0);
	let searchHasMore = $state(false);
	let loadingSearch = $state(false);
	let loadingSearchMore = $state(false);
	let searchError = $state<string | null>(null);

	// ── Sentinel for IntersectionObserver (lazy load popular) ───────────────────
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

	// ── Sentinel for search results lazy load ───────────────────────────────────
	let searchSentinelEl = $state<HTMLDivElement | undefined>(undefined);

	$effect(() => {
		if (!searchSentinelEl || !isSearching) return;
		const next = searchNextOffset;
		const more = searchHasMore;
		const loadingMore = loadingSearchMore;
		const q = debouncedQuery.trim();

		const observer = new IntersectionObserver(
			(entries) => {
				if (
					entries[0].isIntersecting &&
					!loadingSearch &&
					!loadingMore &&
					more
				) {
					doSearch(q, next);
				}
			},
			{ rootMargin: '300px' }
		);

		observer.observe(searchSentinelEl);
		return () => observer.disconnect();
	});

	// ── Book lookup (rated details from DB, then popular + search + dummy) ─────
	function findBookById(id: string): Book | undefined {
		return (
			ratingsStore.getRatedBook(id) ??
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

	async function doSearch(query: string, offset = 0) {
		if (offset === 0) {
			loadingSearch = true;
		} else {
			loadingSearchMore = true;
		}
		searchError = null;

		try {
			const res = await fetch(
				`/api/books/search?q=${encodeURIComponent(query)}&offset=${offset}`
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data: { books: Book[]; nextOffset: number; hasMore: boolean } = await res.json();

			if (offset === 0) {
				searchResults = data.books;
			} else {
				searchResults = [...searchResults, ...data.books];
			}
			searchNextOffset = data.nextOffset;
			searchHasMore = data.hasMore;
		} catch {
			searchError = 'Search failed. Please try again.';
			if (offset === 0) searchResults = [];
		} finally {
			if (offset === 0) {
				loadingSearch = false;
			} else {
				loadingSearchMore = false;
			}
		}
	}

	async function handleSubmit() {
		if (!canGetRecommendations) return;
		const user = get(authStore).user;
		if (!user?.id) {
			goto('/rate/recommendations');
			return;
		}
		const supabase = getSupabase();
		if (supabase) {
			try {
				const { data, error } = await supabase
					.from('recommendation_requests')
					.insert({ user_id: user.id })
					.select('id')
					.single();
				if (!error && data?.id != null) {
					goto(`/rate/recommendations?request_id=${encodeURIComponent(String(data.id))}`);
					return;
				}
			} catch {
				// fall through to simple navigation
			}
		}
		goto('/rate/recommendations');
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
		<SearchBar bind:value={searchQuery} />
	</header>

	<div class="rate-page__content">
		{#if isSearching}
			<SectionTitle>Search results</SectionTitle>

			{#if searchError}
				<ErrorBanner message={searchError} onDismiss={() => (searchError = null)} />
			{/if}

			{#if loadingSearch}
				<ul class="rate-page__list book-card-grid" aria-label="Searching…" aria-live="polite">
					{#each Array(6) as _}
						<li><BookCardSkeleton /></li>
					{/each}
				</ul>
			{:else if searchResults.length === 0 && !searchError}
				<p class="rate-page__empty">No books found for that search.</p>
			{:else}
				<ul class="rate-page__list book-card-grid">
					{#each searchResults as book (book.id)}
						<li><BookCard {book} /></li>
					{/each}
				</ul>

				{#if loadingSearchMore}
					<div class="rate-page__spinner-wrap rate-page__spinner-wrap--bottom" aria-live="polite">
						<Spinner />
					</div>
				{/if}

				{#if searchHasMore}
					<div bind:this={searchSentinelEl} class="rate-page__sentinel" aria-hidden="true"></div>
				{/if}
			{/if}

		{:else}
			{#if popularError}
				<ErrorBanner message={popularError} onDismiss={() => (popularError = null)} />
			{/if}

			{#if loadingInitial}
				<ul class="rate-page__list book-card-grid" aria-label="Loading books…" aria-live="polite">
					{#each Array(8) as _}
						<li><BookCardSkeleton /></li>
					{/each}
				</ul>
			{:else}
				<ul class="rate-page__list book-card-grid">
					{#each popularBooks as book (book.id)}
						<li><BookCard {book} /></li>
					{/each}
				</ul>

				{#if loadingMore}
					<div class="rate-page__spinner-wrap rate-page__spinner-wrap--bottom" aria-live="polite">
						<Spinner />
					</div>
				{/if}

				{#if hasMore}
					<div bind:this={sentinelEl} class="rate-page__sentinel" aria-hidden="true"></div>
				{/if}
			{/if}
		{/if}
	</div>

	{#if showBottomBar}
		<div class="rate-page__bottom-bar">
			<RatingsBar {ratedEntries} />
			{#if canGetRecommendations}
				<Button pill onclick={handleSubmit}>
					Get Book Recommendations
				</Button>
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
		padding-top: var(--space-4);
		padding-bottom: var(--space-4);
		margin-bottom: var(--space-2);
		transition: transform 0.25s ease;
	}
	.rate-page__sticky-header--hidden {
		transform: translateY(-100%);
	}
	.rate-page__content {
		/* Content flow */
	}
	.rate-page__empty {
		color: var(--color-text-muted);
		margin: var(--space-4) 0;
	}

	.rate-page__spinner-wrap {
		display: flex;
		justify-content: center;
		align-items: center;
		padding: var(--space-12) var(--space-4);
	}
	.rate-page__spinner-wrap--bottom {
		padding: var(--space-6) var(--space-4);
	}

	.rate-page__sentinel {
		height: 1px;
	}

	.rate-page__bottom-bar {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 100;
		padding: var(--space-3) var(--space-4);
		padding-bottom: calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
		background: transparent;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
		justify-content: space-between;
		pointer-events: none;
	}
	:global(.rate-page__bottom-bar > *) {
		pointer-events: auto;
	}
</style>
