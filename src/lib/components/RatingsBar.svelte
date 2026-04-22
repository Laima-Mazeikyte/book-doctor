<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { fly } from 'svelte/transition';
	import { ArrowLeft, LibraryBig, X } from 'lucide-svelte';
	import Button from '$lib/components/Button.svelte';
	import BookRatingStarsRow from '$lib/components/book-card/BookRatingStarsRow.svelte';
	import BookSummarySheetBody from '$lib/components/book-card/BookSummarySheetBody.svelte';
	import NavStyleTabList from '$lib/components/NavStyleTabList.svelte';
	import { getBookDisplaySummary } from '$lib/components/book-card/summaryStub';
	import type { RatingsBarSummaryHooks } from '$lib/components/ratings-bar-summary-hooks';
	import { markRateSearchOpenedFromOtherRoute } from '$lib/rateSearchExternalNav';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { ratingsStore } from '$lib/stores/ratings';
	import { t } from '$lib/copy';
	import type { Book, RatingValue } from '$lib/types/book';

	interface RatedEntry {
		book: Book;
		rating: RatingValue;
	}

	interface Props {
		ratedEntries: RatedEntry[];
		summaryHooks?: RatingsBarSummaryHooks;
		/** When both resolvers are set, the drawer shows Rated / Bookmarked / Not interested tabs (browse page). */
		resolveBook?: (bookId: string) => Book | undefined;
		resolveBookByBookNum?: (bookIdNum: number) => Book | undefined;
	}

	let { ratedEntries, summaryHooks, resolveBook, resolveBookByBookNum }: Props = $props();

	type ShelfFilterId = 'rated' | 'bookmarked' | 'not-interested';

	const shelfListPanelId = 'ratings-drawer-shelf-panel';
	const shelfTabIdPrefix = 'ratings-drawer-shelf-tab';

	const shelfTabsEnabled = $derived(Boolean(resolveBook && resolveBookByBookNum));

	let activeShelfTab = $state<ShelfFilterId>('rated');

	function shelfNotInterested(book: Book, niNums: Set<number>): boolean {
		return niNums.has(book.book_id ?? 0);
	}

	const unionBooksById = $derived.by(() => {
		const m = new Map<string, Book>();
		if (!shelfTabsEnabled) return m;
		for (const e of ratedEntries) m.set(e.book.id, e.book);
		for (const id of $planToReadStore) {
			const b = resolveBook?.(id);
			if (b && !m.has(b.id)) m.set(b.id, b);
		}
		for (const num of $notInterestedStore) {
			const b = resolveBookByBookNum?.(num);
			if (b && !m.has(b.id)) m.set(b.id, b);
		}
		return m;
	});

	const partitionCounts = $derived.by(() => {
		if (!shelfTabsEnabled) return { ni: 0, rated: 0, bookmarked: 0 };
		const ratings = $ratingsStore;
		const planIds = $planToReadStore;
		const niNums = $notInterestedStore;
		let ni = 0;
		let rated = 0;
		let bookmarked = 0;
		for (const book of unionBooksById.values()) {
			if (shelfNotInterested(book, niNums)) {
				ni++;
				continue;
			}
			if (ratings.has(book.id) && ratingsStore.getRatedBook(book.id)) rated++;
			if (planIds.has(book.id)) bookmarked++;
		}
		return { ni, rated, bookmarked };
	});

	function countForShelfTab(id: ShelfFilterId): number {
		if (id === 'rated') return partitionCounts.rated;
		if (id === 'bookmarked') return partitionCounts.bookmarked;
		return partitionCounts.ni;
	}

	const shelfTabItems = $derived([
		{ id: 'rated' as const, label: t('rated.tabs.rated') },
		{ id: 'bookmarked' as const, label: t('rated.tabs.bookmarked') },
		{ id: 'not-interested' as const, label: t('rated.tabs.notInterested') }
	]);

	const shelfEmptyMessage = $derived.by(() => {
		if (activeShelfTab === 'rated') return t('rated.empty');
		if (activeShelfTab === 'bookmarked') return t('rated.emptyBookmarked');
		return t('rated.emptyNotInterested');
	});

	const RATING_PLACEHOLDER = 1 as RatingValue;

	const bookmarkedShelfEntries = $derived.by((): RatedEntry[] => {
		if (!shelfTabsEnabled || !resolveBook) return [];
		const ratings = $ratingsStore;
		const planIds = $planToReadStore;
		const niNums = $notInterestedStore;
		const out: RatedEntry[] = [];
		const seen = new Set<string>();
		for (const id of planIds) {
			const book = resolveBook(id);
			if (!book || seen.has(book.id)) continue;
			if (shelfNotInterested(book, niNums)) continue;
			seen.add(book.id);
			const r = ratings.get(book.id);
			out.push({ book, rating: r ?? RATING_PLACEHOLDER });
		}
		return out;
	});

	const niShelfEntries = $derived.by((): RatedEntry[] => {
		if (!shelfTabsEnabled || !resolveBookByBookNum) return [];
		const ratings = $ratingsStore;
		const planIds = $planToReadStore;
		const niNums = $notInterestedStore;
		const out: RatedEntry[] = [];
		const seen = new Set<string>();
		for (const num of niNums) {
			const book = resolveBookByBookNum(num);
			if (!book || seen.has(book.id)) continue;
			if (!niNums.has(book.book_id ?? 0)) continue;
			seen.add(book.id);
			const r = ratings.get(book.id);
			out.push({ book, rating: r ?? RATING_PLACEHOLDER });
		}
		return out;
	});

	const drawerSourceEntries = $derived.by((): RatedEntry[] => {
		if (!shelfTabsEnabled) return ratedEntries;
		if (activeShelfTab === 'rated') return ratedEntries;
		if (activeShelfTab === 'bookmarked') return bookmarkedShelfEntries;
		return niShelfEntries;
	});

	let open = $state(false);
	/** Book ids in list order when the drawer was opened; cleared on close so the next open uses store order (most recent first). */
	let drawerOrderIds = $state<string[] | null>(null);
	let hoverEntryId = $state<string | null>(null);
	let hoverRating = $state<number>(0);
	let coverFailedIds = $state<Set<string>>(new Set());
	/** Book ids scheduled for removal after `PENDING_REMOVE_MS`; store still holds rating until the timer fires or user undoes. */
	let pendingRemoveIds = $state<Set<string>>(new Set());
	/** `Date.now()` when each pending removal will commit (for progress UI). */
	let pendingRemoveEndByBookId = $state(new Map<string, number>());
	let removalUiClock = $state(Date.now());
	let closeButtonEl = $state<HTMLButtonElement | null>(null);
	let drawerBackButtonEl = $state<HTMLButtonElement | null>(null);
	let detailBookId = $state<string | null>(null);
	/** Keeps detail content mounted after the book drops out of the active shelf list (e.g. rating removed). */
	let detailBookSnapshot = $state<Book | null>(null);
	let detailFocusReturnEl = $state<HTMLElement | null>(null);
	let hoverDetailRating = $state(0);
	let drawerHadOpen = $state(false);
	const ratingsSyncMeta = ratingsStore.syncMeta;
	const panelId = 'ratings-drawer-panel';
	const triggerId = 'ratings-trigger';
	const PENDING_REMOVE_MS = 3000;
	const pendingRemoveTimers = new Map<string, ReturnType<typeof setTimeout>>();
	/** Slide distance in px; negative x → panel flies in from the left (desktop and mobile). Match desktop panel max width. */
	const DRAWER_SLIDE_PX_DESKTOP = 520;

	function drawerSlidePx(): number {
		if (typeof window === 'undefined') return -DRAWER_SLIDE_PX_DESKTOP;
		return window.matchMedia('(min-width: 768px)').matches
			? -DRAWER_SLIDE_PX_DESKTOP
			: -window.innerWidth;
	}

	let flyX = $state(-DRAWER_SLIDE_PX_DESKTOP);

	function setCoverFailed(bookId: string) {
		coverFailedIds = new Set(coverFailedIds).add(bookId);
	}

	function seeSummaryOpenAriaLabel(book: Book): string {
		const author = book.author?.trim();
		if (author) {
			return t('shared.recommendationCard.seeSummaryCoverAriaLabelWithAuthor', {
				title: book.title,
				author
			});
		}
		return t('shared.recommendationCard.seeSummaryCoverAriaLabelTitleOnly', { title: book.title });
	}

	let drawerSyncState: 'pending' | 'failed' | null = $derived.by(() => {
		if ($ratingsSyncMeta.queuedCount === 0) return null;
		if ($ratingsSyncMeta.isFlushing || $ratingsSyncMeta.failedCount === 0) return 'pending';
		return 'failed';
	});

	let drawerSyncText = $derived.by(() => {
		if (drawerSyncState === 'failed') return t('shared.ratingsBar.retryNeeded');
		if (drawerSyncState === 'pending') return t('shared.ratingsBar.syncing');
		return '';
	});

	const triggerBadgeCount = $derived(
		shelfTabsEnabled ? unionBooksById.size : ratedEntries.length
	);

	const triggerAriaLabel = $derived(
		`${t('shared.ratingsBar.yourRatings')} (${triggerBadgeCount})`
	);

	/** Portal node to body so it's not inside the bottom bar (pointer-events: none) and can receive clicks. */
	function portal(node: HTMLElement, target: HTMLElement = document.body) {
		target.appendChild(node);
		return {
			destroy() {
				node.parentNode?.removeChild(node);
			}
		};
	}

	/** While the drawer is open, keep row order stable when the underlying list changes. */
	const drawerOrderedEntries = $derived.by(() => {
		const source = drawerSourceEntries;
		if (!open || drawerOrderIds === null) return source;
		const byId = new Map(source.map((e) => [e.book.id, e]));
		const ordered: RatedEntry[] = [];
		const seen = new Set<string>();
		for (const id of drawerOrderIds) {
			const e = byId.get(id);
			if (e) {
				ordered.push(e);
				seen.add(id);
			}
		}
		for (const e of source) {
			if (!seen.has(e.book.id)) {
				ordered.push(e);
				seen.add(e.book.id);
			}
		}
		return ordered;
	});

	let detailEntry = $derived.by((): RatedEntry | null => {
		if (!detailBookId) return null;
		const fromList = drawerOrderedEntries.find((e) => e.book.id === detailBookId);
		if (fromList) return fromList;
		const book =
			detailBookSnapshot?.id === detailBookId
				? detailBookSnapshot
				: (resolveBook?.(detailBookId) ?? null);
		if (!book) return null;
		const r = $ratingsStore.get(detailBookId);
		return { book, rating: r ?? RATING_PLACEHOLDER };
	});

	let detailTitleId = $derived(
		detailEntry ? `ratings-drawer-detail-title-${detailEntry.book.id}` : 'ratings-drawer-title'
	);

	let detailDisplaySummary = $derived(
		detailEntry ? getBookDisplaySummary(detailEntry.book) : ''
	);

	let detailShowCoverImage = $derived(
		detailEntry
			? Boolean(detailEntry.book.coverUrl) && !coverFailedIds.has(detailEntry.book.id)
			: false
	);

	let detailRatingFromStore = $derived(
		detailEntry ? $ratingsStore.get(detailEntry.book.id) : undefined
	);

	let detailDisplayRating = $derived(
		hoverDetailRating > 0 ? hoverDetailRating : (detailRatingFromStore ?? 0)
	);

	let detailBookmarked = $derived(
		detailEntry ? $planToReadStore.has(detailEntry.book.id) : false
	);

	let detailNotInterested = $derived(
		detailEntry ? $notInterestedStore.has(detailEntry.book.book_id ?? 0) : false
	);

	let detailShowAuthorSearchPill = $derived(
		Boolean(detailEntry?.book.author?.trim()) &&
			Boolean(summaryHooks?.onSearchAuthor || browser)
	);

	function openDrawer() {
		flyX = drawerSlidePx();
		activeShelfTab = 'rated';
		drawerOrderIds = ratedEntries.map((e) => e.book.id);
		detailBookId = null;
		detailBookSnapshot = null;
		detailFocusReturnEl = null;
		hoverDetailRating = 0;
		open = true;
	}

	function selectShelfTab(id: ShelfFilterId) {
		activeShelfTab = id;
		detailBookId = null;
		detailBookSnapshot = null;
		detailFocusReturnEl = null;
		hoverDetailRating = 0;
		clearAllPendingRemovals();
		const nextSource =
			id === 'rated' ? ratedEntries : id === 'bookmarked' ? bookmarkedShelfEntries : niShelfEntries;
		drawerOrderIds = nextSource.map((e) => e.book.id);
	}

	function clearPendingRemove(bookId: string) {
		const tid = pendingRemoveTimers.get(bookId);
		if (tid != null) {
			clearTimeout(tid);
			pendingRemoveTimers.delete(bookId);
		}
		if (pendingRemoveIds.has(bookId)) {
			pendingRemoveIds = new Set([...pendingRemoveIds].filter((id) => id !== bookId));
		}
		if (pendingRemoveEndByBookId.has(bookId)) {
			const next = new Map(pendingRemoveEndByBookId);
			next.delete(bookId);
			pendingRemoveEndByBookId = next;
		}
	}

	function clearAllPendingRemovals() {
		for (const tid of pendingRemoveTimers.values()) clearTimeout(tid);
		pendingRemoveTimers.clear();
		pendingRemoveIds = new Set();
		pendingRemoveEndByBookId = new Map();
	}

	function schedulePendingRemove(book: Book) {
		const bookId = book.id;
		const bookIdNum = book.book_id;
		clearPendingRemove(bookId);
		pendingRemoveIds = new Set(pendingRemoveIds).add(bookId);
		const endsAt = Date.now() + PENDING_REMOVE_MS;
		pendingRemoveEndByBookId = new Map(pendingRemoveEndByBookId).set(bookId, endsAt);
		const tid = setTimeout(() => {
			pendingRemoveTimers.delete(bookId);
			pendingRemoveIds = new Set([...pendingRemoveIds].filter((id) => id !== bookId));
			const nextEnds = new Map(pendingRemoveEndByBookId);
			nextEnds.delete(bookId);
			pendingRemoveEndByBookId = nextEnds;
			ratingsStore.removeRating(bookId, bookIdNum);
			summaryHooks?.onAfterRate?.(book);
		}, PENDING_REMOVE_MS);
		pendingRemoveTimers.set(bookId, tid);
	}

	$effect(() => {
		if (pendingRemoveIds.size === 0) return;
		const id = setInterval(() => {
			removalUiClock = Date.now();
		}, 80);
		return () => clearInterval(id);
	});

	function pendingRemoveFillRatio(bookId: string): number {
		const end = pendingRemoveEndByBookId.get(bookId);
		const msLeft = end != null ? Math.max(0, end - removalUiClock) : 0;
		return Math.max(0, Math.min(1, msLeft / PENDING_REMOVE_MS));
	}

	function closeDrawer() {
		open = false;
		drawerOrderIds = null;
		detailBookId = null;
		detailBookSnapshot = null;
		detailFocusReturnEl = null;
		hoverDetailRating = 0;
		activeShelfTab = 'rated';
	}

	function openDetail(bookId: string, returnTarget: HTMLElement) {
		detailFocusReturnEl = returnTarget;
		detailBookId = bookId;
		hoverDetailRating = 0;
		const entry = drawerOrderedEntries.find((e) => e.book.id === bookId);
		detailBookSnapshot = entry?.book ?? resolveBook?.(bookId) ?? null;
	}

	function closeDetail() {
		const el = detailFocusReturnEl;
		detailBookId = null;
		detailBookSnapshot = null;
		detailFocusReturnEl = null;
		hoverDetailRating = 0;
		tick().then(() => el?.focus());
	}

	function handleDrawerAuthorPillClick(e: MouseEvent) {
		if (!detailEntry) return;
		e.preventDefault();
		e.stopPropagation();
		const author = detailEntry.book.author.trim();
		if (summaryHooks?.onSearchAuthor) {
			summaryHooks.onSearchAuthor(detailEntry.book.author);
		} else if (browser) {
			markRateSearchOpenedFromOtherRoute();
			void goto(resolve(`/rate?q=${encodeURIComponent(author)}`));
		}
		closeDrawer();
	}

	function detailStarMouseEnter(value: RatingValue) {
		if (!detailEntry || !starHoverPreviewSupported()) return;
		hoverDetailRating = value;
	}

	function detailStarClick(value: RatingValue) {
		if (!detailEntry) return;
		hoverDetailRating = 0;
		const book = detailEntry.book;
		clearPendingRemove(book.id);
		const r = detailRatingFromStore;
		if (r === value) {
			ratingsStore.removeRating(book.id, book.book_id);
		} else {
			ratingsStore.setRating(book.id, value, book.book_id, book);
		}
		summaryHooks?.onAfterRate?.(book);
	}

	function detailSheetRemoveRating(e: MouseEvent) {
		if (!detailEntry) return;
		e.stopPropagation();
		hoverDetailRating = 0;
		const book = detailEntry.book;
		clearPendingRemove(book.id);
		ratingsStore.removeRating(book.id, book.book_id);
		summaryHooks?.onAfterRate?.(book);
	}

	function detailBookmarkClick(e: MouseEvent) {
		if (!detailEntry) return;
		e.stopPropagation();
		summaryHooks?.onBookmark?.(detailEntry.book);
	}

	function detailNotInterestedClick(e: MouseEvent) {
		if (!detailEntry) return;
		e.stopPropagation();
		summaryHooks?.onNotInterested?.(detailEntry.book);
	}

	function detailStarAriaLabel(value: RatingValue): string {
		const r = detailRatingFromStore;
		return r === value
			? t('shared.bookCard.rateOutOf5Clear', { value })
			: t('shared.bookCard.rateOutOf5', { value });
	}

	function detailStarAriaPressed(value: RatingValue): boolean {
		return detailRatingFromStore === value;
	}

	onDestroy(() => {
		clearAllPendingRemovals();
	});

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) closeDrawer();
	}

	function handleOverlayKeydown(e: KeyboardEvent) {
		if (e.target !== e.currentTarget) return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			closeDrawer();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (detailBookId) {
			e.preventDefault();
			closeDetail();
		} else {
			closeDrawer();
		}
	}

	function retryPendingRatings() {
		void ratingsStore.retryPending();
	}

	function starHoverPreviewSupported(): boolean {
		if (typeof window === 'undefined') return false;
		return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
	}

	function drawerStarMouseEnter(bookId: string, value: RatingValue) {
		if (!starHoverPreviewSupported()) return;
		hoverEntryId = bookId;
		hoverRating = value;
	}

	$effect(() => {
		if (!open) {
			drawerHadOpen = false;
			return;
		}
		const becameOpen = !drawerHadOpen;
		drawerHadOpen = true;
		if (becameOpen && !detailBookId) {
			tick().then(() => closeButtonEl?.focus());
		}
	});

	$effect(() => {
		if (!open || !detailBookId) return;
		tick().then(() => drawerBackButtonEl?.focus());
	});

	$effect(() => {
		if (open) {
			const prev = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = prev;
			};
		}
	});
