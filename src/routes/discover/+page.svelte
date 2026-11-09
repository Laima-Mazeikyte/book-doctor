<script lang="ts">
	import { withTimeout, RequestTimeoutError } from '$lib/requests/timeout';
	import LibraryLoadNotice from '$lib/components/LibraryLoadNotice.svelte';
	import { isUserLibraryIdsReady, userLibraryHydrationStore } from '$lib/stores/userLibrary';
	import { browser } from '$app/environment';
	import { goto, pushState, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { navigating, page } from '$app/state';
	import { onDestroy, tick } from 'svelte';
	import { fly } from 'svelte/transition';
	import '$lib/components/recommendations/filter-controls.css';
	import Button from '$lib/components/Button.svelte';
	import ModalDialog from '$lib/components/ModalDialog.svelte';
	import RecommendationFilterFields from '$lib/components/recommendations/RecommendationFilterFields.svelte';
	import { SlidersHorizontal, X } from 'lucide-svelte';
	import { authModalRequestStore } from '$lib/stores/authModalRequest';
	import { get } from 'svelte/store';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookCardGridSkeleton from '$lib/components/BookCardGridSkeleton.svelte';
	import {
		loadStartingBooks,
		loadStartingBookBySlug,
		type StartingBook
	} from '$lib/recommendations/startingBooks';
	import {
		coverPriorityFor,
		estimateGridColumns,
		trackGridColumns
	} from '$lib/components/book-card/coverPriority';
	import {
		buildCleanLikedAuthorSet,
		filterAuthorRelationshipAuthors
	} from '$lib/recommendations/authorRelationships';
	import {
		fetchRecommendations,
		type FetchRecommendationsResult
	} from '$lib/recommendations/fetchRecommendations';
	import {
		buildRecommendationFilters,
		describeFilters,
		draftFromFilters,
		draftFromStartingBookUrl,
		isStartingBookId,
		savedSearchPath,
		emptyFilterDraft,
		isFilteredRequest,
		type FilterDraft
	} from '$lib/recommendations/filteredRecommendations';
	import { filterRatedLikedBookPrecedents } from '$lib/recommendations/likedBookPrecedents';
	import { getSupabase } from '$lib/supabase';
	import { authInitStore, authStore } from '$lib/stores/auth';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { ratingsStore } from '$lib/stores/ratings';
	import { librarySaves } from '$lib/stores/librarySaves';
	import { t } from '$lib/copy';
	import { refreshRecommendationsCountFromApi } from '$lib/stores/recommendationsCount';
	import type { Book, RatingValue } from '$lib/types/book';

	import { isPublicRequestId, requestIdColumn } from '$lib/requests/publicId';

	type RequestStatus = 'pending' | 'processing' | 'completed' | 'failed' | null;
	type RequestRow = {
		public_id: string;
		filters: unknown;
		status: RequestStatus;
		result_count: number | null;
		error_code: string | null;
		created_at: string | null;
	};
	type ViewState =
		| 'idle'
		| 'loading'
		| 'slow'
		| 'paused'
		| 'ready'
		| 'empty'
		| 'failed'
		| 'legacy'
		| 'unavailable'
		| 'error';

	const MIN_RATINGS = 10;
	const POLL_MS = 2000;
	const SLOW_AFTER_MS = 30_000;
	const PAUSE_AFTER_MS = 120_000;
	let draft = $state<FilterDraft>(emptyFilterDraft());
	let seedTitles = $state<Record<string, string>>({});
	let resolvedStartingBook = $state<StartingBook | null>(null);
	let startingBookLoadError = $state('');
	let startingBookBlocked = $state(false);
	let startingBookController: AbortController | null = null;
	let submittedFilters = $state<unknown>(null);
	let request = $state<RequestRow | null>(null);
	let recent = $state<RequestRow[]>([]);
	let recentLoading = $state(false);
	let recentError = $state('');
	let recentLoadId = 0;
	let result = $state<FetchRecommendationsResult | null>(null);
	let viewState = $state<ViewState>('idle');
	let message = $state('');
	let formError = $state('');
	let submitting = $state(false);
	let submissionUncertain = $state(false);
	let pollController: AbortController | null = null;
	let formVersion = $state(0);
	let gridColumns = $state(estimateGridColumns());
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	const historyLayer = $derived(
		page.state.filteredRecommendationDialog?.url === page.url.href &&
			page.state.filteredRecommendationDialog.layer !== 'closed'
			? page.state.filteredRecommendationDialog.layer
			: null
	);
	const editorOpen = $derived(historyLayer !== null);
	let closingLayer = false;
	let focusResultsOnClose = false;
	let focusRecentOnClose = false;
	let recentHeading = $state<HTMLHeadingElement>();
	let unavailableSeedId = $state('');
	let draftReady = $state(false);
	let resultsHeading: HTMLHeadingElement;
	let filterTrigger = $state<HTMLElement | null>(null);
	let loadGeneration = 0;
	let activeKey = '';
	let activeUserId: string | null = null;
	let activeRouteKey = '';
	let waitStartedAt = 0;

	const ratedBooksStore = ratingsStore.ratedBooks;
	const canRequest = $derived(
		isUserLibraryIdsReady($authStore.user?.id, $userLibraryHydrationStore) &&
			$librarySaves.queuedCount === 0 &&
			!$librarySaves.isFlushing &&
			!!$authStore.user
	);
	const canSubmit = $derived(
		canRequest &&
			!startingBookBlocked &&
			(draft.seedBookId
				? isStartingBookId(draft.seedBookId) && draft.seedBookId !== unavailableSeedId
				: $ratingsStore.size >= MIN_RATINGS)
	);
	const appliedSeed = $derived(draftFromFilters(submittedFilters).seedBookId);
	const sourceOnlyRun = $derived(
		!!appliedSeed &&
			isFilteredRequest(submittedFilters) &&
			Object.keys(submittedFilters).length === 1
	);
	const cleanLikedAuthors = $derived(buildCleanLikedAuthorSet($ratedBooksStore));
	const requestId = $derived(request?.public_id ?? null);
	const requestIsRunning = $derived(viewState === 'loading' || viewState === 'slow');
	const hasUnappliedChanges = $derived(
		draftReady &&
			!!request &&
			filterFingerprint(draft) !== filterFingerprint(draftFromFilters(submittedFilters))
	);

	function filterFingerprint(value: FilterDraft): string {
		try {
			// Selection order does not change matching; compare the effective filter payload.
			return JSON.stringify(buildRecommendationFilters(value), (_key, item) => {
				if (Array.isArray(item)) return [...item].sort();
				if (item && typeof item === 'object')
					return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
				return item;
			});
		} catch {
			return JSON.stringify(value);
		}
	}

	function openEditor() {
		focusResultsOnClose = false;
		focusRecentOnClose = false;
		if (!editorOpen) openLayer('filters');
	}

	function openLayer(layer: 'filters' | 'genres' | 'keywords') {
		const url = `${resolve('/discover')}${page.url.search}${page.url.hash}`;
		if (layer === 'filters' && !historyLayer) {
			// Mark the base entry so returning to a new-search URL does not open and push again.
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- preserve query/hash in shallow routing
			replaceState(url, {
				...page.state,
				filteredRecommendationDialog: { url: page.url.href, layer: 'closed' }
			});
		}
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- preserve query/hash in shallow routing
		pushState(url, {
			...page.state,
			filteredRecommendationDialog: { url: page.url.href, layer }
		});
	}

	function closeLayer() {
		if (!historyLayer || closingLayer) return;
		closingLayer = true;
		history.back();
	}

	$effect(() => {
		void historyLayer;
		closingLayer = false;
	});

	function onSeedAvailabilityChange(bookId: string, available: boolean) {
		if (bookId !== draft.seedBookId) return;
		if (!available) unavailableSeedId = bookId;
		else if (unavailableSeedId === bookId) unavailableSeedId = '';
	}

	function slideFilterPanel(node: HTMLElement, { duration }: { duration: number }) {
		// Measure after the native dialog has opened and the panel has a layout box.
		return () =>
			fly(node, {
				x: -node.getBoundingClientRect().width,
				duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration
			});
	}

	function onEditorClosed() {
		if (!editorOpen) {
			const target = focusRecentOnClose
				? recentHeading
				: focusResultsOnClose
					? resultsHeading
					: null;
			target?.focus({ preventScroll: true });
			target?.scrollIntoView({ block: 'start' });
			focusRecentOnClose = false;
		}
	}

	function clearFilters() {
		draft = emptyFilterDraft();
		formVersion += 1;
		formError = '';
		startingBookLoadError = '';
		startingBookBlocked = false;
	}

	async function initializeStartingBook(url: URL, generation: number) {
		startingBookController?.abort();
		const slug = url.searchParams.get('from');
		startingBookBlocked = !!slug;
		startingBookLoadError = '';
		resolvedStartingBook = null;
		draft = emptyFilterDraft();
		if (!slug) {
			draftReady = true;
			formVersion += 1;
			return;
		}
		const controller = new AbortController();
		startingBookController = controller;
		draftReady = false;
		try {
			const book = await loadStartingBookBySlug(slug, controller.signal);
			if (controller.signal.aborted || generation !== loadGeneration) return;
			resolvedStartingBook = book;
			if (book) {
				startingBookBlocked = false;
				seedTitles[book.book_id] = book.title;
				draft = draftFromStartingBookUrl(url, book.book_id);
			} else {
				formError = 'This starting book is unavailable. Choose another book.';
			}
		} catch {
			if (controller.signal.aborted || generation !== loadGeneration) return;
			startingBookLoadError = 'Could not load the starting book. Try again or choose another.';
		} finally {
			if (!controller.signal.aborted && generation === loadGeneration) {
				draftReady = true;
				formVersion += 1;
			}
		}
	}

	async function useStartingBookOnly() {
		if (
			!canRequest ||
			submissionUncertain ||
			submitting ||
			requestIsRunning ||
			!draftReady ||
			!isStartingBookId(appliedSeed)
		)
			return;
		const next = emptyFilterDraft();
		next.seedBookId = appliedSeed;
		draft = next;
		formVersion += 1;
		await submit();
	}

	async function chooseAnotherStartingBook() {
		draft.seedBookId = '';
		draft.relativeDimensions = {};
		openEditor();
		await tick();
		document.getElementById('starting-book-search')?.focus();
	}

	function clearPoll() {
		pollController?.abort();
		pollController = null;
		if (pollTimer !== null) clearTimeout(pollTimer);
		pollTimer = null;
	}

	function isCurrent(generation: number, id: string, userId: string): boolean {
		return (
			generation === loadGeneration &&
			get(authStore).user?.id === userId &&
			page.url.searchParams.get('search') === id
		);
	}

	async function loadRecent(userId: string, generation: number) {
		const attempt = ++recentLoadId;
		recentLoading = true;
		recentError = '';
		const supabase = getSupabase();
		if (!supabase) {
			recentLoading = false;
			recentError = 'Could not load recent searches. Please try again.';
			return;
		}
		const { data, error } = await withTimeout((signal) =>
			supabase
				.from('recommendation_requests')
				.select('public_id, filters, status, result_count, error_code, created_at')
				.eq('user_id', userId)
				.not('filters', 'is', null)
				.order('created_at', { ascending: false })
				.abortSignal(signal)
				.limit(40)
		).catch(() => ({ data: null, error: new Error('Unable to load recent requests') }));
		if (
			generation !== loadGeneration ||
			get(authStore).user?.id !== userId ||
			attempt !== recentLoadId
		)
			return;
		recentLoading = false;
		if (error) {
			recentError = 'Could not load recent searches. Please try again.';
			return;
		}
		recent = (data ?? [])
			.filter((row) => isFilteredRequest(row.filters))
			.slice(0, 12)
			.map((row) =>
				request && row.public_id === request.public_id ? request : row
			) as RequestRow[];
		const seedIds = recent.flatMap((row) => {
			const seed = draftFromFilters(row.filters).seedBookId;
			return seed && !seedTitles[seed] ? [seed] : [];
		});
		if (seedIds.length) {
			try {
				const books = await loadStartingBooks(seedIds);
				if (
					generation !== loadGeneration ||
					get(authStore).user?.id !== userId ||
					attempt !== recentLoadId
				)
					return;
				for (const book of books) seedTitles[book.book_id] = book.title;
			} catch {
				/* Search history remains usable if public display lookup fails. */
			}
		}
	}

	function refreshRecent() {
		const userId = get(authStore).user?.id;
		if (userId && !recentLoading) void loadRecent(userId, loadGeneration);
	}

	function viewRecentSearches() {
		focusRecentOnClose = true;
		refreshRecent();
		closeLayer();
	}

	async function fetchRunBooks(id: string, userId: string, generation: number) {
		const token = get(authStore).session?.access_token ?? null;
		if (!token) throw new Error('Sign in to load this recommendation run.');
		const payload = await fetchRecommendations(token, id, { includeRated: true });
		if (!isCurrent(generation, id, userId)) return;
		result = payload;
		viewState = payload.books.length ? 'ready' : 'empty';
		void refreshRecommendationsCountFromApi(token);
	}

	async function readRequest(id: string, userId: string, generation: number) {
		const supabase = getSupabase();
		if (!supabase || !isCurrent(generation, id, userId)) return;
		const remaining = PAUSE_AFTER_MS - (Date.now() - waitStartedAt);
		if (remaining <= 0) {
			viewState = 'paused';
			return;
		}
		const controller = (pollController ??= new AbortController());
		const { data, error } = await withTimeout(
			(signal) =>
				supabase
					.from('recommendation_requests')
					.select('public_id, filters, status, result_count, error_code, created_at')
					.eq(requestIdColumn(id), id)
					.eq('user_id', userId)
					.abortSignal(signal)
					.maybeSingle(),
			{ signal: controller.signal, timeoutMs: Math.min(15_000, remaining) }
		).catch((error: unknown) => ({ data: null, error }));
		if (controller.signal.aborted) return;
		if (!isCurrent(generation, id, userId)) return;
		if (error) {
			message = 'Could not check this request. We will try again.';
			if (Date.now() - waitStartedAt < PAUSE_AFTER_MS) {
				pollTimer = setTimeout(
					() => void readRequest(id, userId, generation),
					Math.min(5000, Math.max(0, PAUSE_AFTER_MS - (Date.now() - waitStartedAt)))
				);
			} else {
				viewState = 'paused';
			}
			return;
		}
		if (!data) {
			draftReady = true;
			viewState = 'unavailable';
			message = 'This request is unavailable.';
			return;
		}
		const row = data as RequestRow;
		request = row;
		recent = recent.map((item) => (item.public_id === row.public_id ? row : item));
		submittedFilters = row.filters;
		if (!draftReady) {
			draftReady = true;
			draft = draftFromFilters(row.filters);
			formVersion += 1;
			const seedId = draft.seedBookId;
			if (seedId && !seedTitles[seedId]) {
				void loadStartingBooks([seedId])
					.then((books) => {
						if (!isCurrent(generation, id, userId)) return;
						for (const book of books) seedTitles[book.book_id] = book.title;
					})
					.catch(() => {
						/* The filters remain usable without a display title. */
					});
			}
			const createdAt = row.created_at ? Date.parse(row.created_at) : NaN;
			if (Number.isFinite(createdAt)) waitStartedAt = Math.min(waitStartedAt, createdAt);
		}
		message = '';
		if (row.status === 'completed') {
			clearPoll();
			if (row.result_count === 0) {
				result = null;
				viewState = 'empty';
			} else {
				try {
					await fetchRunBooks(id, userId, generation);
				} catch {
					if (isCurrent(generation, id, userId)) {
						viewState = 'error';
						message = 'The recommendations are ready, but the books could not be loaded.';
					}
				}
			}
			return;
		}
		if (row.status === 'failed') {
			clearPoll();
			viewState = 'failed';
			message =
				row.error_code === 'invalid_filters'
					? isFilteredRequest(row.filters) && row.filters.seed_book_id
						? 'The starting book or filters could not be used. Review your choices and try a new search.'
						: 'These filters could not be used. Edit them and try a new search.'
					: 'We could not finish this request. You can try a new search.';
			return;
		}
		if (row.status === null) {
			clearPoll();
			try {
				await fetchRunBooks(id, userId, generation);
				if (isCurrent(generation, id, userId) && viewState === 'empty') {
					viewState = 'legacy';
					message = 'This older request has no recorded outcome.';
				}
			} catch {
				if (isCurrent(generation, id, userId)) {
					viewState = 'legacy';
					message = 'This older request has no recorded outcome.';
				}
			}
			return;
		}
		const elapsed = Date.now() - waitStartedAt;
		if (elapsed >= PAUSE_AFTER_MS) {
			viewState = 'paused';
			return;
		}
		viewState = elapsed >= SLOW_AFTER_MS ? 'slow' : 'loading';
		pollTimer = setTimeout(
			() => void readRequest(id, userId, generation),
			Math.min(elapsed >= SLOW_AFTER_MS ? 8000 : POLL_MS, PAUSE_AFTER_MS - elapsed)
		);
	}

	function checkAgain() {
		const userId = get(authStore).user?.id;
		const id = page.url.searchParams.get('search');
		if (!userId || !id) return;
		clearPoll();
		waitStartedAt = Date.now();
		viewState = 'loading';
		void readRequest(id, userId, loadGeneration);
	}

	async function submit() {
		if (submissionUncertain || submitting || requestIsRunning || !draftReady || !canSubmit) return;
		formError = '';
		let filters;
		try {
			filters = buildRecommendationFilters(draft);
			if (!isFilteredRequest(filters)) throw new Error('Choose at least one filter.');
		} catch (error) {
			formError = error instanceof Error ? error.message : 'Check your filters.';
			return;
		}
		const userId = get(authStore).user?.id;
		const supabase = getSupabase();
		if (!userId || !supabase) return;
		const generation = loadGeneration;
		submitting = true;
		let createdId: string | null = null;
		try {
			await librarySaves.flush();
			if (get(authStore).user?.id !== userId || generation !== loadGeneration) return;
			const { data, error } = await withTimeout((signal) =>
				supabase
					.from('recommendation_requests')
					.insert({ user_id: userId, filters })
					.select('public_id')
					.abortSignal(signal)
					.single()
			);
			if (get(authStore).user?.id !== userId || generation !== loadGeneration) return;
			if (error || !data?.public_id) throw error ?? new Error('No request ID was returned.');
			createdId = data.public_id;
		} catch (error) {
			if (get(authStore).user?.id !== userId || generation !== loadGeneration) return;
			submissionUncertain = error instanceof RequestTimeoutError;
			formError = submissionUncertain ? '' : 'Could not start this search. Please try again.';
			if (submissionUncertain) void loadRecent(userId, generation);
		} finally {
			if (createdId && get(authStore).user?.id === userId && generation === loadGeneration) {
				const destination = resolve(savedSearchPath(createdId));
				try {
					focusResultsOnClose = true;
					// Replace the editor's shallow entry with the new run, keeping Back on this run's base.
					await goto(destination, { replaceState: editorOpen });
					await tick();
					resultsHeading?.focus({ preventScroll: true });
					resultsHeading?.scrollIntoView({ block: 'start' });
				} catch {
					window.location.assign(destination);
				}
			}
			submitting = false;
		}
	}

	function handleNotInterested(book: Book) {
		const dismissed = notInterestedStore.toggle(book.book_id, book);
		if (dismissed) {
			if (planToReadStore.has(book.id)) planToReadStore.toggle(book.id, book.book_id, book);
			if (get(ratingsStore).has(book.id)) ratingsStore.removeRating(book.id, book.book_id);
		}
	}

	function handleBookmark(book: Book) {
		const alreadyBookmarked = planToReadStore.has(book.id);
		planToReadStore.toggle(book.id, book.book_id, book);
		if (!alreadyBookmarked) notInterestedStore.remove(book.book_id);
	}

	function handleRate(book: Book, value: RatingValue) {
		ratingsStore.setRating(book.id, value, book.book_id, book);
	}

	$effect(() => {
		if (!browser) return;
		const authStatus = $authInitStore.status;
		const userId = $authStore.user?.id ?? null;
		const id = page.url.searchParams.get('search');
		if (authStatus === 'idle' || authStatus === 'checking') return;
		const seedKey = id
			? ''
			: `${page.url.searchParams.get('from') ?? ''}:${page.url.searchParams.get('change') ?? ''}`;
		const key = `${userId ?? ''}:${id ?? ''}:${seedKey}`;
		if (key === activeKey) return;
		const routeKey = `${id ?? ''}:${seedKey}`;
		const keepDraftAfterSignIn =
			!!userId &&
			activeUserId === null &&
			activeKey !== '' &&
			activeRouteKey === routeKey &&
			!id &&
			draftReady;
		activeKey = key;
		activeUserId = userId;
		activeRouteKey = routeKey;
		const generation = ++loadGeneration;
		clearPoll();
		startingBookController?.abort();
		request = null;
		result = null;
		recent = [];
		recentLoading = false;
		recentError = '';
		unavailableSeedId = '';
		submittedFilters = null;
		message = '';
		formError = '';
		submissionUncertain = false;
		startingBookLoadError = '';
		draftReady = !id || !userId || !(/^\d+$/.test(id) || isPublicRequestId(id));
		startingBookBlocked = false;
		if (!id) focusResultsOnClose = false;
		if (!userId) {
			viewState = 'idle';
			recent = [];
			if (id) {
				draft = emptyFilterDraft();
				resolvedStartingBook = null;
				formVersion += 1;
			} else void initializeStartingBook(page.url, generation);
			return;
		}
		void loadRecent(userId, generation);
		if (!id) {
			viewState = 'idle';
			if (!keepDraftAfterSignIn) void initializeStartingBook(page.url, generation);
			return;
		}
		resolvedStartingBook = null;
		if (!(/^\d+$/.test(id) || isPublicRequestId(id))) {
			viewState = 'unavailable';
			draft = emptyFilterDraft();
			formVersion += 1;
			return;
		}
		viewState = 'loading';
		draft = emptyFilterDraft();
		waitStartedAt = Date.now();
		void readRequest(id, userId, generation);
	});

	$effect(() => {
		if (!browser || navigating.to) return;
		if ($authInitStore.status === 'idle' || $authInitStore.status === 'checking') return;
		// Navigation commits page.state after rendering. Open only after that commit,
		// otherwise the router can overwrite the newly pushed dialog layer.
		if (
			!page.url.searchParams.get('search') &&
			page.state.filteredRecommendationDialog?.url !== page.url.href
		)
			openEditor();
	});

	onDestroy(() => {
		loadGeneration += 1;
		clearPoll();
		startingBookController?.abort();
	});
</script>

<svelte:head>
	<title>Filtered recommendations — Unread</title>
	<meta
		name="description"
		content="Find personalized book recommendations that match your filters."
	/>
</svelte:head>

<div class="filtered-page">
	<div hidden={editorOpen}>
		<LibraryLoadNotice collections={['ratings', 'bookmarks', 'dismissals']} />
	</div>
	<header class="filtered-page__header">
		<nav aria-label="Recommendation views" class="filtered-page__tabs">
			<a href={resolve('/rate/recommendations')}>For you</a>
			<a href={resolve('/discover')} aria-current="page">Filter books</a>
		</nav>
		<h1 class="filtered-page__title typ-display2 typ-display2--content">Find your next book</h1>
		<a class="btn btn--secondary" href={resolve('/choose-books?mode=recommend_from_selection')}
			>Find more like books you loved</a
		>
	</header>

	<section class="filtered-page__results" aria-label="Filtered recommendation results">
		<div class="filtered-page__toolbar">
			<h2 class="typ-h3" tabindex="-1" bind:this={resultsHeading}>Your matches</h2>
			<Button
				variant="secondary"
				onclick={openEditor}
				aria-haspopup="dialog"
				aria-expanded={editorOpen}
				ref={(element) => (filterTrigger = element)}
			>
				{#snippet icon()}<SlidersHorizontal size={18} />{/snippet}
				Filters
			</Button>
		</div>
		{#if request}
			<div class="filtered-page__applied">
				<span class="typ-caption">Search filters</span>
				<p>{describeFilters(submittedFilters, seedTitles)}</p>
			</div>
		{/if}
		{#if hasUnappliedChanges}
			<div class="filtered-page__draft-notice" role="status">
				<p>Your changes haven’t been applied.</p>
				<Button variant="tertiary" compact onclick={openEditor}>Review changes</Button>
			</div>
		{/if}
		{#if submissionUncertain && !editorOpen}<p role="alert">{t('requests.uncertainSearch')}</p>{/if}
		{#if viewState === 'idle'}
			<div class="filtered-page__empty">
				<p>Start with a book, or choose your preferences.</p>
				<Button onclick={openEditor}>Choose filters</Button>
			</div>
		{:else if viewState === 'loading' || viewState === 'slow'}
			<p role="status">
				{viewState === 'slow'
					? 'This is taking longer than usual. The request is still running.'
					: request?.status === 'pending'
						? 'Waiting to start your search…'
						: 'Finding books that match your filters…'}
			</p>
			{#if message}<p>{message}</p>{/if}
			<BookCardGridSkeleton ariaLabel="Finding matching books" count={10} />
		{:else if viewState === 'paused'}
			<p>
				This request is still pending. It may complete later; starting another search creates a
				separate request.
			</p>
			{#if requestId}<p>Request #{requestId}</p>{/if}
			<Button variant="secondary" onclick={checkAgain}>Check status</Button>
		{:else if viewState === 'failed' || viewState === 'error' || viewState === 'unavailable' || viewState === 'legacy'}
			<p role="alert">
				{message ||
					(viewState === 'legacy'
						? 'This older request has no recorded outcome.'
						: 'This request is unavailable.')}
			</p>
			{#if requestId}<p>Request #{requestId}</p>{/if}
			{#if viewState === 'error'}<Button variant="secondary" onclick={checkAgain}>Load again</Button
				>{/if}
			{#if viewState === 'failed'}<Button variant="secondary" onclick={openEditor}
					>Review filters and try again</Button
				>{/if}
		{:else if viewState === 'empty'}
			<p>
				{sourceOnlyRun
					? 'No unread matches were found from this starting book. Try another book.'
					: 'No unread books matched these choices. Try fewer changes or broader filters.'}
			</p>
			<div class="filtered-page__recovery">
				<Button variant="secondary" onclick={openEditor}>Adjust filters</Button>
				{#if sourceOnlyRun}
					<Button variant="secondary" onclick={chooseAnotherStartingBook}
						>Choose another starting book</Button
					>
				{:else if isStartingBookId(appliedSeed)}
					<Button
						variant="secondary"
						disabled={!canRequest ||
							submissionUncertain ||
							submitting ||
							requestIsRunning ||
							!draftReady}
						onclick={() => void useStartingBookOnly()}>Use starting book only</Button
					>
				{/if}
			</div>
		{:else if viewState === 'ready' && result}
			<p>
				{result.books.length}
				{result.books.length === 1 ? 'recommendation' : 'recommendations'}
			</p>
			<ul
				class="book-card-grid filtered-page__grid"
				aria-label="Books matching your filters"
				use:trackGridColumns={(columns) => (gridColumns = columns)}
			>
				{#each result.books as book, index (book.book_id)}
					<li>
						<BookCard
							{book}
							context="recommendations"
							coverPriority={coverPriorityFor(index, gridColumns)}
							likedBookPrecedents={filterRatedLikedBookPrecedents(
								result.likedBookPrecedentsByBookId[book.book_id] ?? [],
								$ratingsStore
							)}
							authorRelationshipAuthors={filterAuthorRelationshipAuthors(
								result.authorRelationshipAuthorsByBookId[book.book_id] ?? [],
								cleanLikedAuthors
							)}
							dimensionMatches={result.dimensionMatchSnapshotsByBookId[book.book_id]?.matches ?? []}
							bookmarked={$planToReadStore.has(book.id)}
							onBookmark={() => handleBookmark(book)}
							currentRating={$ratingsStore.get(book.id) ?? null}
							onRate={(_id, value) => handleRate(book, value)}
							onRemoveRating={() => ratingsStore.removeRating(book.id, book.book_id)}
							notInterested={$notInterestedStore.has(book.book_id)}
							onNotInterested={() => handleNotInterested(book)}
						/>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if $authStore.user}
		<section class="filtered-page__recent" aria-label="Recent filtered searches">
			<div class="filtered-page__toolbar">
				<h2 class="typ-h3" tabindex="-1" bind:this={recentHeading}>Recent searches</h2>
				<Button
					variant="secondary"
					compact
					onclick={refreshRecent}
					disabled={recentLoading}
					aria-busy={recentLoading ? 'true' : 'false'}>Refresh recent searches</Button
				>
			</div>
			{#if recentLoading}<p role="status">Loading recent searches…</p>{/if}
			{#if recentError}<p role="alert">{recentError}</p>{/if}
			{#if !recentLoading && !recentError && !recent.length}<p>No recent searches yet.</p>{/if}
			{#if recent.length}
				<ul>
					{#each recent as item (item.public_id)}
						<li>
							<a
								href={resolve(savedSearchPath(item.public_id))}
								aria-current={requestId === item.public_id ? 'page' : undefined}
							>
								<strong>{describeFilters(item.filters, seedTitles)}</strong>
								<span
									>{item.created_at ? new Date(item.created_at).toLocaleDateString() : ''} · {item.status ??
										'Older request'}</span
								>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>

{#key page.url.href}
	<ModalDialog
		open={editorOpen}
		onClose={closeLayer}
		labelledby="filter-panel-title"
		initialFocus="#filter-panel-title"
		onClosed={onEditorClosed}
		placement="drawer"
		restoreFocusTarget={filterTrigger}
		closeDisabled={submitting}
	>
		<div
			class="filter-panel"
			in:slideFilterPanel|global={{ duration: 200 }}
			out:slideFilterPanel|global={{ duration: 150 }}
		>
			<header class="filter-panel__header">
				<div>
					<h2 id="filter-panel-title" class="typ-h3" tabindex="-1">Refine your search</h2>
				</div>
				<button
					type="button"
					class="recommendation-filter-close"
					aria-label="Close filters"
					disabled={submitting}
					onclick={closeLayer}
				>
					<X size={18} aria-hidden="true" />
				</button>
			</header>
			<form
				id="filtered-recommendations-form"
				onsubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<div class="filter-panel__body scrollbar-subtle" aria-busy={!draftReady}>
					{#if startingBookLoadError}
						<div role="alert">
							<p>{startingBookLoadError}</p>
							<Button
								variant="tertiary"
								compact
								disabled={submitting}
								onclick={() => void initializeStartingBook(page.url, loadGeneration)}
								>Try again</Button
							>
						</div>
					{/if}
					{#if draftReady}
						{#key formVersion}<fieldset class="filter-panel__fields" disabled={submitting}>
								<RecommendationFilterFields
									bind:draft
									resolvedBook={resolvedStartingBook}
									onSeedResolve={(book) => {
										seedTitles[book.book_id] = book.title;
										resolvedStartingBook = book;
										startingBookLoadError = '';
										startingBookBlocked = false;
									}}
									{onSeedAvailabilityChange}
									activeTag={historyLayer === 'genres' || historyLayer === 'keywords'
										? historyLayer
										: null}
									onTagOpen={openLayer}
									onTagClose={closeLayer}
								/>
							</fieldset>{/key}
					{:else}
						<p role="status">
							{page.url.searchParams.get('search')
								? 'Loading saved filters…'
								: 'Loading starting book…'}
						</p>
					{/if}
					<LibraryLoadNotice collections={['ratings', 'bookmarks', 'dismissals']} />
				</div>
				<footer class="filter-panel__footer">
					{#if submissionUncertain}<p class="filtered-page__form-error" role="alert">
							{t('requests.uncertainSearch')}
							<Button variant="link" compact onclick={viewRecentSearches}
								>View recent searches</Button
							>
						</p>
					{:else if formError}<p class="filtered-page__form-error" role="alert">{formError}</p>{/if}
					{#if requestIsRunning}<p role="status">
							Your current search is running. You can prepare changes for your next search.
						</p>
					{:else if hasUnappliedChanges}<p>Your changes haven’t been applied.</p>{/if}
					{#if draftReady && !canSubmit && !startingBookBlocked}
						<p class="filtered-page__eligibility">
							{#if !$authStore.user}
								Sign in to find books from these choices.
								<Button variant="link" compact onclick={() => authModalRequestStore.open('signin')}
									>Sign in</Button
								>
							{:else if !isUserLibraryIdsReady($authStore.user?.id, $userLibraryHydrationStore)}
								{t('libraryLoad.wait')}
							{:else if !draft.seedBookId && $ratingsStore.size < MIN_RATINGS}
								Choose a starting book or <a href={resolve('/rate')}>rate at least ten books</a> to start
								a search.
							{:else if $librarySaves.queuedCount > 0 || $librarySaves.isFlushing}
								{t('librarySaves.wait')}
							{:else if draft.seedBookId === unavailableSeedId}
								This starting book is unavailable. Remove it and choose another.
							{:else}
								Choose a valid starting book or rate at least ten books to start a search.
							{/if}
						</p>
					{/if}
					<div class="filter-panel__actions">
						<Button variant="tertiary" disabled={!draftReady || submitting} onclick={clearFilters}
							>Clear filters</Button
						>
						<Button
							type="submit"
							disabled={!draftReady ||
								submissionUncertain ||
								!canSubmit ||
								submitting ||
								requestIsRunning}
							aria-busy={submitting ? 'true' : 'false'}
							>{submitting ? 'Starting…' : 'Find books'}</Button
						>
					</div>
				</footer>
			</form>
		</div>
	</ModalDialog>
{/key}

<style>
	.filtered-page__recovery {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.filtered-page {
		width: 100%;
		margin: 0 auto;
		padding-bottom: var(--space-8);
	}
	.filtered-page__header {
		max-width: 46rem;
		margin: 0 auto var(--space-6);
		text-align: center;
	}
	.filtered-page__title {
		margin: 0 0 var(--space-2);
	}
	.filtered-page__tabs {
		display: flex;
		justify-content: center;
		gap: var(--space-4);
		margin-bottom: var(--space-5);
	}
	.filtered-page__tabs a {
		color: var(--color-text-muted);
		padding: var(--space-2);
		text-decoration: none;
		border-bottom: 2px solid transparent;
	}
	.filtered-page__tabs a[aria-current='page'] {
		color: var(--color-text);
		border-color: var(--color-text);
	}
	.filtered-page__toolbar {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}
	.filtered-page__toolbar h2 {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
		scroll-margin-top: var(--space-6);
	}
	.filtered-page__results {
		min-width: 0;
		min-height: 24rem;
	}
	.filtered-page__results p {
		color: var(--color-text-muted);
	}
	.filtered-page__applied {
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: var(--space-3) var(--space-4);
		margin-bottom: var(--space-4);
		overflow-wrap: anywhere;
	}
	.filtered-page__applied span {
		color: var(--color-text-muted);
	}
	.filtered-page__applied p {
		margin: var(--space-1) 0 0;
		color: var(--color-text);
	}
	.filtered-page__draft-notice {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-3);
		border-left: 3px solid var(--color-focus);
		background: var(--color-floating-control-bg);
		padding: var(--space-3);
		margin-bottom: var(--space-4);
	}
	.filtered-page__draft-notice p {
		margin: 0;
	}
	.filtered-page__empty {
		display: grid;
		justify-items: center;
		text-align: center;
		gap: var(--space-3);
		padding: var(--space-8) var(--space-4);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius);
	}
	.filtered-page__empty p {
		margin: 0;
		max-width: 34rem;
	}
	.filtered-page__grid {
		margin-top: var(--space-4);
	}
	.filtered-page__recent {
		margin-top: var(--space-8);
	}
	.filtered-page__recent ul {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
		gap: var(--space-3);
		list-style: none;
		padding: 0;
	}
	.filtered-page__recent a {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		height: 100%;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: var(--space-3);
		color: var(--color-text);
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.filtered-page__recent a[aria-current='page'] {
		border-color: var(--color-focus);
	}
	.filtered-page__recent span {
		color: var(--color-text-muted);
		font-size: var(--typ-caption-font-size);
	}
	.filter-panel {
		display: flex;
		flex-direction: column;
		width: min(34rem, 100%);
		height: 100dvh;
		min-width: 0;
		min-height: 0;
		background: var(--color-card-bg);
		box-shadow: var(--shadow-drawer);
	}
	.filter-panel__header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-5);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}
	.filter-panel__header h2 {
		margin: 0;
	}
	.filter-panel form {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}
	.filter-panel__body {
		overflow-y: auto;
		overscroll-behavior: contain;
		flex: 1;
		min-height: 0;
		padding: var(--space-5);
		scrollbar-gutter: stable;
	}
	.filter-panel__fields {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}
	.filter-panel__footer {
		flex-shrink: 0;
		border-top: 1px solid var(--color-border);
		padding: var(--space-4) var(--space-5) max(var(--space-4), env(safe-area-inset-bottom));
		background: var(--color-card-bg);
	}
	.filter-panel__footer p {
		font-size: var(--typ-caption-font-size);
		color: var(--color-text-muted);
		margin: 0 0 var(--space-3);
	}
	.filter-panel__footer .filtered-page__form-error {
		color: var(--color-error-text);
	}
	.filter-panel__actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.filter-panel__actions :global(.btn) {
		flex: 1;
		min-width: 0;
		padding-inline: var(--space-3);
	}
	@media (max-width: 767px) {
		.filtered-page__header {
			margin-bottom: var(--space-4);
		}
		.filter-panel {
			overflow: hidden;
			width: 100%;
			box-shadow: none;
		}
		.filter-panel__header {
			padding: var(--space-4);
			padding-top: calc(var(--space-4) + env(safe-area-inset-top, 0px));
		}
		.filter-panel__body {
			padding: var(--space-4);
		}
		.filter-panel__footer {
			padding-inline: var(--space-4);
		}
		.filtered-page__draft-notice {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
