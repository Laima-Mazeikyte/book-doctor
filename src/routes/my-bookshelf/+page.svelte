<script lang="ts">
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
	import BookCard from '$lib/components/BookCard.svelte';
	import BookCardSkeleton from '$lib/components/BookCardSkeleton.svelte';
	import NavStyleTabList from '$lib/components/NavStyleTabList.svelte';
	import { t } from '$lib/copy';
	import type { Book, RatingValue } from '$lib/types/book';

	const FILTER_IDS = ['rated', 'bookmarked', 'not-interested'] as const;
	type FilterId = (typeof FILTER_IDS)[number];

	const LS_FILTER_KEY = 'book-doctor:my-bookshelf-filter';

	function isValidFilter(s: string | null | undefined): s is FilterId {
		return s != null && (FILTER_IDS as readonly string[]).includes(s);
	}

	/** Partition priority: not interested > rated > bookmarked (disjoint buckets). */
	type Bucket = 'ni' | 'rated' | 'bookmarked';

	function bucketFor(
		book: Book,
		ratings: Map<string, RatingValue>,
		planIds: Set<string>,
		niNums: Set<number>
	): Bucket | null {
		const bid = book.book_id ?? 0;
		if (niNums.has(bid)) return 'ni';
		if (ratings.has(book.id) && ratingsStore.getRatedBook(book.id)) return 'rated';
		if (planIds.has(book.id)) return 'bookmarked';
		return null;
	}

	let displayedEntries = $state<Array<{ book: Book; ratingAtLoad: RatingValue }>>([]);
	let bookmarkBooks = $state<Book[]>([]);
	let niBooks = $state<Book[]>([]);
	let bmNiLoading = $state(false);
	let loadRequestId = 0;

	let activeFilter = $state<FilterId>('rated');

	$effect(() => {
		if ($ratingsStore.size > 0 && displayedEntries.length === 0) {
			displayedEntries = Array.from($ratingsStore.entries())
				.map(([bookId, rating]) => {
					const book = ratingsStore.getRatedBook(bookId);
					return book ? { book, ratingAtLoad: rating } : null;
				})
				.filter((e): e is { book: Book; ratingAtLoad: RatingValue } => e !== null);
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

	$effect(() => {
		if (!browser) return;
		const param = $page.url.searchParams.get('filter');
		if (isValidFilter(param)) {
			if (activeFilter !== param) activeFilter = param;
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
		if (activeFilter !== next) activeFilter = next;
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
		for (const book of unionBooksById.values()) {
			const b = bucketFor(book, $ratingsStore, planIds, niNums);
			if (b === 'ni') ni++;
			else if (b === 'rated') rated++;
			else if (b === 'bookmarked') bookmarked++;
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

	const bookmarkTabBooks = $derived(
		bookmarkBooks.filter(
			(b) => bucketFor(b, $ratingsStore, planIds, niNums) === 'bookmarked'
		)
	);

	const niTabBooks = $derived(niBooks.filter((b) => $notInterestedStore.has(b.book_id ?? 0)));

	const listNeedsBmNi = $derived(
		activeFilter === 'bookmarked' || activeFilter === 'not-interested'
	);

	const listLoading = $derived($authStore.session?.access_token && listNeedsBmNi && bmNiLoading);

	const currentListBooks = $derived.by((): Book[] => {
		if (activeFilter === 'rated') return displayedEntries.map((e) => e.book);
		if (activeFilter === 'bookmarked') return bookmarkTabBooks;
		return niTabBooks;
	});

	function cardContextFor(book: Book): 'rated' | 'bookmarks' | 'not-interested' {
		const b = bucketFor(book, $ratingsStore, planIds, niNums);
		if (b === 'ni') return 'not-interested';
		if (b === 'bookmarked') return 'bookmarks';
		return 'rated';
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
				bookmarkBooks = [book, ...bookmarkBooks];
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
			niBooks = [book, ...niBooks.filter((b) => b.id !== book.id)];
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
	<h1 class="bookshelf-page__title typ-display2">{t('rated.title')}</h1>

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
	</div>

	<div
		id="bookshelf-panel"
		class="bookshelf-page__panel"
		role="tabpanel"
		aria-labelledby="bookshelf-tab-{activeFilter}"
	>
		{#if listLoading}
			<p class="bookshelf-page__loading typ-body">{t('rated.loadingList')}</p>
			<ul class="bookshelf-page__list book-card-grid" aria-busy="true" aria-label={t('rated.title')}>
				{#each Array(6) as _, index (index)}
					<li><BookCardSkeleton /></li>
				{/each}
			</ul>
		{:else if activeFilter === 'rated' && displayedEntries.length === 0}
			<p class="bookshelf-page__empty">{t('rated.empty')}</p>
		{:else if activeFilter === 'bookmarked' && bookmarkTabBooks.length === 0}
			<p class="bookshelf-page__empty">{t('rated.emptyBookmarked')}</p>
		{:else if activeFilter === 'not-interested' && niTabBooks.length === 0}
			<p class="bookshelf-page__empty">{t('rated.emptyNotInterested')}</p>
		{:else}
			<ul class="bookshelf-page__list book-card-grid" aria-label={t('shared.ratingsBar.yourRatings')}>
				{#if activeFilter === 'rated'}
					{#each displayedEntries as { book } (book.id)}
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
						{@const ctx = cardContextFor(book)}
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
		padding-bottom: var(--space-8);
	}
	.bookshelf-page__title {
		margin: 0 0 var(--space-4) 0;
		text-align: left;
	}
	.bookshelf-page__tabs-wrap {
		margin: 0 0 var(--space-5) 0;
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
