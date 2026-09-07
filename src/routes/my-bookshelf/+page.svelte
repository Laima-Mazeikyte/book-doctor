<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { get } from 'svelte/store';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { authStore, authReady } from '$lib/stores/auth';
	import { ratingsStore } from '$lib/stores/ratings';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import { bookmarksPageStore } from '$lib/stores/bookmarksPage';
	import { ratedSummarySheetKeepAlive } from '$lib/stores/ratedSummarySheetKeepAlive';
	import { isUserLibraryDetailsReady, userLibraryHydrationStore } from '$lib/stores/userLibrary';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookCardGridSkeleton from '$lib/components/BookCardGridSkeleton.svelte';
	import NotInterestedPagination from '$lib/components/NotInterestedPagination.svelte';
	import {
		coverPriorityFor,
		estimateGridColumns,
		trackGridColumns
	} from '$lib/components/book-card/coverPriority';
	import NavStyleTabList from '$lib/components/NavStyleTabList.svelte';
	import { ChevronDown } from 'lucide-svelte';
	import { t } from '$lib/copy';
	import { notInterestedPageLoader, notInterestedPageStore } from '$lib/notInterested/pageLoader';
	import type { NotInterestedOrder } from '$lib/notInterested/types';
	import type { Book, RatingValue } from '$lib/types/book';

	/** Rendered column count for the bookshelf grid — drives cover eager/lazy priority. */
	let gridColumns = $state(estimateGridColumns());

	const FILTER_IDS = ['rated', 'bookmarked', 'not-interested'] as const;
	type FilterId = (typeof FILTER_IDS)[number];

	const LS_FILTER_KEY = 'book-doctor:my-bookshelf-filter';
	const LS_SORT_KEY = 'book-doctor:my-bookshelf-sort';
	const LS_NI_SORT_KEY = 'book-doctor:my-bookshelf-not-interested-sort';

	const SHELF_SORT_IDS = ['newest', 'oldest', 'rating-high', 'rating-low'] as const;
	type ShelfSortId = (typeof SHELF_SORT_IDS)[number];
	const NOT_INTERESTED_SORT_IDS = ['newest', 'oldest'] as const;
	type NotInterestedSortId = (typeof NOT_INTERESTED_SORT_IDS)[number];

	function isValidShelfSortId(s: string | null | undefined): s is ShelfSortId {
		return s != null && (SHELF_SORT_IDS as readonly string[]).includes(s);
	}

	function isValidNotInterestedSortId(s: string | null | undefined): s is NotInterestedSortId {
		return s != null && (NOT_INTERESTED_SORT_IDS as readonly string[]).includes(s);
	}

	function isValidFilter(s: string | null | undefined): s is FilterId {
		return s != null && (FILTER_IDS as readonly string[]).includes(s);
	}

	/** Not interested is exclusive; rated and bookmarked can overlap. */
	function isNotInterested(book: Book, notInterestedIds: Set<string>): boolean {
		return notInterestedIds.has(book.book_id);
	}

	function readSortFromLs(): ShelfSortId {
		if (!browser) return 'newest';
		try {
			const s = localStorage.getItem(LS_SORT_KEY);
			if (isValidShelfSortId(s)) return s;
		} catch {
			// ignore
		}
		return 'newest';
	}

	function readNotInterestedSortFromLs(): NotInterestedSortId {
		if (!browser) return 'newest';
		try {
			const s = localStorage.getItem(LS_NI_SORT_KEY);
			if (isValidNotInterestedSortId(s)) return s;
		} catch {
			// ignore
		}
		return 'newest';
	}

	/** Recency order is list order; rating sorts use `ratings` (0 = unrated). Ties keep recency order. */
	function sortBooksByShelfOrder(
		books: Book[],
		order: ShelfSortId,
		ratings: Map<string, RatingValue>
	): Book[] {
		const arr = [...books];
		if (order === 'newest') return arr;
		if (order === 'oldest') return arr.reverse();

		const baseIdx = new Map(books.map((book, i) => [book.id, i]));
		const ratingOf = (id: string) => ratings.get(id) ?? 0;

		if (order === 'rating-high') {
			arr.sort((a, b) => {
				const diff = ratingOf(b.id) - ratingOf(a.id);
				if (diff !== 0) return diff;
				return (baseIdx.get(a.id) ?? 0) - (baseIdx.get(b.id) ?? 0);
			});
			return arr;
		}
		arr.sort((a, b) => {
			const diff = ratingOf(a.id) - ratingOf(b.id);
			if (diff !== 0) return diff;
			return (baseIdx.get(a.id) ?? 0) - (baseIdx.get(b.id) ?? 0);
		});
		return arr;
	}

	let bookmarkBooks = $state<Book[]>([]);
	let bookmarkLoading = $state(false);
	/** The first bookmark fetch for a user may block only the Bookmarked tab. */
	let bookmarkBlockingCompletedUserId = $state<string | null>(null);
	let bookmarkLoadRequestId = 0;

	let activeFilter = $state<FilterId>('rated');
	let sortOrder = $state<ShelfSortId>(readSortFromLs());
	let notInterestedSortOrder = $state<NotInterestedSortId>(readNotInterestedSortFromLs());
	const shelfScrollPositions = new SvelteMap<string, number>();

	// Canonical reactive rated-book list (rating values joined with book details). Reading this —
	// instead of hand-joining $ratingsStore + getRatedBook — is what keeps the list rebuilding as
	// details hydrate; it can't silently render empty like the old two-map pattern.
	const ratedBooksStore = ratingsStore.ratedBooks;

	const ratedDisplayEntries = $derived.by(() => {
		type RatedEntry = { book: Book; ratingAtLoad: RatingValue };
		const baseEntries: RatedEntry[] = $ratedBooksStore.map(({ book, rating }) => ({
			book,
			ratingAtLoad: rating
		}));

		let entries: RatedEntry[];
		if (sortOrder === 'newest') {
			entries = baseEntries;
		} else {
			const ratings = $ratingsStore;
			const baseIdx = new Map(baseEntries.map((e, i) => [e.book.id, i]));
			const score = (e: RatedEntry) => ratings.get(e.book.id) ?? e.ratingAtLoad;

			if (sortOrder === 'oldest') {
				entries = [...baseEntries].reverse();
			} else {
				const sorted = [...baseEntries];
				if (sortOrder === 'rating-high') {
					sorted.sort((a, b) => {
						const diff = score(b) - score(a);
						if (diff !== 0) return diff;
						return (baseIdx.get(a.book.id) ?? 0) - (baseIdx.get(b.book.id) ?? 0);
					});
					entries = sorted;
				} else {
					sorted.sort((a, b) => {
						const diff = score(a) - score(b);
						if (diff !== 0) return diff;
						return (baseIdx.get(a.book.id) ?? 0) - (baseIdx.get(b.book.id) ?? 0);
					});
					entries = sorted;
				}
			}
		}

		const keep = $ratedSummarySheetKeepAlive;
		if (keep && !entries.some((e) => e.book.id === keep.bookId)) {
			const placeholder: RatingValue = 1;
			return [...entries, { book: keep.book, ratingAtLoad: placeholder }];
		}
		return entries;
	});

	$effect(() => {
		if (activeFilter !== 'rated') {
			ratedSummarySheetKeepAlive.set(null);
		}
	});

	$effect(() => {
		const session = $authStore.session;
		const token = session?.access_token ?? null;
		const snapshot = bookmarksPageStore.getSnapshot();
		const requestId = ++bookmarkLoadRequestId;

		if (!token) {
			bookmarkLoading = false;
			bookmarkBlockingCompletedUserId = null;
			bookmarkBooks = snapshot.loaded ? snapshot.books : [];
			return;
		}

		const userId = session?.user?.id ?? null;
		const needsBlockingBookmarks = !userId || bookmarkBlockingCompletedUserId !== userId;
		bookmarkLoading = needsBlockingBookmarks;
		if (snapshot.loaded) {
			bookmarkBooks = snapshot.books;
		}

		const bmPromise = fetch('/api/bookmarks', {
			headers: { Authorization: `Bearer ${token}` }
		})
			.then((res) => {
				if (!res.ok) throw new Error('bm');
				return res.json() as Promise<{ books: Book[] }>;
			})
			.then((d) => d.books ?? [])
			.catch(() => (snapshot.loaded ? snapshot.books : []));

		void bmPromise.then((bm) => {
			if (requestId !== bookmarkLoadRequestId) return;
			bookmarkBooks = bm;
			bookmarksPageStore.setBooks(bm);
			bookmarkLoading = false;
			if (userId) bookmarkBlockingCompletedUserId = userId;
		});
	});

	$effect(() => {
		const filter = activeFilter;
		const order: NotInterestedOrder = notInterestedSortOrder;
		const authKey = `${$authStore.user?.id ?? ''}:${$authStore.session?.access_token ?? ''}`;
		if (filter !== 'not-interested') return;
		void authKey;
		void notInterestedPageLoader.ensureLoaded(order);
	});

	/** Sync from URL only when `$page.url` changes — do not subscribe to `activeFilter`, or a tab change can run before `goto` updates the query and this effect would snap `activeFilter` back to the stale param (breaking keyboard focus on other tabs). */
	$effect(() => {
		if (!browser) return;
		const param = $page.url.searchParams.get('filter');
		if (isValidFilter(param)) {
			const current = untrack(() => activeFilter);
			if (current !== param) activeFilter = param;
			try {
				localStorage.setItem(LS_FILTER_KEY, param);
			} catch {
				// ignore
			}
			return;
		}
		let next: FilterId = 'rated';
		try {
			const stored = localStorage.getItem(LS_FILTER_KEY);
			if (isValidFilter(stored)) next = stored;
		} catch {
			// ignore
		}
		const current = untrack(() => activeFilter);
		if (current !== next) activeFilter = next;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- persist active filter in query
		void goto(`${resolve('/my-bookshelf')}?filter=${encodeURIComponent(next)}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	});

	const ratedBooksForPartition = $derived($ratedBooksStore.map((e) => e.book));

	const notInterestedIds = $derived.by(() => new SvelteSet([...$notInterestedStore]));
	const planIds = $derived($planToReadStore);

	// True until we actually know the rated set: auth must be resolved and, for a signed-in/anon
	// user, the rated-book details must have hydrated (the rated list renders purely from details).
	// Distinguishes "still loading" from "confirmed zero" so we don't flash the empty state on load.
	const ratedHydrating = $derived.by(() => {
		if (!$authReady) return true;
		const user = $authStore.user;
		if (!user) return false;
		return !isUserLibraryDetailsReady(user.id, $userLibraryHydrationStore);
	});

	const countsReady = $derived(
		(!$authStore.session?.access_token || !bookmarkLoading) && !ratedHydrating
	);

	// Escape hatch: if hydration hasn't finished within 15s (e.g. a request that never resolves),
	// stop showing the skeleton forever and surface a retry message instead. Resets whenever
	// hydration completes or a new load begins.
	let ratedLoadTimedOut = $state(false);
	$effect(() => {
		if (!ratedHydrating) {
			ratedLoadTimedOut = false;
			return;
		}
		ratedLoadTimedOut = false;
		const id = setTimeout(() => {
			ratedLoadTimedOut = true;
		}, 15_000);
		return () => clearTimeout(id);
	});

	const tabCounts = $derived.by(() => {
		if (!countsReady) return { rated: 0, bookmarked: 0 };
		let rated = 0;
		for (const book of ratedBooksForPartition) {
			if (!isNotInterested(book, notInterestedIds)) rated++;
		}
		return { rated, bookmarked: planIds.size };
	});

	function countForTab(id: string): number {
		return tabCounts[id as 'rated' | 'bookmarked'] ?? 0;
	}

	const tabItems = $derived([
		{ id: 'rated' as FilterId, label: t('rated.tabs.rated') },
		{ id: 'bookmarked' as FilterId, label: t('rated.tabs.bookmarked') },
		{ id: 'not-interested' as FilterId, label: t('rated.tabs.notInterested') }
	]);

	const niPageState = $derived($notInterestedPageStore.entries[notInterestedSortOrder]);

	const sortOptionLabel = $derived.by((): string => {
		if (activeFilter === 'not-interested') {
			return notInterestedSortOrder === 'newest' ? t('rated.sort.newest') : t('rated.sort.oldest');
		}
		switch (sortOrder) {
			case 'newest':
				return t('rated.sort.newest');
			case 'oldest':
				return t('rated.sort.oldest');
			case 'rating-high':
				return t('rated.sort.ratingHigh');
			case 'rating-low':
				return t('rated.sort.ratingLow');
			default: {
				const _x: never = sortOrder;
				return _x;
			}
		}
	});

	const bookmarkTabBooks = $derived(
		bookmarkBooks.filter((b) => !isNotInterested(b, notInterestedIds))
	);

	const niTabBooks = $derived(niPageState.books);

	const sortedBookmarkTabBooks = $derived.by(() =>
		sortBooksByShelfOrder(bookmarkTabBooks, sortOrder, $ratingsStore)
	);

	const listLoading = $derived(
		Boolean($authStore.session?.access_token) && activeFilter === 'bookmarked' && bookmarkLoading
	);
	const notInterestedInitialLoading = $derived(
		activeFilter === 'not-interested' && !niPageState.loaded && !niPageState.error
	);

	// Rated tab: show the loading skeleton (not the empty message) while the library is still
	// hydrating and we have nothing to show yet. Locally-cached ratings render immediately, so this
	// only kicks in when the list is genuinely empty pending the server sync.
	const ratedListLoading = $derived(
		activeFilter === 'rated' && ratedHydrating && ratedDisplayEntries.length === 0
	);

	const currentListBooks = $derived.by((): Book[] => {
		if (activeFilter === 'rated') return ratedDisplayEntries.map((e) => e.book);
		if (activeFilter === 'bookmarked') return sortedBookmarkTabBooks;
		return niTabBooks;
	});

	function shelfScrollKey(filter: FilterId = activeFilter): string {
		if (filter === 'not-interested') return `${filter}:${notInterestedSortOrder}`;
		return `${filter}:${sortOrder}`;
	}

	function rememberShelfScroll(filter: FilterId = activeFilter): void {
		if (!browser) return;
		shelfScrollPositions.set(shelfScrollKey(filter), window.scrollY);
	}

	function restoreShelfScroll(filter: FilterId = activeFilter): void {
		if (!browser) return;
		const top = shelfScrollPositions.get(shelfScrollKey(filter)) ?? 0;
		void tick().then(() => window.scrollTo({ top, behavior: 'auto' }));
	}

	function setSortOrder(next: ShelfSortId) {
		rememberShelfScroll();
		sortOrder = next;
		try {
			localStorage.setItem(LS_SORT_KEY, next);
		} catch {
			// ignore
		}
		restoreShelfScroll();
	}

	function setNotInterestedSortOrder(next: NotInterestedSortId) {
		rememberShelfScroll();
		notInterestedSortOrder = next;
		try {
			localStorage.setItem(LS_NI_SORT_KEY, next);
		} catch {
			// ignore
		}
		restoreShelfScroll('not-interested');
	}

	function cardContextFor(): 'bookmarks' | 'not-interested' {
		return activeFilter === 'not-interested' ? 'not-interested' : 'bookmarks';
	}

	function selectTab(id: FilterId) {
		rememberShelfScroll();
		activeFilter = id;
		try {
			localStorage.setItem(LS_FILTER_KEY, id);
		} catch {
			// ignore
		}
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- persist active filter in query
		void goto(`${resolve('/my-bookshelf')}?filter=${encodeURIComponent(id)}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
		restoreShelfScroll(id);
	}

	function handleBookmark(book: Book, id: string) {
		const wasBookmarked = planToReadStore.has(book.id);
		planToReadStore.toggle(id, book.book_id);
		if (!wasBookmarked) {
			notInterestedStore.remove(book.book_id);
			if (!bookmarkBooks.some((b) => b.id === book.id)) {
				const rest = bookmarkBooks.filter((b) => b.id !== book.id);
				bookmarkBooks = sortOrder === 'oldest' ? [...rest, book] : [book, ...rest];
				bookmarksPageStore.setBooks(bookmarkBooks);
			}
		}
		if (wasBookmarked) {
			bookmarkBooks = bookmarkBooks.filter((b) => b.id !== book.id);
			bookmarksPageStore.removeBook(book.id);
		}
	}

	function handleNotInterested(book: Book) {
		const bid = book.book_id;
		const wasNotInterested = notInterestedStore.has(bid);
		const nowNotInterested = notInterestedStore.toggle(bid);
		if (nowNotInterested && !wasNotInterested) {
			if (planToReadStore.has(book.id)) {
				planToReadStore.toggle(book.id, book.book_id);
				bookmarkBooks = bookmarkBooks.filter((b) => b.id !== book.id);
				bookmarksPageStore.removeBook(book.id);
			}
			if (get(ratingsStore).has(book.id)) {
				ratingsStore.removeRating(book.id, book.book_id);
			}
		}
	}

	function handleRateFromNi(book: Book, id: string, value: RatingValue) {
		ratingsStore.setRating(id, value, book.book_id, book);
	}
</script>

<svelte:head>
	<title>{t('rated.title')} — {t('shared.header.siteName')}</title>
	<meta name="description" content={t('rated.metaDescription')} />
</svelte:head>

<div class="bookshelf-page">
	<h1 class="bookshelf-page__title typ-display2 typ-display2--content">{t('rated.title')}</h1>

	<div class="bookshelf-page__tabs-wrap">
		<NavStyleTabList
			ariaLabel={t('rated.tabs.ariaLabel')}
			panelId="bookshelf-panel"
			idPrefix="bookshelf-tab"
			items={tabItems}
			selectedId={activeFilter}
			{countsReady}
			countedTabIds={['rated', 'bookmarked']}
			getCount={(id) => countForTab(id as FilterId)}
			onSelect={(id) => selectTab(id as FilterId)}
		/>
		<div class="bookshelf-page__tabs-sort-divider" aria-hidden="true"></div>
		<div class="bookshelf-page__sort">
			<span class="bookshelf-page__sort-sizer" aria-hidden="true">{sortOptionLabel}</span>
			<select
				id="bookshelf-sort"
				class="bookshelf-page__sort-select"
				aria-label={t('rated.sort.ariaLabel')}
				value={activeFilter === 'not-interested' ? notInterestedSortOrder : sortOrder}
				onchange={(e) => {
					const v = (e.currentTarget as HTMLSelectElement).value;
					if (activeFilter === 'not-interested') {
						if (isValidNotInterestedSortId(v)) setNotInterestedSortOrder(v);
					} else if (isValidShelfSortId(v)) {
						setSortOrder(v);
					}
				}}
			>
				{#if activeFilter === 'not-interested'}
					<option value="newest">{t('rated.sort.newest')}</option>
					<option value="oldest">{t('rated.sort.oldest')}</option>
				{:else}
					<option value="newest">{t('rated.sort.newest')}</option>
					<option value="oldest">{t('rated.sort.oldest')}</option>
					<option value="rating-high">{t('rated.sort.ratingHigh')}</option>
					<option value="rating-low">{t('rated.sort.ratingLow')}</option>
				{/if}
			</select>
			<span class="bookshelf-page__sort-chevron" aria-hidden="true">
				<ChevronDown size={18} strokeWidth={2} />
			</span>
		</div>
	</div>

	<div
		id="bookshelf-panel"
		class="bookshelf-page__panel"
		role="tabpanel"
		aria-labelledby="bookshelf-tab-{activeFilter}"
	>
		{#if ratedListLoading && ratedLoadTimedOut}
			<p class="bookshelf-page__empty" role="alert">{t('rated.loadError')}</p>
		{:else if listLoading || ratedListLoading || notInterestedInitialLoading}
			<p class="bookshelf-page__loading typ-body">{t('rated.loadingList')}</p>
			<BookCardGridSkeleton class="bookshelf-page__list" ariaLabel={t('rated.title')} />
		{:else if activeFilter === 'rated' && ratedDisplayEntries.length === 0}
			<p class="bookshelf-page__empty">{t('rated.empty')}</p>
		{:else if activeFilter === 'bookmarked' && bookmarkTabBooks.length === 0}
			<p class="bookshelf-page__empty">{t('rated.emptyBookmarked')}</p>
		{:else if activeFilter === 'not-interested' && niTabBooks.length === 0 && !niPageState.nextCursor && !niPageState.error}
			<p class="bookshelf-page__empty">{t('rated.emptyNotInterested')}</p>
		{:else}
			<ul
				class="bookshelf-page__list book-card-grid"
				aria-label={t('shared.ratingsBar.yourRatings')}
				use:trackGridColumns={(c) => (gridColumns = c)}
			>
				{#if activeFilter === 'rated'}
					{#each ratedDisplayEntries as { book }, i (book.id)}
						<li>
							<BookCard
								context="rated"
								{book}
								coverPriority={coverPriorityFor(i, gridColumns)}
								bookmarked={$planToReadStore.has(book.id)}
								onBookmark={(id) => handleBookmark(book, id)}
								currentRating={$ratingsStore.get(book.id) ?? null}
								onRate={(id, value) => ratingsStore.setRating(id, value, book.book_id, book)}
								onRemoveRating={(id) => ratingsStore.removeRating(id, book.book_id)}
								notInterested={$notInterestedStore.has(book.book_id)}
								onNotInterested={() => handleNotInterested(book)}
							/>
						</li>
					{/each}
				{:else}
					{#each currentListBooks as book, i (book.id)}
						{@const ctx = cardContextFor()}
						<li>
							<BookCard
								context={ctx}
								{book}
								coverPriority={coverPriorityFor(i, gridColumns)}
								bookmarked={$planToReadStore.has(book.id)}
								onBookmark={(id) => handleBookmark(book, id)}
								currentRating={$ratingsStore.get(book.id) ?? null}
								onRate={(id, value) =>
									ctx === 'not-interested'
										? handleRateFromNi(book, id, value)
										: ratingsStore.setRating(id, value, book.book_id, book)}
								onRemoveRating={(id) => ratingsStore.removeRating(id, book.book_id)}
								notInterested={$notInterestedStore.has(book.book_id)}
								onNotInterested={() => handleNotInterested(book)}
							/>
						</li>
					{/each}
				{/if}
			</ul>
			{#if activeFilter === 'not-interested'}
				<NotInterestedPagination state={niPageState} order={notInterestedSortOrder} />
			{/if}
		{/if}
	</div>
</div>

<style>
	.bookshelf-page {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		width: 100%;
		padding-bottom: var(--space-8);
	}
	.bookshelf-page__title {
		margin: 0 0 var(--space-8) 0;
		text-align: center;
	}
	.bookshelf-page__panel {
		align-self: stretch;
		min-width: 0;
	}
	.bookshelf-page__tabs-wrap {
		display: flex;
		flex-wrap: nowrap;
		align-items: flex-end;
		justify-content: flex-start;
		width: fit-content;
		gap: var(--space-3);
		margin: 0 0 var(--space-5) 0;
	}
	.bookshelf-page__tabs-wrap :global(.nav-style-tabs__wrap) {
		width: auto;
		flex: 1 1 auto;
		min-width: 0;
	}
	.bookshelf-page__tabs-wrap :global(.nav-style-tabs__list) {
		width: auto;
	}
	.bookshelf-page__tabs-sort-divider {
		flex: 0 0 auto;
		width: 1px;
		height: 1.125rem;
		align-self: center;
		background: color-mix(in srgb, var(--color-border) 55%, transparent);
	}
	@media (max-width: 767px) {
		.bookshelf-page__tabs-wrap {
			align-self: stretch;
			width: 100%;
			max-width: 100%;
			min-width: 0;
		}
		.bookshelf-page__tabs-wrap :global(.nav-style-tabs__wrap) {
			flex: 1 1 auto;
			min-width: 0;
			max-width: 100%;
		}
	}
	.bookshelf-page__sort {
		position: relative;
		display: inline-flex;
		align-items: stretch;
		flex-shrink: 0;
		max-width: 100%;
		vertical-align: middle;
		border-radius: var(--radius-pill);
		background: transparent;
		cursor: pointer;
		transition: background 0.15s ease;
	}
	.bookshelf-page__sort:hover {
		background: var(--color-interactive-hover-subtle);
	}
	/**
	 * Sizer width = selected label only (native `<select>` uses widest option otherwise).
	 * Padding matches `.nav-style-tabs__tab` + `space-1` + 18px chevron (like label + gap + count).
	 */
	.bookshelf-page__sort-sizer {
		display: inline-block;
		padding: var(--chrome-menu-padding-block)
			calc(var(--chrome-menu-padding-inline) + var(--space-1) + 1.125rem)
			var(--chrome-menu-padding-block) var(--chrome-menu-padding-inline);
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		white-space: nowrap;
		visibility: hidden;
		pointer-events: none;
	}
	.bookshelf-page__sort-select {
		appearance: none;
		-webkit-appearance: none;
		position: absolute;
		inset: 0;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		margin: 0;
		min-width: 0;
		padding: var(--chrome-menu-padding-block)
			calc(var(--chrome-menu-padding-inline) + var(--space-1) + 1.125rem)
			var(--chrome-menu-padding-block) var(--chrome-menu-padding-inline);
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text-muted);
		background: transparent;
		border: none;
		border-radius: inherit;
		cursor: pointer;
		transition: color 0.15s ease;
	}
	.bookshelf-page__sort:hover .bookshelf-page__sort-select {
		color: var(--color-text);
	}
	/** Match `.nav-style-tabs__tab:focus-visible`. */
	.bookshelf-page__sort-select:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.bookshelf-page__sort-chevron {
		position: absolute;
		right: var(--chrome-menu-padding-inline);
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		color: var(--color-text-muted);
		pointer-events: none;
	}
	.bookshelf-page__sort:hover .bookshelf-page__sort-chevron {
		color: var(--color-text);
	}
	.bookshelf-page__loading {
		margin: 0 0 var(--space-3) 0;
		text-align: left;
		color: var(--color-text-muted);
	}
	.bookshelf-page__empty {
		color: var(--color-text-muted);
		margin: 0;
		text-align: left;
	}
	.bookshelf-page__list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
</style>
