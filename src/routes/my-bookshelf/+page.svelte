<script lang="ts">
	import { untrack } from 'svelte';
	import { get } from 'svelte/store';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth';
	import { ratingsStore } from '$lib/stores/ratings';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import { bookmarksPageStore } from '$lib/stores/bookmarksPage';
	import { recommendationsCountStore } from '$lib/stores/recommendationsCount';
	import { ratedSummarySheetKeepAlive } from '$lib/stores/ratedSummarySheetKeepAlive';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookCardGridSkeleton from '$lib/components/BookCardGridSkeleton.svelte';
	import NavStyleTabList from '$lib/components/NavStyleTabList.svelte';
	import { ChevronDown } from 'lucide-svelte';
	import { t } from '$lib/copy';
	import type { Book, RatingValue } from '$lib/types/book';

	const FILTER_IDS = ['rated', 'bookmarked', 'not-interested'] as const;
	type FilterId = (typeof FILTER_IDS)[number];

	const LS_FILTER_KEY = 'book-doctor:my-bookshelf-filter';
	const LS_SORT_KEY = 'book-doctor:my-bookshelf-sort';

	const SHELF_SORT_IDS = ['newest', 'oldest', 'rating-high', 'rating-low'] as const;
	type ShelfSortId = (typeof SHELF_SORT_IDS)[number];

	function isValidShelfSortId(s: string | null | undefined): s is ShelfSortId {
		return s != null && (SHELF_SORT_IDS as readonly string[]).includes(s);
	}

	function isValidFilter(s: string | null | undefined): s is FilterId {
		return s != null && (FILTER_IDS as readonly string[]).includes(s);
	}

	/** Not interested is exclusive; rated and bookmarked can overlap. */
	function isNotInterested(book: Book, niNums: Set<number>): boolean {
		return niNums.has(book.book_id ?? 0);
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
	let niBooks = $state<Book[]>([]);
	let bmNiLoading = $state(false);
	let loadRequestId = 0;

	let activeFilter = $state<FilterId>('rated');
	let sortOrder = $state<ShelfSortId>(readSortFromLs());

	const ratedDisplayEntries = $derived.by(() => {
		type RatedEntry = { book: Book; ratingAtLoad: RatingValue };
		const baseEntries: RatedEntry[] = Array.from($ratingsStore.entries())
			.map(([bookId, rating]) => {
				const book = ratingsStore.getRatedBook(bookId);
				return book ? { book, ratingAtLoad: rating } : null;
			})
			.filter((e): e is RatedEntry => e !== null);

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
		const requestId = ++loadRequestId;

		if (!token) {
			bmNiLoading = false;
			bookmarkBooks = snapshot.loaded ? snapshot.books : [];
			niBooks = [];
			return;
		}

		bmNiLoading = true;
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

		const niPromise = fetch('/api/not-interested/books', {
			headers: { Authorization: `Bearer ${token}` }
		})
			.then((res) => {
				if (!res.ok) throw new Error('ni');
				return res.json() as Promise<{ books: Book[] }>;
			})
			.then((d) => d.books ?? [])
			.catch(() => [] as Book[]);

		void Promise.all([bmPromise, niPromise]).then(([bm, ni]) => {
			if (requestId !== loadRequestId) return;
			bookmarkBooks = bm;
			niBooks = ni;
			bookmarksPageStore.setBooks(bm);
			bmNiLoading = false;
		});
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
		void goto(`/my-bookshelf?filter=${encodeURIComponent(next)}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	});

	const ratedBooksForPartition = $derived(
		Array.from($ratingsStore.entries())
			.map(([id]) => ratingsStore.getRatedBook(id))
			.filter((b): b is Book => b != null)
	);

	const unionBooksById = $derived.by(() => {
		const m = new Map<string, Book>();
		for (const b of ratedBooksForPartition) m.set(b.id, b);
		for (const b of bookmarkBooks) if (!m.has(b.id)) m.set(b.id, b);
		for (const b of niBooks) {
			if ($notInterestedStore.has(b.book_id ?? 0) && !m.has(b.id)) m.set(b.id, b);
		}
		return m;
	});

	const niNums = $derived.by(() => new Set([...$notInterestedStore]));
	const planIds = $derived($planToReadStore);

	const countsReady = $derived(!$authStore.session?.access_token || !bmNiLoading);

	const partitionCounts = $derived.by(() => {
		if (!countsReady) return { ni: 0, rated: 0, bookmarked: 0 };
		let ni = 0;
		let rated = 0;
		let bookmarked = 0;
		const ratings = $ratingsStore;
		for (const book of unionBooksById.values()) {
			if (isNotInterested(book, niNums)) {
				ni++;
				continue;
			}
			if (ratings.has(book.id) && ratingsStore.getRatedBook(book.id)) rated++;
			if (planIds.has(book.id)) bookmarked++;
		}
		return { ni, rated, bookmarked };
	});

	function countForTab(id: FilterId): number {
		if (id === 'rated') return partitionCounts.rated;
		if (id === 'bookmarked') return partitionCounts.bookmarked;
		return partitionCounts.ni;
	}

	const tabItems = $derived([
		{ id: 'rated' as FilterId, label: t('rated.tabs.rated') },
		{ id: 'bookmarked' as FilterId, label: t('rated.tabs.bookmarked') },
		{ id: 'not-interested' as FilterId, label: t('rated.tabs.notInterested') }
	]);

	const sortOptionLabel = $derived.by((): string => {
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
		bookmarkBooks.filter((b) => !isNotInterested(b, niNums))
	);

	const niTabBooks = $derived(niBooks.filter((b) => $notInterestedStore.has(b.book_id ?? 0)));

	const sortedBookmarkTabBooks = $derived.by(() =>
		sortBooksByShelfOrder(bookmarkTabBooks, sortOrder, $ratingsStore)
	);

	const sortedNiTabBooks = $derived.by(() =>
		sortBooksByShelfOrder(niTabBooks, sortOrder, $ratingsStore)
	);

	const listNeedsBmNi = $derived(
		activeFilter === 'bookmarked' || activeFilter === 'not-interested'
	);

	const listLoading = $derived($authStore.session?.access_token && listNeedsBmNi && bmNiLoading);

	const currentListBooks = $derived.by((): Book[] => {
		if (activeFilter === 'rated') return ratedDisplayEntries.map((e) => e.book);
		if (activeFilter === 'bookmarked') return sortedBookmarkTabBooks;
		return sortedNiTabBooks;
	});

	function setSortOrder(next: ShelfSortId) {
		sortOrder = next;
		try {
			localStorage.setItem(LS_SORT_KEY, next);
		} catch {
			// ignore
		}
	}

	function cardContextFor(): 'bookmarks' | 'not-interested' {
		return activeFilter === 'not-interested' ? 'not-interested' : 'bookmarks';
	}

	function selectTab(id: FilterId) {
		activeFilter = id;
		try {
			localStorage.setItem(LS_FILTER_KEY, id);
		} catch {
			// ignore
		}
		void goto(`/my-bookshelf?filter=${encodeURIComponent(id)}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	function handleBookmark(book: Book, id: string) {
		const wasBookmarked = planToReadStore.has(book.id);
		planToReadStore.toggle(id, book.book_id);
		if (!wasBookmarked && book.book_id != null) {
			notInterestedStore.remove(book.book_id);
			niBooks = niBooks.filter((b) => b.book_id !== book.book_id);
			if (!bookmarkBooks.some((b) => b.id === book.id)) {
				const rest = bookmarkBooks.filter((b) => b.id !== book.id);
				bookmarkBooks =
					sortOrder === 'oldest' ? [...rest, book] : [book, ...rest];
				bookmarksPageStore.setBooks(bookmarkBooks);
			}
		}
		if (wasBookmarked) {
			bookmarkBooks = bookmarkBooks.filter((b) => b.id !== book.id);
			bookmarksPageStore.removeBook(book.id);
		}
	}

	function handleNotInterested(book: Book) {
		const bid = book.book_id ?? 0;
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
			{
				const rest = niBooks.filter((b) => b.id !== book.id);
				niBooks = sortOrder === 'oldest' ? [...rest, book] : [book, ...rest];
			}
		} else if (wasNotInterested && !nowNotInterested) {
			niBooks = niBooks.filter((b) => b.book_id !== book.book_id);
		}
	}

	function handleRateFromNi(book: Book, id: string, value: RatingValue) {
		ratingsStore.setRating(id, value, book.book_id ?? 0, book);
		niBooks = niBooks.filter((b) => b.book_id !== book.book_id);
		recommendationsCountStore.update((n) => n + 1);
	}
</script>

<div class="bookshelf-page">
	<h1 class="bookshelf-page__title typ-display2 typ-display2--content">{t('rated.title')}</h1>

	<div class="bookshelf-page__tabs-wrap">
		<NavStyleTabList
			ariaLabel={t('rated.tabs.ariaLabel')}
			panelId="bookshelf-panel"
			idPrefix="bookshelf-tab"
			items={tabItems}
			selectedId={activeFilter}
			countsReady={countsReady}
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
				value={sortOrder}
				onchange={(e) => {
					const v = (e.currentTarget as HTMLSelectElement).value;
					if (isValidShelfSortId(v)) setSortOrder(v);
				}}
			>
				<option value="newest">{t('rated.sort.newest')}</option>
				<option value="oldest">{t('rated.sort.oldest')}</option>
				<option value="rating-high">{t('rated.sort.ratingHigh')}</option>
				<option value="rating-low">{t('rated.sort.ratingLow')}</option>
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
		{#if listLoading}
			<p class="bookshelf-page__loading typ-body">{t('rated.loadingList')}</p>
			<BookCardGridSkeleton
				class="bookshelf-page__list"
				ariaLabel={t('rated.title')}
			/>
		{:else if activeFilter === 'rated' && ratedDisplayEntries.length === 0}
			<p class="bookshelf-page__empty">{t('rated.empty')}</p>
		{:else if activeFilter === 'bookmarked' && bookmarkTabBooks.length === 0}
			<p class="bookshelf-page__empty">{t('rated.emptyBookmarked')}</p>
		{:else if activeFilter === 'not-interested' && niTabBooks.length === 0}
			<p class="bookshelf-page__empty">{t('rated.emptyNotInterested')}</p>
		{:else}
			<ul class="bookshelf-page__list book-card-grid" aria-label={t('shared.ratingsBar.yourRatings')}>
				{#if activeFilter === 'rated'}
					{#each ratedDisplayEntries as { book } (book.id)}
						<li>
							<BookCard
								context="rated"
								{book}
								bookmarked={$planToReadStore.has(book.id)}
								onBookmark={(id) => handleBookmark(book, id)}
								currentRating={$ratingsStore.get(book.id) ?? null}
								onRate={(id, value) => ratingsStore.setRating(id, value, book.book_id, book)}
								onRemoveRating={(id) => ratingsStore.removeRating(id, book.book_id)}
								notInterested={$notInterestedStore.has(book.book_id ?? 0)}
								onNotInterested={() => handleNotInterested(book)}
							/>
						</li>
					{/each}
				{:else}
					{#each currentListBooks as book (book.id)}
						{@const ctx = cardContextFor()}
						<li>
							<BookCard
								context={ctx}
								{book}
								bookmarked={$planToReadStore.has(book.id)}
								onBookmark={(id) => handleBookmark(book, id)}
								currentRating={$ratingsStore.get(book.id) ?? null}
								onRate={(id, value) =>
									ctx === 'not-interested'
										? handleRateFromNi(book, id, value)
										: ratingsStore.setRating(id, value, book.book_id, book)}
								onRemoveRating={(id) => ratingsStore.removeRating(id, book.book_id ?? 0)}
								notInterested={$notInterestedStore.has(book.book_id ?? 0)}
								onNotInterested={() => handleNotInterested(book)}
							/>
						</li>
					{/each}
				{/if}
			</ul>
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
