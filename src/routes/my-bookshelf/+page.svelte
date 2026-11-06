<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { get } from 'svelte/store';
	import { browser } from '$app/environment';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/stores';
	import { authStore, authReady } from '$lib/stores/auth';
	import { ratingsStore } from '$lib/stores/ratings';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import { bookmarksPageStore } from '$lib/stores/bookmarksPage';
	import { ratedSummarySheetKeepAlive } from '$lib/stores/ratedSummarySheetKeepAlive';
	import {
		areLibraryCollectionsAvailable,
		requestUserLibraryDetailsLoad,
		userLibraryHydrationStore
	} from '$lib/stores/userLibrary';
	import { libraryLoads, type LibraryCollection } from '$lib/stores/libraryLoads';
	import { loadBookmarkDetails } from '$lib/auth/load-bookmarks';
	import LibraryLoadNotice from '$lib/components/LibraryLoadNotice.svelte';
	import Button from '$lib/components/Button.svelte';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookCardGridSkeleton from '$lib/components/BookCardGridSkeleton.svelte';
	import NotInterestedPagination from '$lib/components/NotInterestedPagination.svelte';
	import SearchBar from '$lib/components/SearchBar.svelte';
	import ShelfSortMenu from '$lib/components/ShelfSortMenu.svelte';
	import {
		coverPriorityFor,
		estimateGridColumns,
		trackGridColumns
	} from '$lib/components/book-card/coverPriority';
	import NavStyleTabList from '$lib/components/NavStyleTabList.svelte';
	import { t } from '$lib/copy';
	import { notInterestedPageLoader, notInterestedPageStore } from '$lib/notInterested/pageLoader';
	import type { NotInterestedOrder } from '$lib/notInterested/types';
	import type { Book, RatingValue } from '$lib/types/book';
	import { createShelfSearch } from '$lib/search/shelfSearch';

	/** Rendered column count for the bookshelf grid — drives cover eager/lazy priority. */
	// Token refreshes keep the current retry budget; changing accounts starts a new load.
	const libraryUserId = $derived($authStore.user?.id);
	let gridColumns = $state(estimateGridColumns());

	const FILTER_IDS = ['rated', 'bookmarked', 'not-interested'] as const;
	type FilterId = (typeof FILTER_IDS)[number];

	const LS_FILTER_KEY = 'book-doctor:my-bookshelf-filter';
	const LS_SORT_KEY = 'book-doctor:my-bookshelf-sort';
	const LS_NI_SORT_KEY = 'book-doctor:my-bookshelf-not-interested-sort';

	const SHELF_SORT_IDS = [
		'newest',
		'oldest',
		'year-newest',
		'year-oldest',
		'rating-high',
		'rating-low'
	] as const;
	type ShelfSortId = (typeof SHELF_SORT_IDS)[number];
	const NOT_INTERESTED_SORT_IDS = SHELF_SORT_IDS;
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

	function readInitialFilter(): FilterId {
		const current = get(page);
		const param = current.state.bookshelfFilter ?? current.url.searchParams.get('filter');
		if (isValidFilter(param)) return param;
		return 'rated';
	}

	function replaceFilterQuery(filter: FilterId): void {
		const current = get(page);
		const url = new URL(window.location.href);
		url.searchParams.set('filter', filter);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- update this shelf's query without navigating or remounting the page
		replaceState(url, { ...current.state, bookshelfFilter: filter });
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

	function publicationYear(book: Book): number | null {
		const value = book.year?.trim() ?? '';
		if (!/^-?\d+$/.test(value)) return null;
		const year = Number(value);
		return Number.isSafeInteger(year) && year !== 0 ? year : null;
	}

	function comparePublicationYears(a: Book, b: Book, order: 'year-newest' | 'year-oldest'): number {
		const yearA = publicationYear(a);
		const yearB = publicationYear(b);
		if (yearA === null) return yearB === null ? 0 : 1;
		if (yearB === null) return -1;
		return order === 'year-newest' ? yearB - yearA : yearA - yearB;
	}

	/** Recency order is list order; ties keep recency order and unknown years always sort last. */
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
		if (order === 'year-newest' || order === 'year-oldest') {
			return arr.sort(
				(a, b) =>
					comparePublicationYears(a, b, order) ||
					(baseIdx.get(a.id) ?? 0) - (baseIdx.get(b.id) ?? 0)
			);
		}

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
	const bookmarkLoad = $derived($userLibraryHydrationStore.collections.bookmarkDetails);
	const bookmarkLoading = $derived(
		Boolean($authStore.user) &&
			!bookmarkLoad.hasSnapshot &&
			bookmarkLoad.status !== 'error' &&
			bookmarkBooks.length === 0
	);

	let activeFilter = $state<FilterId>(readInitialFilter());
	let sortOrder = $state<ShelfSortId>(readSortFromLs());
	let notInterestedSortOrder = $state<NotInterestedSortId>(readNotInterestedSortFromLs());
	const shelfScrollPositions = new SvelteMap<string, number>();
	let shelfSearch = $state<Record<FilterId, string>>({
		rated: '',
		bookmarked: '',
		'not-interested': ''
	});
	const shelfSearchQuery = $derived(shelfSearch[activeFilter].trim().toLowerCase());
	const activeSortOrder = $derived(
		activeFilter === 'not-interested' ? notInterestedSortOrder : sortOrder
	);
	const niPageOrder = $derived<NotInterestedOrder>(
		notInterestedSortOrder === 'oldest' ? 'oldest' : 'newest'
	);
	const niNeedsComplete = $derived(
		shelfSearchQuery !== '' || !['newest', 'oldest'].includes(notInterestedSortOrder)
	);
	let destroyed = false;
	onDestroy(() => {
		destroyed = true;
	});

	async function retryNotInterested() {
		const order = niPageOrder;
		const owner = libraryUserId;
		const canContinue = () =>
			!destroyed &&
			activeFilter === 'not-interested' &&
			libraryUserId === owner &&
			niPageOrder === order &&
			niNeedsComplete;
		await notInterestedPageLoader.retry(order);
		if (canContinue() && !notInterestedPageLoader.getSnapshot(order).error) {
			await notInterestedPageLoader.ensureAllLoaded(order, () => !canContinue());
		}
	}

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
				} else if (sortOrder === 'year-newest' || sortOrder === 'year-oldest') {
					const order = sortOrder;
					sorted.sort(
						(a, b) =>
							comparePublicationYears(a.book, b.book, order) ||
							(baseIdx.get(a.book.id) ?? 0) - (baseIdx.get(b.book.id) ?? 0)
					);
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
		const userId = libraryUserId;
		if (!userId) return;
		untrack(() => {
			void libraryLoads.visit(['ratings', 'bookmarks', 'dismissals', 'ratedDetails']);
			void loadBookmarkDetails(userId, true);
		});
	});
	$effect(() => {
		const snapshot = $bookmarksPageStore;
		bookmarkBooks = snapshot.userId === $authStore.user?.id ? snapshot.books : [];
	});
	$effect(() => {
		const userId = libraryUserId;
		const hydration = $userLibraryHydrationStore;
		if (userId && hydration.userId === userId && hydration.collections.ratings.status !== 'idle') {
			// Shelf details are visible work here, rather than an idle-time feed warmup.
			untrack(() => requestUserLibraryDetailsLoad(userId));
		}
	});
	$effect(() => {
		const userId = libraryUserId;
		const resources = activeResources;
		if (userId) untrack(() => void libraryLoads.visit(resources));
	});

	$effect(() => {
		const filter = activeFilter;
		const order = niPageOrder;
		const needsComplete = niNeedsComplete;
		void libraryUserId;
		if (filter !== 'not-interested') return;
		let cancelled = false;
		untrack(() => {
			void (needsComplete
				? notInterestedPageLoader.ensureAllLoaded(order, () => cancelled)
				: notInterestedPageLoader.ensureLoaded(order));
		});
		return () => {
			cancelled = true;
		};
	});

	/** URL changes, including Back/Forward, select the shelf without resetting its local state. */
	$effect(() => {
		if (!browser) return;
		const param = $page.state.bookshelfFilter ?? $page.url.searchParams.get('filter');
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
		// Initial effects can run before SvelteKit finishes initializing its router.
		const filter = next;
		const timer = setTimeout(() => {
			if (!destroyed && activeFilter === filter) replaceFilterQuery(filter);
		}, 0);
		return () => clearTimeout(timer);
	});

	const ratedBooksForPartition = $derived($ratedBooksStore.map((e) => e.book));

	const notInterestedIds = $derived.by(() => new SvelteSet([...$notInterestedStore]));
	const planIds = $derived($planToReadStore);

	const ratedResources = ['ratings', 'ratedDetails', 'dismissals'] as const;
	const bookmarkResources = ['bookmarks', 'bookmarkDetails', 'dismissals'] as const;
	const activeResources = $derived<readonly LibraryCollection[]>(
		activeFilter === 'rated'
			? ratedResources
			: activeFilter === 'bookmarked'
				? bookmarkResources
				: ['dismissals']
	);
	const activeLoadFailed = $derived(
		$userLibraryHydrationStore.userId === $authStore.user?.id &&
			activeResources.some(
				(kind) => $userLibraryHydrationStore.collections[kind].status === 'error'
			)
	);
	const ratedHydrating = $derived(
		!$authReady ||
			!areLibraryCollectionsAvailable($authStore.user?.id, $userLibraryHydrationStore, [
				'ratings',
				'ratedDetails'
			])
	);
	const countsReady = $derived($authReady);
	function countReady(id: string): boolean {
		return (
			$authReady &&
			areLibraryCollectionsAvailable($authStore.user?.id, $userLibraryHydrationStore, [
				id === 'rated' ? 'ratings' : 'bookmarks'
			])
		);
	}

	const tabCounts = $derived.by(() => {
		if (!countsReady) return { rated: 0, bookmarked: 0 };
		let rated = $ratingsStore.size;
		for (const book of ratedBooksForPartition) {
			if (isNotInterested(book, notInterestedIds)) rated--;
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
	const searchPlaceholder = $derived(t(`rated.search.placeholders.${activeFilter}`));

	const niPageState = $derived($notInterestedPageStore.entries[niPageOrder]);

	const sortOptions: { value: ShelfSortId; label: string }[] = $derived([
		{ value: 'newest', label: t('rated.sort.newest') },
		{ value: 'oldest', label: t('rated.sort.oldest') },
		{ value: 'year-newest', label: t('rated.sort.yearNewest') },
		{ value: 'year-oldest', label: t('rated.sort.yearOldest') },
		{ value: 'rating-high', label: t('rated.sort.ratingHigh') },
		{ value: 'rating-low', label: t('rated.sort.ratingLow') }
	]);

	const bookmarkDetails = planToReadStore.bookDetails;
	const bookmarkTabBooks = $derived.by(() => {
		void $bookmarkDetails;
		return planToReadStore
			.mergeBooks(bookmarkBooks)
			.filter(
				(b) =>
					(!countReady('bookmarked') || planIds.has(b.id)) && !isNotInterested(b, notInterestedIds)
			);
	});

	const niTabBooks = $derived(niPageState.books);

	const ratedSearchBooks = $derived.by(() => {
		const keep = $ratedSummarySheetKeepAlive;
		return keep && !ratedBooksForPartition.some((book) => book.id === keep.bookId)
			? [...ratedBooksForPartition, keep.book]
			: ratedBooksForPartition;
	});
	const ratedSearchIndex = $derived(createShelfSearch(ratedSearchBooks));
	const bookmarkSearchIndex = $derived(createShelfSearch(bookmarkTabBooks));
	const niSearchIndex = $derived(createShelfSearch(niTabBooks));
	const activeSearchIndex = $derived(
		activeFilter === 'rated'
			? ratedSearchIndex
			: activeFilter === 'bookmarked'
				? bookmarkSearchIndex
				: niSearchIndex
	);
	const matchingBookIds = $derived(activeSearchIndex.matchingIds(shelfSearchQuery));

	const sortedBookmarkTabBooks = $derived.by(() =>
		sortBooksByShelfOrder(bookmarkTabBooks, sortOrder, $ratingsStore)
	);

	const listLoading = $derived(
		Boolean($authStore.session?.access_token) &&
			activeFilter === 'bookmarked' &&
			bookmarkLoading &&
			!activeLoadFailed
	);
	const notInterestedInitialLoading = $derived(
		activeFilter === 'not-interested' &&
			!niPageState.error &&
			(!niPageState.loaded ||
				(niNeedsComplete && Boolean(niPageState.loading || niPageState.nextCursor)))
	);

	// Rated tab: show the loading skeleton (not the empty message) while the library is still
	// hydrating and we have nothing to show yet. Locally-cached ratings render immediately, so this
	// only kicks in when the list is genuinely empty pending the server sync.
	const ratedListLoading = $derived(
		activeFilter === 'rated' &&
			ratedHydrating &&
			ratedDisplayEntries.length === 0 &&
			!activeLoadFailed
	);

	const currentShelfBooks = $derived.by((): Book[] => {
		if (activeFilter === 'rated') return ratedDisplayEntries.map((e) => e.book);
		if (activeFilter === 'bookmarked') return sortedBookmarkTabBooks;
		// Recency pages already arrive in the requested order. Other sorts require every page.
		return notInterestedSortOrder === 'newest' || notInterestedSortOrder === 'oldest'
			? niTabBooks
			: sortBooksByShelfOrder(niTabBooks, notInterestedSortOrder, $ratingsStore);
	});
	const currentListBooks = $derived(
		matchingBookIds === null
			? currentShelfBooks
			: currentShelfBooks.filter((book) => matchingBookIds.has(book.id))
	);

	// Keep full shelf data for search/sorting, but only mount card controls as needed.
	const SHELF_RENDER_BATCH = 24;
	const shelfRenderCounts = new SvelteMap<string, number>();
	const shelfRenderCount = $derived(shelfRenderCounts.get(shelfScrollKey()) ?? SHELF_RENDER_BATCH);
	const renderedListBooks = $derived.by(() => {
		if (activeFilter === 'not-interested') return currentListBooks;
		const visible = currentListBooks.slice(0, shelfRenderCount);
		const keep = $ratedSummarySheetKeepAlive;
		if (activeFilter === 'rated' && keep && !visible.some((book) => book.id === keep.bookId)) {
			const book = currentListBooks.find((book) => book.id === keep.bookId);
			if (book) visible.push(book);
		}
		return visible;
	});
	const hasMoreShelfBooks = $derived(
		activeFilter !== 'not-interested' && currentListBooks.length > shelfRenderCount
	);

	function revealMoreShelfBooks(): void {
		if (!hasMoreShelfBooks) return;
		shelfRenderCounts.set(shelfScrollKey(), shelfRenderCount + SHELF_RENDER_BATCH);
	}

	function revealOnScroll(node: HTMLElement, renderedCount: number) {
		if (typeof IntersectionObserver === 'undefined') return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) revealMoreShelfBooks();
			},
			{ rootMargin: '400px' }
		);
		observer.observe(node);
		return {
			update(nextCount: number) {
				if (nextCount === renderedCount) return;
				renderedCount = nextCount;
				// Recheck after each batch, even if the footer remains near the viewport.
				observer.unobserve(node);
				observer.observe(node);
			},
			destroy() {
				observer.disconnect();
			}
		};
	}

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
		replaceFilterQuery(id);
		restoreShelfScroll(id);
	}

	function handleBookmark(book: Book, id: string) {
		const wasBookmarked = planToReadStore.has(book.id);
		planToReadStore.toggle(id, book.book_id, book);
		if (!wasBookmarked) {
			notInterestedStore.remove(book.book_id);
			if (!bookmarkBooks.some((b) => b.id === book.id)) {
				const rest = bookmarkBooks.filter((b) => b.id !== book.id);
				bookmarkBooks = [book, ...rest];
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
		const nowNotInterested = notInterestedStore.toggle(bid, book);
		if (nowNotInterested && !wasNotInterested) {
			if (planToReadStore.has(book.id)) {
				planToReadStore.toggle(book.id, book.book_id, book);
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

	<div class="bookshelf-page__search">
		<SearchBar
			bind:value={shelfSearch[activeFilter]}
			placeholder={searchPlaceholder}
			ariaLabel={searchPlaceholder}
		/>
	</div>

	<div class="bookshelf-page__tabs-wrap">
		<NavStyleTabList
			ariaLabel={t('rated.tabs.ariaLabel')}
			panelId="bookshelf-panel"
			idPrefix="bookshelf-tab"
			items={tabItems}
			selectedId={activeFilter}
			{countsReady}
			getCountReady={countReady}
			getCountFailed={(id) =>
				$userLibraryHydrationStore.collections[id === 'rated' ? 'ratings' : 'bookmarks'].status ===
				'error'}
			countedTabIds={['rated', 'bookmarked']}
			getCount={(id) => countForTab(id as FilterId)}
			onSelect={(id) => selectTab(id as FilterId)}
		/>
		<div class="bookshelf-page__tabs-sort-divider" aria-hidden="true"></div>
		<div class="bookshelf-page__sort">
			<ShelfSortMenu
				options={sortOptions}
				value={activeSortOrder}
				ariaLabel={t('rated.sort.ariaLabel')}
				onChange={(value) => {
					if (activeFilter === 'not-interested') {
						if (isValidNotInterestedSortId(value)) setNotInterestedSortOrder(value);
					} else if (isValidShelfSortId(value)) setSortOrder(value);
				}}
			/>
		</div>
	</div>

	<div
		id="bookshelf-panel"
		class="bookshelf-page__panel"
		role="tabpanel"
		aria-labelledby="bookshelf-tab-{activeFilter}"
	>
		<LibraryLoadNotice
			collections={activeResources}
			label={activeFilter === 'rated'
				? 'ratings'
				: activeFilter === 'bookmarked'
					? 'bookmarks'
					: 'dismissals'}
		/>
		{#if listLoading || ratedListLoading || notInterestedInitialLoading}
			<p class="bookshelf-page__loading typ-body">{t('rated.loadingList')}</p>
			<BookCardGridSkeleton class="bookshelf-page__list" ariaLabel={t('rated.title')} />
		{:else if activeFilter === 'rated' && ratedDisplayEntries.length === 0 && !activeLoadFailed}
			<p class="bookshelf-page__empty">{t('rated.empty')}</p>
		{:else if activeFilter === 'bookmarked' && bookmarkTabBooks.length === 0 && !activeLoadFailed}
			<p class="bookshelf-page__empty">{t('rated.emptyBookmarked')}</p>
		{:else if activeFilter === 'not-interested' && niTabBooks.length === 0 && !niPageState.nextCursor && !niPageState.error}
			<p class="bookshelf-page__empty">{t('rated.emptyNotInterested')}</p>
		{:else if currentListBooks.length === 0 && !(activeFilter === 'not-interested' && niPageState.error)}
			<p class="bookshelf-page__empty" role="status">
				{t(`rated.search.noResults.${activeFilter}`)}
			</p>
		{:else}
			<ul
				class="bookshelf-page__list book-card-grid"
				aria-label={t('shared.ratingsBar.yourRatings')}
				use:trackGridColumns={(c) => (gridColumns = c)}
			>
				{#if activeFilter === 'rated'}
					{#each renderedListBooks as book, i (book.id)}
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
					{#each renderedListBooks as book, i (book.id)}
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
		{/if}
		{#if hasMoreShelfBooks}
			<div class="bookshelf-page__more" use:revealOnScroll={renderedListBooks.length}>
				<Button variant="secondary" onclick={revealMoreShelfBooks}>{t('rated.loadMore')}</Button>
			</div>
		{/if}
		{#if activeFilter === 'not-interested' && !notInterestedInitialLoading}
			<NotInterestedPagination
				state={niPageState}
				order={niPageOrder}
				onRetry={retryNotInterested}
			/>
		{/if}
	</div>
</div>

<style>
	.bookshelf-page__more {
		display: flex;
		justify-content: center;
		margin-top: var(--space-5);
	}

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
	.bookshelf-page__search {
		width: 100%;
		min-width: 0;
		max-width: min(48rem, 100%);
		margin: 0 auto var(--space-5);
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
		display: inline-flex;
		flex-shrink: 0;
		max-width: 100%;
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
