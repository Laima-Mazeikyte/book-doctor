<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { get } from 'svelte/store';
	import { afterNavigate, goto } from '$app/navigation';
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
	import { mobileMenuOpen } from '$lib/stores/mobileMenu';
	import { ratingsStore } from '$lib/stores/ratings';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { t } from '$lib/copy';
	import type { Book, RatingValue } from '$lib/types/book';

	const SCROLL_THRESHOLD = 60;
	const FEED_POLL_MS = 3000;
	const FEED_TIMEOUT_MS = 60000;
	const FEED_PAGE_SIZE = 20;
	const EMPTY_PAGE_CHAIN_MAX = 25;
	/** After a new feed batch mounts, ignore strict “end of list” briefly so a sentinel already at the viewport bottom does not clear `hasMore` before the user can interact. */
	const STRICT_FEED_END_GRACE_MS = 750;

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

	let savedScrollY = $state(0);
	let wasSearching = $state(false);
	let previousIsSearching = false;

	/**
	 * When `isSearching` flips true, `window.scrollY` is often already ~0 because the browser
	 * scrolled the focused search field into view. Capture the feed position on the earliest
	 * interaction with the search UI (before that), and merge on enter with `Math.max`.
	 */
	function captureFeedScrollForSearchReturn() {
		if (debouncedQuery.trim().length >= 3) return;
		/** `focusin` may run after the browser has already reduced `scrollY`; never clobber a better save. */
		savedScrollY = Math.max(savedScrollY, window.scrollY);
	}

	function handleSearchAuthor(author: string) {
		savedScrollY = Math.max(savedScrollY, window.scrollY);
		searchQuery = author;
	}

	afterNavigate(({ to }) => {
		if (to?.url.pathname !== '/rate') return;
		const q = to.url.searchParams.get('q')?.trim();
		if (q) searchQuery = q;
	});

	$effect(() => {
		const now = isSearching;
		const entering = now && !previousIsSearching;
		const leaving = !now && previousIsSearching;

		if (entering) {
			savedScrollY = Math.max(savedScrollY, window.scrollY);
			window.scrollTo(0, 0);
			wasSearching = true;
		} else if (leaving && wasSearching) {
			const y = savedScrollY;
			wasSearching = false;
			/** Feed stays mounted (`display:none` while searching); one frame after show is enough to restore. */
			void tick().then(() => {
				requestAnimationFrame(() => {
					if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
						document.activeElement.blur();
					}
					window.scrollTo({ top: y, left: 0, behavior: 'auto' });
				});
			});
		}

		previousIsSearching = now;
	});

	let lastScrollY = $state(0);
	let headerVisible = $state(true);

	// ── Main list ───────────────────────────────────────────────────────────────
	let popularBooks = $state<Book[]>([]);
	let nextOffset = $state(0);
	let hasMore = $state(true);
	let popularSeed = $state<string | null>(null);
	let popularContinuationOffset = $state(0);
	let loadingInitial = $state(true);
	let loadingMore = $state(false);
	let popularError = $state<string | null>(null);

	/** Shown book ids this page visit (main list only); avoids repeats from API. */
	const sessionShownIds = new Set<string>();

	let startedFromLatestFeed = $state(false);
	let everHadSessionSignal = $state(false);
	let lastAppendWasFeed = $state(false);
	let engagedWithPendingBatch = $state(false);
	let pendingBatchIds = $state<string[]>([]);
	let pendingBatchNumericIds = $state<number[]>([]);
	let suppressStrictFeedEndUntil = $state(0);

	let mainListPrefetchPx = $state(600);

	const paginationFeedOnly = $derived(startedFromLatestFeed || everHadSessionSignal);

	function armFeedBatchStrictGrace() {
		suppressStrictFeedEndUntil = Date.now() + STRICT_FEED_END_GRACE_MS;
	}

	/**
	 * After “end of list” (`hasMore` false) — Top 100, latest curated hydrate, or strict feed end —
	 * re-open the sentinel when the user engages so `loadCuratedFeedBatch` can run (popular path
	 * switches to feed once `everHadSessionSignal` is set).
	 */
	function reviveMainListPaginationAfterEngagement() {
		if (hasMore) return;
		if (!(startedFromLatestFeed || everHadSessionSignal)) return;
		hasMore = true;
		armFeedBatchStrictGrace();
	}

	/** Search unlocks feed pagination and revives a ended main list (Top 100, curated, or strict end). */
	$effect(() => {
		const q = searchQuery.trim();
		const searching = isSearching;
		if (q.length === 0 && !searching) return;
		everHadSessionSignal = true;
		if (lastAppendWasFeed) engagedWithPendingBatch = true;
		reviveMainListPaginationAfterEngagement();
	});

	let searchResults = $state<Book[]>([]);
	let searchNextOffset = $state(0);
	let searchHasMore = $state(false);
	let loadingSearch = $state(false);
	let loadingSearchMore = $state(false);
	let searchError = $state<string | null>(null);

	let sentinelEl = $state<HTMLDivElement | undefined>(undefined);
	let searchSentinelEl = $state<HTMLDivElement | undefined>(undefined);

	/**
	 * Two observers: a large bottom rootMargin prefetches the next page while the user is still
	 * ~3 viewports away, but that same margin makes the sentinel "intersect" while it is still far
	 * below the fold — which incorrectly fired `!engaged` and cleared `hasMore` before the user
	 * could rate. Preload observer only fetches when engagement rules pass; a strict (0px) observer
	 * alone ends the list when the user actually reaches the viewport bottom without engaging.
	 */
	$effect(() => {
		if (!sentinelEl) return;
		void suppressStrictFeedEndUntil;
		const prefetch = mainListPrefetchPx;
		const next = nextOffset;
		const more = hasMore;
		const loading = loadingMore;
		const initial = loadingInitial;
		const searching = isSearching;
		const feedOnly = paginationFeedOnly;
		const lastFeed = lastAppendWasFeed;
		const engaged = engagedWithPendingBatch;

		const preloadObserver = new IntersectionObserver(
			(entries) => {
				if (!entries[0].isIntersecting || loading || initial || searching || !more) return;
				if (!feedOnly) {
					void loadPopular(next, 0);
					return;
				}
				if (lastFeed && !engaged) return;
				void loadCuratedFeedBatch();
			},
			{ rootMargin: `0px 0px ${prefetch}px 0px` }
		);

		const strictEndObserver = new IntersectionObserver(
			(entries) => {
				if (!entries[0].isIntersecting || loading || initial || searching || !more) return;
				if (Date.now() < suppressStrictFeedEndUntil) return;
				if (feedOnly && lastFeed && !engaged) {
					hasMore = false;
				}
			},
			{ rootMargin: '0px' }
		);

		preloadObserver.observe(sentinelEl);
		strictEndObserver.observe(sentinelEl);
		return () => {
			preloadObserver.disconnect();
			strictEndObserver.disconnect();
		};
	});

	$effect(() => {
		if (!searchSentinelEl || !isSearching) return;
		const next = searchNextOffset;
		const more = searchHasMore;
		const loadingMoreSearch = loadingSearchMore;
		const q = debouncedQuery.trim();

		const observer = new IntersectionObserver(
			(entries) => {
				if (
					entries[0].isIntersecting &&
					!loadingSearch &&
					!loadingMoreSearch &&
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

	function findBookById(id: string): Book | undefined {
		return (
			ratingsStore.getRatedBook(id) ??
			popularBooks.find((b) => b.id === id) ??
			searchResults.find((b) => b.id === id) ??
			getBookById(id)
		);
	}

	const ratedEntries = $derived(
		Array.from($ratingsStore.entries())
			.map(([bookId, rating]) => {
				const book = findBookById(bookId);
				return book ? { book, rating } : null;
			})
			.filter((e): e is { book: Book; rating: RatingValue } => e !== null)
	);

	const MIN_RATINGS_FOR_RECOMMENDATIONS = 10;

	const ratedCount = $derived($ratingsStore.size);
	const showBottomBar = $derived(ratedCount >= 1);
	const canGetRecommendations = $derived(ratedCount >= MIN_RATINGS_FOR_RECOMMENDATIONS);
	const ratingsRemainingForRecommendations = $derived(
		Math.max(0, MIN_RATINGS_FOR_RECOMMENDATIONS - ratedCount)
	);
	const recommendationsCtaLabel = $derived(
		ratingsRemainingForRecommendations === 0
			? t('rate.getRecommendations')
			: ratingsRemainingForRecommendations === 1
				? t('rate.remainingToRecommend_one')
				: t('rate.remainingToRecommend_other', { remaining: ratingsRemainingForRecommendations })
	);

	function mergeMainListBooks(incoming: Book[], mode: 'replace' | 'append'): Book[] {
		const ratings = get(ratingsStore);
		const ni = get(notInterestedStore);
		const seenIncoming = new Set<string>();
		const out: Book[] = [];
		for (const b of incoming) {
			if (seenIncoming.has(b.id)) continue;
			seenIncoming.add(b.id);
			if (sessionShownIds.has(b.id)) continue;
			if (ratings.has(b.id)) continue;
			if (b.book_id != null && ni.has(b.book_id)) continue;
			out.push(b);
		}
		if (mode === 'replace') {
			sessionShownIds.clear();
		}
		for (const b of out) {
			sessionShownIds.add(b.id);
		}
		if (mode === 'replace') {
			popularBooks = out;
		} else {
			popularBooks = [...popularBooks, ...out];
		}
		return out;
	}

	function setPendingFromAppended(appended: Book[]) {
		pendingBatchIds = appended.map((b) => b.id);
		pendingBatchNumericIds = appended
			.map((b) => b.book_id)
			.filter((n): n is number => n != null && Number.isInteger(n));
		engagedWithPendingBatch = false;
		armFeedBatchStrictGrace();
	}

	function handleMainListAfterRate(_book: Book) {
		everHadSessionSignal = true;
		if (lastAppendWasFeed) engagedWithPendingBatch = true;
		reviveMainListPaginationAfterEngagement();
	}

	function handleRateBookmark(book: Book, id: string) {
		const wasBookmarked = planToReadStore.has(book.id);
		planToReadStore.toggle(id, book.book_id);
		if (!wasBookmarked && book.book_id != null) {
			notInterestedStore.remove(book.book_id);
		}
	}

	function handleMainListNotInterested(book: Book) {
		const bid = book.book_id ?? 0;
		const now = notInterestedStore.toggle(bid);
		if (now) {
			if (planToReadStore.has(book.id)) {
				planToReadStore.toggle(book.id, book.book_id);
			}
			if (get(ratingsStore).has(book.id)) {
				ratingsStore.removeRating(book.id, book.book_id);
			}
			everHadSessionSignal = true;
			if (lastAppendWasFeed) engagedWithPendingBatch = true;
			reviveMainListPaginationAfterEngagement();
		}
	}

	function handleSearchAfterRate() {
		everHadSessionSignal = true;
		if (lastAppendWasFeed) engagedWithPendingBatch = true;
		reviveMainListPaginationAfterEngagement();
	}

	function handleSearchNotInterested(book: Book) {
		const bid = book.book_id ?? 0;
		const now = notInterestedStore.toggle(bid);
		if (now) {
			if (planToReadStore.has(book.id)) {
				planToReadStore.toggle(book.id, book.book_id);
			}
			if (get(ratingsStore).has(book.id)) {
				ratingsStore.removeRating(book.id, book.book_id);
			}
			everHadSessionSignal = true;
			if (lastAppendWasFeed) engagedWithPendingBatch = true;
			reviveMainListPaginationAfterEngagement();
		}
	}

	async function loadInitialMainList() {
		loadingInitial = true;
		popularError = null;
		sessionShownIds.clear();
		try {
			const token = get(authStore).session?.access_token ?? null;
			if (token) {
				const res = await fetch('/api/feed/latest', {
					headers: { Authorization: `Bearer ${token}` }
				});
				if (res.ok) {
					const data: {
						status: string;
						books: Book[];
					} = await res.json();
					if (data.status === 'completed' && data.books?.length > 0) {
						startedFromLatestFeed = true;
						const appended = mergeMainListBooks(data.books, 'replace');
						if (appended.length === 0) {
							startedFromLatestFeed = false;
							await loadPopular(0, 0);
							return;
						}
						lastAppendWasFeed = true;
						setPendingFromAppended(appended);
						hasMore = true;
						return;
					}
				}
			}
			startedFromLatestFeed = false;
			await loadPopular(0, 0);
		} catch {
			startedFromLatestFeed = false;
			await loadPopular(0, 0);
		} finally {
			loadingInitial = false;
		}
	}

	async function loadPopular(offset: number, depth: number) {
		if (depth > EMPTY_PAGE_CHAIN_MAX) {
			hasMore = false;
			return;
		}
		if (offset === 0) {
			loadingInitial = true;
		} else {
			loadingMore = true;
		}
		popularError = null;

		try {
			const params = new URLSearchParams({ offset: String(offset) });
			if (popularSeed) params.set('seed', popularSeed);
			if (offset >= 100 && popularBooks.length > 0) {
				const exclude = popularBooks
					.map((b) => b.book_id)
					.filter((id): id is number => id != null && Number.isInteger(id))
					.join(',');
				if (exclude) params.set('exclude', exclude);
			}
			const headers: Record<string, string> = {};
			const accessToken = get(authStore).session?.access_token ?? null;
			if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
			const res = await fetch(`/api/books/popular?${params.toString()}`, { headers });
			if (!res.ok) {
				if (offset > 0) hasMore = false;
				throw new Error(`HTTP ${res.status}`);
			}
			const data: { books: Book[]; nextOffset: number; hasMore: boolean; seed?: string } = await res.json();

			const mode = offset === 0 ? 'replace' : 'append';
			const appended = mergeMainListBooks(data.books, mode);
			if (offset === 0 && data.seed) popularSeed = data.seed;

			nextOffset = data.nextOffset;
			popularContinuationOffset = data.nextOffset;
			lastAppendWasFeed = false;
			pendingBatchIds = [];
			pendingBatchNumericIds = [];
			engagedWithPendingBatch = false;

			hasMore = data.hasMore ?? data.books.length > 0;

			if (appended.length === 0 && hasMore) {
				await loadPopular(data.nextOffset, depth + 1);
				return;
			}
		} catch {
			popularError = t('rate.errors.loadBooks');
			if (offset > 0) hasMore = false;
		} finally {
			if (offset === 0) {
				loadingInitial = false;
			} else {
				loadingMore = false;
			}
		}
	}

	async function loadCuratedFeedBatch() {
		if (loadingMore || loadingInitial) return;
		loadingMore = true;
		popularError = null;
		try {
			const supabase = getSupabase();
			const token = get(authStore).session?.access_token ?? null;
			const user = get(authStore).user;
			if (!supabase || !token || !user?.id) {
				loadingMore = false;
				await loadPopular(popularContinuationOffset, 0);
				return;
			}

			const { data, error: insertError } = await supabase
				.from('feed_requests')
				.insert({ user_id: user.id })
				.select('id')
				.single();

			if (insertError || data?.id == null) {
				console.error('[rate] feed_requests insert:', insertError);
				loadingMore = false;
				await loadPopular(popularContinuationOffset, 0);
				return;
			}

			const requestId = String(data.id);
			const started = Date.now();

			while (Date.now() - started < FEED_TIMEOUT_MS) {
				const res = await fetch(`/api/feed?request_id=${encodeURIComponent(requestId)}`, {
					headers: { Authorization: `Bearer ${token}` }
				});

				if (!res.ok) {
					loadingMore = false;
					await loadPopular(popularContinuationOffset, 0);
					return;
				}

				const payload: {
					status: string;
					books: Book[];
					request_id: string;
					error_message?: string | null;
				} = await res.json();

				if (payload.status === 'failed' || payload.status === 'skipped') {
					loadingMore = false;
					await loadPopular(popularContinuationOffset, 0);
					return;
				}

				if (payload.status === 'completed') {
					const appended = mergeMainListBooks(payload.books, 'append');
					if (appended.length === 0) {
						hasMore = false;
					} else {
						hasMore = appended.length >= FEED_PAGE_SIZE;
						lastAppendWasFeed = true;
						setPendingFromAppended(appended);
					}
					return;
				}

				await new Promise((r) => setTimeout(r, FEED_POLL_MS));
			}

			loadingMore = false;
			await loadPopular(popularContinuationOffset, 0);
		} catch (e) {
			console.error('[rate] loadCuratedFeedBatch:', e);
			popularError = t('rate.errors.loadBooks');
			loadingMore = false;
			await loadPopular(popularContinuationOffset, 0);
		} finally {
			loadingMore = false;
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
				const seen = new Set<string>();
				searchResults = data.books.filter((b) => {
					if (seen.has(b.id)) return false;
					seen.add(b.id);
					return true;
				});
			} else {
				const existingIds = new Set(searchResults.map((b) => b.id));
				const newBooks = data.books.filter((b) => !existingIds.has(b.id));
				searchResults = [...searchResults, ...newBooks];
			}
			searchNextOffset = data.nextOffset;
			searchHasMore = data.hasMore;
		} catch {
			searchError = t('rate.errors.searchFailed');
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
				// fall through
			}
		}
		goto('/rate/recommendations');
	}

	onMount(() => {
		const syncPrefetch = () => {
			mainListPrefetchPx = 3 * window.innerHeight;
		};
		syncPrefetch();
		window.addEventListener('resize', syncPrefetch);
		window.visualViewport?.addEventListener('resize', syncPrefetch);

		void loadInitialMainList();

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
		return () => {
			window.removeEventListener('scroll', handleScroll);
			window.removeEventListener('resize', syncPrefetch);
			window.visualViewport?.removeEventListener('resize', syncPrefetch);
		};
	});
</script>

<div class="rate-page" class:rate-page--mobile-menu-open={$mobileMenuOpen}>
	<header
		class="rate-page__sticky-header"
		class:rate-page__sticky-header--hidden={!headerVisible}
	>
		<div class="rate-page__toolbar">
			<div
				class="rate-page__search"
				onpointerdowncapture={captureFeedScrollForSearchReturn}
				onfocusincapture={captureFeedScrollForSearchReturn}
			>
				<SearchBar bind:value={searchQuery} placeholder={t('rate.search.placeholder')} aria-label={t('rate.search.ariaLabel')} />
			</div>
		</div>
	</header>

	<div class="rate-page__content">
		<!-- Feed stays in the DOM while searching (`display: none`) so layout/scroll height is preserved. -->
		<div
			class="rate-page__panel"
			class:rate-page__panel--hidden={isSearching}
			aria-hidden={isSearching}
		>
			{#if popularError}
				<ErrorBanner message={popularError} onDismiss={() => (popularError = null)} />
			{/if}

			{#if loadingInitial}
				<ul class="rate-page__list book-card-grid" aria-label={t('rate.aria.loadingBooks')} aria-live="polite">
					{#each Array(8) as _}
						<li><BookCardSkeleton /></li>
					{/each}
				</ul>
			{:else}
				<ul class="rate-page__list book-card-grid">
					{#each popularBooks as book (book.id)}
						<li>
							<BookCard
								context="rate"
								{book}
								onSearchAuthor={handleSearchAuthor}
								bookmarked={$planToReadStore.has(book.id)}
								onBookmark={(id) => handleRateBookmark(book, id)}
								notInterested={$notInterestedStore.has(book.book_id ?? 0)}
								onNotInterested={() => handleMainListNotInterested(book)}
								onAfterRate={() => handleMainListAfterRate(book)}
							/>
						</li>
					{/each}
				</ul>

				{#if loadingMore}
					<div class="rate-page__spinner-wrap rate-page__spinner-wrap--bottom" aria-live="polite">
						<Spinner />
					</div>
				{/if}

				{#if hasMore}
					<div bind:this={sentinelEl} class="rate-page__sentinel" aria-hidden="true"></div>
				{:else if popularBooks.length > 0}
					<p class="rate-page__end-cta">{t('rate.endOfList')}</p>
				{/if}
			{/if}
		</div>

		<div
			class="rate-page__panel"
			class:rate-page__panel--hidden={!isSearching}
			aria-hidden={!isSearching}
		>
			{#if isSearching}
				<SectionTitle>{t('rate.sectionTitle')}</SectionTitle>

				{#if searchError}
					<ErrorBanner message={searchError} onDismiss={() => (searchError = null)} />
				{/if}

				{#if loadingSearch}
					<ul class="rate-page__list book-card-grid" aria-label={t('rate.aria.searching')} aria-live="polite">
						{#each Array(6) as _}
							<li><BookCardSkeleton /></li>
						{/each}
					</ul>
				{:else if searchResults.length === 0 && !searchError}
					<p class="rate-page__empty">{t('rate.emptySearch')}</p>
				{:else}
					<ul class="rate-page__list book-card-grid">
						{#each searchResults as book (book.id)}
							<li>
								<BookCard
									context="rate"
									{book}
									onSearchAuthor={handleSearchAuthor}
									bookmarked={$planToReadStore.has(book.id)}
									onBookmark={(id) => handleRateBookmark(book, id)}
									notInterested={$notInterestedStore.has(book.book_id ?? 0)}
									onNotInterested={() => handleSearchNotInterested(book)}
									onAfterRate={() => handleSearchAfterRate()}
								/>
							</li>
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
			{/if}
		</div>
	</div>

	{#if showBottomBar}
		<div class="rate-page__bottom-bar">
			<RatingsBar {ratedEntries} />
			{#if canGetRecommendations}
				<Button variant="primary" pill onclick={handleSubmit}>
					{recommendationsCtaLabel}
				</Button>
			{:else}
				<p class="rate-page__recommendations-hint" role="status" aria-live="polite">
					{recommendationsCtaLabel}
				</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.rate-page {
		padding-bottom: 0;
	}
	.rate-page--mobile-menu-open .rate-page__bottom-bar {
		display: none;
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
		pointer-events: none;
	}
	.rate-page__toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		min-height: var(--min-tap);
	}
	.rate-page__search {
		flex: 1 1 auto;
		min-width: 0;
		max-width: min(48rem, 100%);
	}
	@media (max-width: 767px) {
		.rate-page__search {
			max-width: none;
		}
	}
	.rate-page__empty,
	.rate-page__end-cta {
		color: var(--color-text-muted);
		margin: var(--space-4) 0;
	}

	.rate-page__panel--hidden {
		display: none;
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
	@media (min-width: 768px) {
		.rate-page__bottom-bar {
			justify-content: flex-start;
		}
		:global(.rate-page__bottom-bar > :last-child) {
			position: absolute;
			left: 50%;
			top: 50%;
			transform: translate(-50%, -50%);
		}
	}
	:global(.rate-page__bottom-bar > *) {
		pointer-events: auto;
	}

	.rate-page__recommendations-hint {
		margin: 0;
		max-width: 11rem;
		text-align: center;
		padding: var(--space-2) var(--space-3);
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--typ-caption-font-weight);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
		color: var(--color-text);
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xs);
		box-shadow: var(--shadow-card);
	}
</style>