</script>

{#snippet ratingsBarTriggerIcon()}
	<LibraryBig size={14} aria-hidden="true" />
{/snippet}

<svelte:window onkeydown={handleKeydown} />

<!-- Direct child of bottom bar (pointer-events); same Button variant as recommendations CTA -->
<Button
	variant="primary"
	pill
	class="ratings-bar__trigger"
	id={triggerId}
	type="button"
	aria-expanded={open}
	aria-controls={panelId}
	aria-haspopup="dialog"
	aria-label={triggerAriaLabel}
	icon={ratingsBarTriggerIcon}
	onclick={openDrawer}
>
	<span class="ratings-bar__count" aria-hidden="true">{triggerBadgeCount}</span>
</Button>

{#if open}
		<div
			use:portal
			id={panelId}
			class="ratings-drawer-overlay"
			role="dialog"
			aria-modal="true"
			aria-labelledby={detailEntry ? `${detailTitleId}-sheet` : 'ratings-drawer-title'}
			tabindex="-1"
			onclick={handleOverlayClick}
			onkeydown={handleOverlayKeydown}
		>
			<div
				class="ratings-drawer-panel"
				in:fly={{ x: flyX, duration: 200 }}
				out:fly={{ x: flyX, duration: 150 }}
			>
				<button
					bind:this={closeButtonEl}
					type="button"
					class="ratings-drawer__close"
					aria-label={t('shared.ratingsBar.close')}
					onclick={closeDrawer}
				>
					<X size={18} aria-hidden="true" />
				</button>
				<div class="ratings-drawer__header" class:ratings-drawer__header--detail={detailEntry != null}>
					{#if detailEntry}
						<button
							bind:this={drawerBackButtonEl}
							type="button"
							class="chrome-nav-link ratings-drawer__back"
							aria-label={t('shared.ratingsBar.backToRatings')}
							onclick={closeDetail}
						>
							<ArrowLeft size={18} aria-hidden="true" />
							<span class="ratings-drawer__back-label">{t('shared.ratingsBar.backToRatings')}</span>
						</button>
					{:else}
						<h2 id="ratings-drawer-title" class="ratings-drawer__title typ-h3">
							{t('shared.ratingsBar.yourRatings')}
						</h2>
					{/if}
					{#if drawerSyncState}
						<div
							class="ratings-drawer__header-sync"
							class:ratings-drawer__header-sync--failed={drawerSyncState === 'failed'}
						>
							<div class="ratings-drawer__sync-status">
								<span
									class="ratings-drawer__sync-indicator"
									class:ratings-drawer__sync-indicator--pending={drawerSyncState === 'pending'}
									class:ratings-drawer__sync-indicator--failed={drawerSyncState === 'failed'}
									aria-hidden="true"
								>
									{#if drawerSyncState === 'failed'}!{/if}
								</span>
								<span class="ratings-drawer__sync-text">{drawerSyncText}</span>
							</div>
							{#if drawerSyncState === 'failed'}
								<Button variant="tertiary" compact type="button" onclick={retryPendingRatings}>
									{t('shared.ratingsBar.syncRatings')}
								</Button>
							{/if}
						</div>
					{/if}
				</div>
				<div
					class="ratings-drawer__body scrollbar-subtle"
					class:ratings-drawer__body--detail={detailEntry != null}
					class:ratings-drawer__body--shelf-tabs={shelfTabsEnabled && detailEntry == null}
				>
					{#if detailEntry}
						<BookSummarySheetBody
							book={detailEntry.book}
							summaryTitleId={`${detailTitleId}-sheet`}
							displaySummary={detailDisplaySummary}
							showCoverImage={detailShowCoverImage}
							onCoverImageError={() => setCoverFailed(detailEntry.book.id)}
							showAuthorInSheetMeta={Boolean(detailEntry.book.author?.trim())}
							showSearchAuthorInOverlay={detailShowAuthorSearchPill}
							onAuthorPillClick={detailShowAuthorSearchPill ? handleDrawerAuthorPillClick : undefined}
							notInterested={detailNotInterested}
							ratingGroupAriaLabel={t('shared.bookCard.rateThisBook')}
							displayRating={detailDisplayRating}
							starAriaLabel={detailStarAriaLabel}
							starAriaPressed={detailStarAriaPressed}
							onStarMouseEnter={detailStarMouseEnter}
							onStarClick={detailStarClick}
							onRatingGroupMouseLeave={() => (hoverDetailRating = 0)}
							canRemoveRatingInSheet={detailRatingFromStore != null}
							onRemoveRatingClick={detailSheetRemoveRating}
							showBookmarkAction={Boolean(summaryHooks?.onBookmark)}
							showNotInterestedAction={Boolean(summaryHooks?.onNotInterested)}
							bookmarked={detailBookmarked}
							onBookmarkClick={detailBookmarkClick}
							onNotInterestedClick={detailNotInterestedClick}
						/>
					{:else if !shelfTabsEnabled && drawerOrderedEntries.length === 0}
						<p class="ratings-drawer__empty">
							{t('shared.ratingsBar.empty')}
						</p>
					{:else}
						{#if shelfTabsEnabled}
							<div class="ratings-drawer__shelf-tabs-wrap">
								<NavStyleTabList
									ariaLabel={t('rated.tabs.ariaLabel')}
									panelId={shelfListPanelId}
									idPrefix={shelfTabIdPrefix}
									items={shelfTabItems}
									selectedId={activeShelfTab}
									countsReady={true}
									getCount={(id) => countForShelfTab(id as ShelfFilterId)}
									onSelect={(id) => selectShelfTab(id as ShelfFilterId)}
									scrollSingleRow={true}
								/>
							</div>
						{/if}
						{#if shelfTabsEnabled}
							<div
								id={shelfListPanelId}
								class="ratings-drawer__shelf-scroll scrollbar-subtle"
								role="tabpanel"
								aria-labelledby={`${shelfTabIdPrefix}-${activeShelfTab}`}
							>
								{#if drawerOrderedEntries.length === 0}
									<p class="ratings-drawer__empty">{shelfEmptyMessage}</p>
								{:else}
									<ul class="ratings-drawer__list">
										{#each drawerOrderedEntries as entry (entry.book.id)}
											{@const storedRating = $ratingsStore.get(entry.book.id)}
											<li
												class="ratings-drawer__item"
												class:ratings-drawer__item--pending-remove={pendingRemoveIds.has(entry.book.id)}
											>
												<div class="ratings-drawer__item-main">
													<div class="ratings-drawer__item-cover">
														<button
															type="button"
															class="ratings-drawer__item-cover-hit"
															aria-label={seeSummaryOpenAriaLabel(entry.book)}
															onclick={(e) => openDetail(entry.book.id, e.currentTarget)}
														>
															{#if entry.book.coverUrl && !coverFailedIds.has(entry.book.id)}
																<img
																	src={entry.book.coverUrl}
																	alt=""
																	class="ratings-drawer__cover-img"
																	onerror={() => setCoverFailed(entry.book.id)}
																/>
															{:else}
																<div class="ratings-drawer__cover-placeholder">
																	<span class="ratings-drawer__cover-text">{entry.book.title}</span>
																</div>
															{/if}
														</button>
													</div>
													<div class="ratings-drawer__item-info">
														<button
															type="button"
															class="ratings-drawer__item-title-hit"
															aria-label={seeSummaryOpenAriaLabel(entry.book)}
															onclick={(e) => openDetail(entry.book.id, e.currentTarget)}
														>
															<span class="ratings-drawer__item-title">{entry.book.title}</span>
														</button>
														{#if entry.book.author?.trim()}
															<button
																type="button"
																class="ratings-drawer__item-author ratings-drawer__item-author-hit"
																aria-label={seeSummaryOpenAriaLabel(entry.book)}
																onclick={(e) => openDetail(entry.book.id, e.currentTarget)}
															>
																{entry.book.author}
															</button>
														{/if}
														<div
															class="ratings-drawer__item-actions"
															onmouseleave={() => {
																hoverEntryId = null;
																hoverRating = 0;
															}}
														>
															<BookRatingStarsRow
																ratingWrapWidth="auto"
																displayRating={pendingRemoveIds.has(entry.book.id)
																	? hoverEntryId === entry.book.id && hoverRating > 0
																		? hoverRating
																		: 0
																	: hoverEntryId === entry.book.id && hoverRating > 0
																		? hoverRating
																		: (storedRating ?? 0)}
																ariaGroupLabel={t('shared.bookCard.rateThisBook')}
																starAriaLabel={(value) =>
																	storedRating === value
																		? t('shared.bookCard.rateOutOf5Clear', { value })
																		: t('shared.bookCard.rateOutOf5', { value })}
																starAriaPressed={(value) =>
																	pendingRemoveIds.has(entry.book.id)
																		? false
																		: storedRating === value}
																onmouseleave={() => {
																	hoverEntryId = null;
																	hoverRating = 0;
																}}
																onstarEnter={(value) => drawerStarMouseEnter(entry.book.id, value)}
																onstarClick={(value) => {
																	hoverEntryId = null;
																	hoverRating = 0;
																	const bookId = entry.book.id;
																	const bookIdNum = entry.book.book_id;
																	if (pendingRemoveIds.has(bookId)) {
																		if (value === storedRating) {
																			clearPendingRemove(bookId);
																			return;
																		}
																		clearPendingRemove(bookId);
																		ratingsStore.setRating(bookId, value, bookIdNum, entry.book);
																		summaryHooks?.onAfterRate?.(entry.book);
																		return;
																	}
																	if (storedRating != null && value === storedRating) {
																		schedulePendingRemove(entry.book);
																		return;
																	}
																	ratingsStore.setRating(bookId, value, bookIdNum, entry.book);
																	summaryHooks?.onAfterRate?.(entry.book);
																}}
															/>
															{#if pendingRemoveIds.has(entry.book.id)}
																<Button
																	variant="tertiary"
																	compact
																	type="button"
																	aria-label={`${t('shared.ratingsBar.undoRemoveRatingFor', { title: entry.book.title })}. ${t('shared.ratingsBar.removePendingHint')}`}
																	onclick={() => clearPendingRemove(entry.book.id)}
																>
																	{t('shared.ratingsBar.undo')}
																</Button>
															{:else}
																<Button
																	variant="tertiary"
																	compact
																	type="button"
																	aria-label={t('shared.ratingsBar.removeRatingFor', { title: entry.book.title })}
																	onclick={() => schedulePendingRemove(entry.book)}
																>
																	{t('shared.ratingsBar.remove')}
																</Button>
															{/if}
														</div>
													</div>
												</div>
												{#if pendingRemoveIds.has(entry.book.id)}
													{@const fillRatio = pendingRemoveFillRatio(entry.book.id)}
													{@const removeProgressPct = Math.round((1 - fillRatio) * 100)}
													<div class="ratings-drawer__pending-remove-meter">
														<div
															class="ratings-drawer__pending-remove-meter__track"
															role="progressbar"
															aria-valuemin={0}
															aria-valuemax={100}
															aria-valuenow={removeProgressPct}
															aria-label={t('shared.ratingsBar.removeProgressBarLabel')}
														>
															<div
																class="ratings-drawer__pending-remove-meter__fill"
																style="width: {fillRatio * 100}%"
															></div>
														</div>
													</div>
												{/if}
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						{:else}
							<ul class="ratings-drawer__list">
								{#each drawerOrderedEntries as entry (entry.book.id)}
									{@const storedRating = $ratingsStore.get(entry.book.id)}
									<li
										class="ratings-drawer__item"
										class:ratings-drawer__item--pending-remove={pendingRemoveIds.has(entry.book.id)}
									>
										<div class="ratings-drawer__item-main">
											<div class="ratings-drawer__item-cover">
												<button
													type="button"
													class="ratings-drawer__item-cover-hit"
													aria-label={seeSummaryOpenAriaLabel(entry.book)}
													onclick={(e) => openDetail(entry.book.id, e.currentTarget)}
												>
													{#if entry.book.coverUrl && !coverFailedIds.has(entry.book.id)}
														<img
															src={entry.book.coverUrl}
															alt=""
															class="ratings-drawer__cover-img"
															onerror={() => setCoverFailed(entry.book.id)}
														/>
													{:else}
														<div class="ratings-drawer__cover-placeholder">
															<span class="ratings-drawer__cover-text">{entry.book.title}</span>
														</div>
													{/if}
												</button>
											</div>
											<div class="ratings-drawer__item-info">
												<button
													type="button"
													class="ratings-drawer__item-title-hit"
													aria-label={seeSummaryOpenAriaLabel(entry.book)}
													onclick={(e) => openDetail(entry.book.id, e.currentTarget)}
												>
													<span class="ratings-drawer__item-title">{entry.book.title}</span>
												</button>
												{#if entry.book.author?.trim()}
													<button
														type="button"
														class="ratings-drawer__item-author ratings-drawer__item-author-hit"
														aria-label={seeSummaryOpenAriaLabel(entry.book)}
														onclick={(e) => openDetail(entry.book.id, e.currentTarget)}
													>
														{entry.book.author}
													</button>
												{/if}
												<div
													class="ratings-drawer__item-actions"
													onmouseleave={() => {
														hoverEntryId = null;
														hoverRating = 0;
													}}
												>
													<BookRatingStarsRow
														ratingWrapWidth="auto"
														displayRating={pendingRemoveIds.has(entry.book.id)
															? hoverEntryId === entry.book.id && hoverRating > 0
																? hoverRating
																: 0
															: hoverEntryId === entry.book.id && hoverRating > 0
																? hoverRating
																: (storedRating ?? 0)}
														ariaGroupLabel={t('shared.bookCard.rateThisBook')}
														starAriaLabel={(value) =>
															storedRating === value
																? t('shared.bookCard.rateOutOf5Clear', { value })
																: t('shared.bookCard.rateOutOf5', { value })}
														starAriaPressed={(value) =>
															pendingRemoveIds.has(entry.book.id) ? false : storedRating === value}
														onmouseleave={() => {
															hoverEntryId = null;
															hoverRating = 0;
														}}
														onstarEnter={(value) => drawerStarMouseEnter(entry.book.id, value)}
														onstarClick={(value) => {
															hoverEntryId = null;
															hoverRating = 0;
															const bookId = entry.book.id;
															const bookIdNum = entry.book.book_id;
															if (pendingRemoveIds.has(bookId)) {
																if (value === storedRating) {
																	clearPendingRemove(bookId);
																	return;
																}
																clearPendingRemove(bookId);
																ratingsStore.setRating(bookId, value, bookIdNum, entry.book);
																summaryHooks?.onAfterRate?.(entry.book);
																return;
															}
															if (storedRating != null && value === storedRating) {
																schedulePendingRemove(entry.book);
																return;
															}
															ratingsStore.setRating(bookId, value, bookIdNum, entry.book);
															summaryHooks?.onAfterRate?.(entry.book);
														}}
													/>
													{#if pendingRemoveIds.has(entry.book.id)}
														<Button
															variant="tertiary"
															compact
															type="button"
															aria-label={`${t('shared.ratingsBar.undoRemoveRatingFor', { title: entry.book.title })}. ${t('shared.ratingsBar.removePendingHint')}`}
															onclick={() => clearPendingRemove(entry.book.id)}
														>
															{t('shared.ratingsBar.undo')}
														</Button>
													{:else}
														<Button
															variant="tertiary"
															compact
															type="button"
															aria-label={t('shared.ratingsBar.removeRatingFor', { title: entry.book.title })}
															onclick={() => schedulePendingRemove(entry.book)}
														>
															{t('shared.ratingsBar.remove')}
														</Button>
													{/if}
												</div>
											</div>
										</div>
										{#if pendingRemoveIds.has(entry.book.id)}
											{@const fillRatio = pendingRemoveFillRatio(entry.book.id)}
											{@const removeProgressPct = Math.round((1 - fillRatio) * 100)}
											<div class="ratings-drawer__pending-remove-meter">
												<div
													class="ratings-drawer__pending-remove-meter__track"
													role="progressbar"
													aria-valuemin={0}
													aria-valuemax={100}
													aria-valuenow={removeProgressPct}
													aria-label={t('shared.ratingsBar.removeProgressBarLabel')}
												>
													<div
														class="ratings-drawer__pending-remove-meter__fill"
														style="width: {fillRatio * 100}%"
													></div>
												</div>
											</div>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					{/if}
				</div>
		</div>
	</div>
{/if}

<style>
	/* Layout + label row; colors from Button (primary pill, same as rate page CTA) */
	:global(.ratings-bar__trigger.btn) {
		flex: 0 0 auto;
		pointer-events: auto;
		gap: var(--space-1);
	}
	:global(.ratings-bar__trigger .btn__label) {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}
	.ratings-bar__count {
		line-height: 1;
		font-variant-numeric: tabular-nums;
		color: inherit;
	}
	@keyframes ratings-bar-sync-pulse {
		0%, 100% {
			opacity: 0.55;
			transform: scale(0.92);
		}
		50% {
			opacity: 1;
			transform: scale(1);
		}
	}

	.ratings-drawer-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: var(--color-overlay-scrim-soft);
		display: flex;
		align-items: stretch;
		justify-content: flex-start;
	}

	.ratings-drawer-panel {
		position: relative;
		z-index: 1;
		width: min(400px, 85vw);
		min-width: 320px;
		max-width: 400px;
		height: 100%;
		background: var(--color-card-bg);
		box-shadow: var(--shadow-drawer);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	@media (min-width: 768px) {
		.ratings-drawer-panel {
			width: min(440px, 92vw);
			min-width: 400px;
			max-width: 440px;
		}
	}

	@media (max-width: 767px) {
		.ratings-drawer-overlay {
			background: var(--color-bg);
		}
		.ratings-drawer-panel {
			width: 100%;
			max-width: none;
			min-width: 0;
			min-height: 100dvh;
			height: 100dvh;
			box-shadow: none;
		}
	}

	.ratings-drawer__close {
		position: absolute;
		top: calc(var(--space-2) + env(safe-area-inset-top, 0px));
		right: calc(var(--space-2) + env(safe-area-inset-right, 0px));
		z-index: 11;
		width: var(--min-tap);
		height: var(--min-tap);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: none;
		background: transparent;
		border-radius: var(--radius-pill);
		cursor: pointer;
		color: var(--color-text);
		transition: background var(--duration-fast) var(--ease-default);
	}
	.ratings-drawer__close:hover {
		background: var(--color-floating-control-bg);
	}
	.ratings-drawer__close:hover:active {
		background: var(--color-floating-control-bg-hover);
	}
	.ratings-drawer__close:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.ratings-drawer__header {
		/* Match list (typ-h3 title) and detail (back) so header height does not jump between views */
		--ratings-drawer-header-min-block: calc(
			var(--space-4) * 2 + var(--typ-h3-font-size) * var(--typ-h3-line-height)
		);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-5);
		padding-right: calc(var(--space-2) + var(--min-tap) + var(--space-3));
		flex-shrink: 0;
		box-sizing: border-box;
		min-height: var(--ratings-drawer-header-min-block);
	}
	.ratings-drawer__title {
		margin: 0;
		min-width: 0;
		flex: 1 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ratings-drawer__header-sync {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		flex: 0 1 auto;
		max-width: min(20rem, 68%);
		box-sizing: border-box;
		min-width: 0;
	}
	.ratings-drawer__header-sync .ratings-drawer__sync-status {
		flex: 1 1 auto;
		min-width: 0;
	}
	.ratings-drawer__header-sync .ratings-drawer__sync-text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ratings-drawer__body {
		overflow-y: auto;
		padding: var(--space-4) var(--space-5);
		flex: 1;
		min-height: 0;
	}
	.ratings-drawer__body--detail {
		padding: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.ratings-drawer__body--shelf-tabs {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		padding: 0;
	}
	.ratings-drawer__shelf-tabs-wrap {
		flex-shrink: 0;
		min-width: 0;
		width: 100%;
		padding: var(--space-2) var(--space-5) var(--space-2);
	}
	.ratings-drawer__shelf-scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 var(--space-5) var(--space-4);
	}
	.ratings-drawer__header.ratings-drawer__header--detail {
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: var(--space-3);
	}
	.ratings-drawer__back {
		gap: var(--space-2);
		align-self: flex-start;
	}
	.ratings-drawer__back-label {
		min-width: 0;
	}
	.ratings-drawer__item-cover-hit {
		display: block;
		width: 100%;
		height: 100%;
		padding: 0;
		margin: 0;
		border: none;
		background: transparent;
		border-radius: inherit;
		cursor: pointer;
		text-align: left;
	}
	.ratings-drawer__item-cover-hit:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.ratings-drawer__item-title-hit {
		display: block;
		width: 100%;
		padding: 0;
		margin: 0;
		border: none;
		background: transparent;
		font: inherit;
		text-align: left;
		color: inherit;
		cursor: pointer;
	}
	.ratings-drawer__item-title-hit:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.ratings-drawer__empty {
		margin: 0;
		color: var(--color-text-muted);
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--typ-caption-font-weight);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
	}
	.ratings-drawer__sync-status {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}
	.ratings-drawer__sync-indicator {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 999px;
	}
	.ratings-drawer__sync-indicator--pending {
		background: color-mix(in srgb, var(--color-book-rating-star) 72%, var(--color-bg));
		animation: ratings-bar-sync-pulse 1.4s ease-in-out infinite;
	}
	.ratings-drawer__sync-indicator--failed {
		background: var(--color-danger-tonal-bg);
		border: 1px solid var(--color-danger-tonal-border);
		color: var(--color-danger-tonal-text);
		font-family: var(--typ-caption-font-family);
		font-size: 0.625rem;
		font-weight: var(--font-weight-semibold);
		line-height: 1;
	}
	.ratings-drawer__sync-text {
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text);
	}
	.ratings-drawer__header-sync--failed .ratings-drawer__sync-text {
		color: var(--color-danger-tonal-text);
	}
	.ratings-drawer__list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.ratings-drawer__item {
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--color-border);
	}
	.ratings-drawer__item--pending-remove {
		position: relative;
		opacity: 0.88;
	}
	/* Progress line sits on the row’s bottom edge; no extra vertical space in normal flow. */
	.ratings-drawer__pending-remove-meter {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 3px;
		margin: 0;
		padding: 0;
		pointer-events: none;
	}
	.ratings-drawer__pending-remove-meter__track {
		width: 100%;
		height: 100%;
		border-radius: var(--radius-pill);
		background: var(--color-border);
		overflow: hidden;
	}
	.ratings-drawer__pending-remove-meter__fill {
		height: 100%;
		border-radius: inherit;
		background: color-mix(in srgb, var(--color-text-muted) 85%, var(--color-text));
		transition: width 80ms linear;
	}
	.ratings-drawer__item:last-child {
		border-bottom: none;
	}
	.ratings-drawer__item-main {
		display: flex;
		gap: var(--space-3);
		align-items: flex-start;
	}
	.ratings-drawer__item-cover {
		flex-shrink: 0;
		width: 3.5rem;
		aspect-ratio: 2 / 3;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--color-card-placeholder-bg);
	}
	.ratings-drawer__cover-img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.ratings-drawer__cover-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-1);
		text-align: center;
	}
	.ratings-drawer__cover-text {
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--typ-caption-font-weight);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
		color: var(--color-book-title);
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
	}
	.ratings-drawer__item-info {
		flex: 1;
		min-width: 0;
	}
	.ratings-drawer__item-title {
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--font-weight-semibold);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
		color: var(--color-book-title);
		display: block;
	}
	.ratings-drawer__item-author {
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--typ-caption-font-weight);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
		color: var(--color-text-muted);
		display: block;
		margin-top: var(--space-1);
	}
	button.ratings-drawer__item-author-hit {
		display: block;
		width: 100%;
		padding: 0;
		margin: 0;
		margin-top: var(--space-1);
		border: none;
		background: transparent;
		text-align: left;
		cursor: pointer;
		appearance: none;
	}
	button.ratings-drawer__item-author-hit:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.ratings-drawer__item-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
		margin-top: var(--space-2);
	}
	/* Button is a child component — :global so compact height aligns with book-card star row */
	.ratings-drawer__item-actions :global(.btn.btn--compact) {
		box-sizing: border-box;
		min-height: var(--book-card-star-min, 2.25rem);
		height: var(--book-card-star-min, 2.25rem);
		padding-block: 0;
		padding-inline: var(--space-4);
	}
	@media (max-width: 479px) {
		.ratings-drawer__item-actions :global(.btn.btn--compact) {
			min-height: var(--book-card-star-min-sm, 1.75rem);
			height: var(--book-card-star-min-sm, 1.75rem);
		}
	}
	.ratings-drawer__header-sync :global(.btn.btn--compact) {
		box-sizing: border-box;
		flex-shrink: 0;
		min-height: 32px;
		height: 32px;
		padding-block: 0;
		padding-inline: var(--space-3);
	}
</style>
