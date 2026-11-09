<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { SvelteMap, SvelteURL } from 'svelte/reactivity';
	import { get } from 'svelte/store';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { beforeNavigate, pushState, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { t } from '$lib/copy';
	import { ArrowRight, Check, LoaderCircle, Plus } from 'lucide-svelte';
	import Button from '$lib/components/Button.svelte';
	import SearchBar from '$lib/components/SearchBar.svelte';
	import BookCard from '$lib/components/BookCard.svelte';
	import LibraryLoadNotice from '$lib/components/LibraryLoadNotice.svelte';
	import SelectionCover from '$lib/components/recommendations/SelectionCover.svelte';
	import LoopingSelectionStrip from '$lib/components/recommendations/LoopingSelectionStrip.svelte';
	import SelectionBookDetails from '$lib/components/recommendations/SelectionBookDetails.svelte';
	import { authStore, authReady, authInitStore } from '$lib/stores/auth';
	import { bookmarksPageStore } from '$lib/stores/bookmarksPage';
	import { loadBookmarkDetails } from '$lib/auth/load-bookmarks';
	import { selectionCandidates } from '$lib/recommendations/selectionCandidates';
	import { ratingsStore } from '$lib/stores/ratings';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { filterRatedLikedBookPrecedents } from '$lib/recommendations/likedBookPrecedents';
	import {
		toggleBookmarked,
		toggleNotInterested,
		setBookRating,
		removeBookRating
	} from '$lib/stores/libraryActions';
	import { librarySaves } from '$lib/stores/librarySaves';
	import { userLibraryHydrationStore, isUserLibraryIdsReady } from '$lib/stores/userLibrary';
	import { authModalRequestStore } from '$lib/stores/authModalRequest';
	import { recommendationsPageStore } from '$lib/stores/recommendationsPage';
	import { refreshRecommendationsCountFromApi } from '$lib/stores/recommendationsCount';
	import { searchBooks } from '$lib/search';
	import { createShelfSearch } from '$lib/search/shelfSearch';
	import { withTimeout } from '$lib/requests/timeout';
	import {
		runSelectionJob,
		selectionResultBooks,
		SelectionJobError,
		RequestTimeoutError,
		SELECTION_SLOW_MS
	} from '$lib/recommendations/selectionJob';
	import {
		fetchRecommendations,
		type FetchRecommendationsResult
	} from '$lib/recommendations/fetchRecommendations';
	import {
		addSelection,
		emptySelectionDrafts,
		isSelectionType,
		parseSelectionRequest,
		readSelectionDrafts,
		writeSelectionDrafts,
		selectionPendingKey,
		sameSelection,
		SELECTION_MIN,
		SELECTION_MAX,
		type SelectionType,
		type SelectionRun,
		type SelectionPending
	} from '$lib/recommendations/bookSelection';
	import type { Book } from '$lib/types/book';
	import {
		loadSelectionHistory,
		SelectionHistoryError,
		type CompletedSelection
	} from '$lib/recommendations/selectionHistory';

	type Source = 'all' | 'bookmarks' | 'recommendations';
	const sources: { id: Source; label: string }[] = [
		{ id: 'all', label: 'All books' },
		{ id: 'bookmarks', label: 'Bookmarks' },
		{ id: 'recommendations', label: 'Previous recommendations' }
	];
	let owner = $state<string | null>(null);
	let mode = $state<SelectionType>('rank_selection');
	let selectedDetails = $state<{ book: Book; trigger: HTMLElement } | null>(null);
	let selectionDetailsCache = $state<Record<string, Book>>({});
	let detailsRestoreFocus = $state(true);
	let drafts = $state(emptySelectionDrafts());
	let source = $state<Source>('all');
	let query = $state('');
	let preselection = $state<{
		source: Exclude<Source, 'all'>;
		mode: SelectionType;
		version: number;
	} | null>(null);
	let recentLoading = $state(false);
	let recentRequest = 0;
	let loading = $state(true);
	let searchResults = $state<Book[]>([]);
	let searching = $state(false);
	let searchError = $state('');
	let searchVersion = $state(0);
	let nextOffset = $state(0);
	let hasMoreSearch = $state(false);
	let visibleCount = $state(24);
	let notice = $state('');
	let errorMessage = $state('');
	let recent = $state<SelectionRun[]>([]);
	let recentError = $state('');
	let run = $state<SelectionRun | null>(null);
	let result = $state<FetchRecommendationsResult | null>(null);
	let pending = $state<SelectionPending | null>(null);
	let submitting = $state(false);
	let recovering = $state(false);
	let slow = $state(false);
	let actionError = $state('');
	let editing = $state(true);
	let latest = $state<CompletedSelection | null>(null);
	let historyLoading = $state<string | null>(null);
	let historyError = $state<{ id: string; message: string } | null>(null);
	let historyController: AbortController | null = null;
	const historyCache = new SvelteMap<string, CompletedSelection>();
	type SavedView = {
		mode: SelectionType;
		editing: boolean;
		run: SelectionRun | null;
		result: FetchRecommendationsResult | null;
		submitted: Book[];
		x: number;
		y: number;
		stripLeft: number;
		focusId?: string;
	};
	const historyViews = new SvelteMap<string, SavedView>();
	let historySequence = 0;
	let appliedHistoryKey: string | null = null;
	let pickerHistoryKey: string | null = null;
	let historyCommit = $state(false);
	let historyTransition = 0;
	let historyGeometry: { width: number; height: number } | null = null;
	let originalHistoryStyles: { minHeight: string; width: string; anchoring: string } | null = null;
	let submittedBooks: Book[] = [];
	let abandonedIds: string[] = [];
	let slowTimer: ReturnType<typeof setTimeout> | undefined;
	let selectionRegion = $state<HTMLElement>();
	let clearedSelections = $state<Record<SelectionType, Book[] | null>>({
		rank_selection: null,
		recommend_from_selection: null
	});
	let resultsRegion = $state<HTMLElement>();
	let routeKey = '';
	let generation = 0;
	let routeController: AbortController | null = null;
	let pollController: AbortController | null = null;
	const selected = $derived(drafts[mode]);
	const displayedMode = $derived(!editing && run ? run.request_type : mode);
	const selectionLabel = $derived(
		`${selected.length === SELECTION_MAX ? '200 / 200' : selected.length} ${selected.length === 1 ? 'book' : 'books'} selected`
	);
	const selectedIds = $derived(new Set(selected.map((book) => book.book_id)));
	const idsReady = $derived(
		Boolean(owner) && isUserLibraryIdsReady(owner, $userLibraryHydrationStore)
	);
	const automaticallyEligible = (book: Book) =>
		!$ratingsStore.has(book.id) && !$notInterestedStore.has(book.book_id);
	const running = $derived(submitting || pending !== null);
	const actionLabel = $derived(
		running
			? recovering
				? 'Reconnecting…'
				: slow
					? 'Still working…'
					: mode === 'rank_selection'
						? 'Ranking your list…'
						: 'Finding more books…'
			: actionError || (mode === 'rank_selection' ? 'Rank my list' : 'Find more like these')
	);
	const canSubmit = $derived(
		!loading &&
			idsReady &&
			selected.length >= SELECTION_MIN &&
			selected.length <= SELECTION_MAX &&
			!running &&
			!historyLoading &&
			!preselection
	);
	const currentOwner = $derived($authStore.user?.id ?? null);
	const bookmarkLoad = $derived($userLibraryHydrationStore.collections.bookmarkDetails);
	const bookmarkSnapshot = $derived(
		$bookmarksPageStore.userId === owner && $bookmarksPageStore.loaded && bookmarkLoad.hasSnapshot
	);
	const bookmarks = $derived.by(() => {
		void $librarySaves;
		void $planToReadStore;
		if (!owner || owner !== currentOwner || !bookmarkSnapshot) return [];
		const books = planToReadStore
			.mergeBooks($bookmarksPageStore.books)
			.filter((book) => !idsReady || $planToReadStore.has(book.id));
		const added = librarySaves
			.overlays('bookmark')
			.filter((change) => change.value && change.bookId);
		const order = new Map(added.map((change) => [change.bookId, change.revision]));
		return books.sort((a, b) => (order.get(b.id) ?? -1) - (order.get(a.id) ?? -1));
	});
	const recommendations = $derived(
		$selectionCandidates.owner === owner && owner === currentOwner
			? [...$selectionCandidates.books]
					.sort(
						(a, b) =>
							($selectionCandidates.lastRecommendedAt[b.book_id] ?? 0) -
							($selectionCandidates.lastRecommendedAt[a.book_id] ?? 0)
					)
					.filter((book) => automaticallyEligible(book))
			: []
	);
	const sourceBooks = $derived(
		source === 'bookmarks'
			? bookmarks
			: source === 'recommendations'
				? recommendations
				: searchResults
	);
	const shelfIndex = $derived(createShelfSearch(sourceBooks));
	const matchingIds = $derived(source === 'all' ? null : shelfIndex.matchingIds(query));
	const candidates = $derived(
		sourceBooks.filter((book) => !matchingIds || matchingIds.has(book.id))
	);
	const visibleCandidates = $derived(candidates.slice(0, visibleCount));
	const sourceLoaded = $derived(
		source === 'all' ||
			(source === 'bookmarks'
				? bookmarkSnapshot
				: $selectionCandidates.owner === owner && $selectionCandidates.loaded)
	);
	const sourceLoading = $derived(
		source !== 'all' &&
			(source === 'bookmarks'
				? ['idle', 'loading', 'retrying'].includes(bookmarkLoad.status) && !bookmarkSnapshot
				: !$selectionCandidates.loaded && !$selectionCandidates.error)
	);
	const sourceError = $derived(
		source === 'bookmarks'
			? bookmarkLoad.status === 'error'
				? 'Could not load your bookmarks.'
				: ''
			: source === 'recommendations'
				? $selectionCandidates.error
				: ''
	);
	const libraryFailed = $derived(
		$userLibraryHydrationStore.userId === owner &&
			['ratings', 'bookmarks', 'dismissals'].some(
				(kind) =>
					$userLibraryHydrationStore.collections[kind as 'ratings' | 'bookmarks' | 'dismissals']
						.status === 'error'
			)
	);
	function cancelPreselection() {
		preselection = null;
		if (!owner || !browser) return;
		const url = new URL(window.location.href);
		if (!url.searchParams.has('from')) return;
		url.searchParams.delete('from');
		url.searchParams.set('mode', mode);
		routeKey = `${owner}:${url.search}`;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- consume this page's one-time entry action
		replaceState(url, { ...page.state });
	}

	async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
		const token = get(authStore).session?.access_token;
		if (!token) throw new Error('Sign in to continue.');
		return withTimeout(
			async (signal) => {
				const response = await fetch(resolve(path as '/'), {
					...options,
					signal,
					headers: {
						Authorization: `Bearer ${token}`,
						...(options.body ? { 'Content-Type': 'application/json' } : {}),
						...options.headers
					}
				});
				const body = await response.json();
				if (!response.ok)
					throw Object.assign(new Error(body.message ?? 'Could not complete this request.'), {
						status: response.status,
						notStarted: body.not_started === true
					});
				return body as T;
			},
			{ signal: options.signal ?? undefined }
		);
	}
	const active = (version: number) => generation === version && owner === get(authStore).user?.id;
	function persistPending(value: SelectionPending | null) {
		pending = value;
		if (!owner) return;
		try {
			if (value) sessionStorage.setItem(selectionPendingKey(owner), JSON.stringify(value));
			else sessionStorage.removeItem(selectionPendingKey(owner));
		} catch {
			/* The mounted page still guards duplicate requests. */
		}
	}
	function setSelection(books: Book[]) {
		if (running) return;
		cancelPreselection();
		cancelHistoryLoad();
		clearedSelections = { ...clearedSelections, [mode]: null };
		notice = '';
		drafts = { ...drafts, [mode]: books };
		errorMessage = '';
		actionError = '';
	}
	const bookmarkResult = toggleBookmarked;
	const dismissResult = toggleNotInterested;
	function openSelectionDetails(book: Book, trigger: HTMLElement) {
		const cached = selectionDetailsCache[book.book_id];
		const loaded = [
			book,
			...bookmarks,
			...recommendations,
			...searchResults,
			...(result?.books ?? []),
			planToReadStore.getBook(book.id),
			ratingsStore.getRatedBook(book.id)
		].find((candidate) => candidate?.book_id === book.book_id && candidate.summary !== undefined);
		detailsRestoreFocus = true;
		selectedDetails = { book: cached ?? loaded ?? book, trigger };
	}
	function addBooks(books: Book[]) {
		const next = addSelection(selected, books);
		setSelection(next);
		if (next.length === SELECTION_MAX) notice = 'This mode supports a maximum of 200 books.';
	}
	function removeBook(id: string) {
		setSelection(selected.filter((book) => book.book_id !== id));
	}
	function clearSelection() {
		const snapshot = [...selected];
		setSelection([]);
		clearedSelections = { ...clearedSelections, [mode]: snapshot };
	}
	function undoClear() {
		const snapshot = clearedSelections[mode];
		if (snapshot) setSelection(snapshot);
	}
	function changeMode(next: SelectionType) {
		if (running) return;
		cancelPreselection();
		cancelHistoryLoad();
		selectedDetails = null;
		mode = next;
		editing = true;
		notice = '';
		errorMessage = '';
		actionError = '';
		if (!new URL(window.location.href).searchParams.has('request_id')) {
			const url = new URL(window.location.href);
			url.searchParams.set('mode', next);
			routeKey = `${owner}:${url.search}`;
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- shallow update on this page
			replaceState(url, { ...page.state });
		}
	}
	function selectSource(next: Source) {
		if (running) return;
		cancelPreselection();
		cancelHistoryLoad();
		source = next;
		query = '';
		visibleCount = 24;
	}

	function loadSource(retry = false) {
		if (!owner || owner !== currentOwner) return;
		if (source === 'bookmarks') void loadBookmarkDetails(owner, retry);
		else if (source === 'recommendations') void selectionCandidates.load(owner, retry);
	}
	async function loadRecent(version: number, signal?: AbortSignal) {
		const request = ++recentRequest;
		recentLoading = true;
		try {
			const data = await api<{ requests: SelectionRun[] }>('/api/recommendations/selection', {
				signal
			});
			if (active(version) && request === recentRequest) {
				recent = data.requests;
				recentError = '';
			}
			return data.requests;
		} catch {
			if (active(version) && request === recentRequest && !signal?.aborted)
				recentError = 'Could not load recent selections.';
			return null;
		} finally {
			if (active(version) && request === recentRequest) recentLoading = false;
		}
	}
	function updateUrl(id: string | null) {
		const url = new URL(page.url);
		url.searchParams.delete('from');
		url.searchParams.set('mode', mode);
		if (id) url.searchParams.set('request_id', id);
		else url.searchParams.delete('request_id');
		routeKey = `${owner}:${url.search}`;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- shallow update on this page
		replaceState(url, { ...page.state });
	}
	function restoreBooks(ids: string[], books: Book[]) {
		const byId = new Map(books.map((book) => [book.book_id, book]));
		return ids.map(
			(id) =>
				byId.get(id) ?? {
					id,
					book_id: id,
					title: 'Unavailable book',
					author: 'Saved selection'
				}
		);
	}
	function saveLatest(value: CompletedSelection) {
		latest = value;
		historyCache.set(value.run.public_id, value);
		if (!owner) return;
		try {
			sessionStorage.setItem(`unread:selection-latest:v1:${owner}`, JSON.stringify(value));
		} catch {
			/* Results remain reusable in memory if storage is unavailable. */
		}
	}
	function cancelHistoryLoad() {
		historyController?.abort();
		historyController = null;
		historyLoading = null;
	}
	function holdHistoryGeometry() {
		if (historyGeometry) return;
		const root = document.documentElement;
		historyGeometry = { width: root.clientWidth, height: root.scrollHeight };
		originalHistoryStyles = {
			minHeight: root.style.minHeight,
			width: document.body.style.width,
			anchoring: root.style.overflowAnchor
		};
		root.style.minHeight = `${historyGeometry.height}px`;
		root.style.overflowAnchor = 'none';
		// Prevent scrollbar removal from changing result-card widths during the commit.
		document.body.style.width = `${historyGeometry.width}px`;
	}
	function releaseHistoryGeometry() {
		if (!originalHistoryStyles || typeof document === 'undefined') return;
		document.documentElement.style.minHeight = originalHistoryStyles.minHeight;
		document.documentElement.style.overflowAnchor = originalHistoryStyles.anchoring;
		document.body.style.width = originalHistoryStyles.width;
		historyGeometry = null;
		originalHistoryStyles = null;
	}
	function captureHistoryView(focusId?: string): SavedView {
		return {
			mode,
			editing,
			run,
			result,
			submitted: [...submittedBooks],
			x: window.scrollX,
			y: window.scrollY,
			stripLeft: document.querySelector<HTMLElement>('.cover-strip')?.scrollLeft ?? 0,
			focusId
		};
	}
	function rememberCurrentHistoryView(focusId?: string) {
		const key = appliedHistoryKey ?? `view-${++historySequence}`;
		historyViews.set(key, captureHistoryView(focusId));
		if (editing) pickerHistoryKey = key;
		if (!appliedHistoryKey) {
			appliedHistoryKey = key;
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- associate a memory snapshot with the current shallow entry
			replaceState(new URL(window.location.href), {
				...page.state,
				selectionHistory: { ownerId: owner!, key }
			});
		}
	}
	async function applyHistoryView(key: string) {
		const view = historyViews.get(key);
		if (!view) return;
		cancelHistoryLoad();
		const transition = ++historyTransition;
		holdHistoryGeometry();
		historyCommit = true;
		appliedHistoryKey = key;
		mode = view.mode;
		editing = view.editing;
		run = view.run;
		result = view.result;
		submittedBooks = [...view.submitted];
		selectedDetails = null;
		await tick();
		await new Promise<void>((done) => requestAnimationFrame(() => done()));
		if (transition !== historyTransition) return;
		const strip = document.querySelector<HTMLElement>('.cover-strip');
		if (strip && view.editing) strip.scrollLeft = view.stripLeft;
		const target = view.focusId
			? document.querySelector<HTMLElement>(`[data-history-id="${view.focusId}"]`)
			: view.editing
				? selectionRegion
				: resultsRegion;
		target?.focus({ preventScroll: true });
		// Releasing the temporary height and restoring scroll happen together before paint.
		releaseHistoryGeometry();
		window.scrollTo({ left: view.x, top: view.y, behavior: 'instant' });
		historyCommit = false;
	}
	async function commitHistoricalResult(
		value: CompletedSelection,
		push: boolean,
		requestVersion: number
	) {
		if (!active(requestVersion)) return;
		const transition = ++historyTransition;
		holdHistoryGeometry();
		historyCommit = true;
		selectedDetails = null;
		run = value.run;
		result = value.result;
		submittedBooks = [...value.books];
		editing = false;
		saveLatest(value);
		const key = `view-${++historySequence}`;
		appliedHistoryKey = key;
		historyViews.set(key, captureHistoryView());
		const url = new SvelteURL(page.url);
		url.search = '';
		url.searchParams.set('mode', value.run.request_type);
		url.searchParams.set('request_id', value.run.public_id);
		routeKey = `${owner}:${url.search}`;
		const state = { ...page.state, selectionHistory: { ownerId: owner!, key } };
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- same-page result commit owns one scroll, not router navigation
		if (push) pushState(url, state);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- direct-link history loading replaces its own entry
		else replaceState(url, state);
		await tick();
		// Direct entry can still be finishing a router navigation; let its scroll
		// reset finish before using the same final results alignment as in-page clicks.
		if (!push) await new Promise<void>((done) => requestAnimationFrame(() => done()));
		if (!active(requestVersion) || transition !== historyTransition) return;
		resultsRegion?.focus({ preventScroll: true });
		// Remove the temporary document floor and scroll once in the same frame.
		releaseHistoryGeometry();
		resultsRegion?.scrollIntoView({ block: 'start', behavior: 'instant' });
		historyViews.set(key, captureHistoryView());
		historyCommit = false;
	}
	async function openHistoricalResult(
		item: Pick<SelectionRun, 'public_id' | 'request_type'>,
		push = true
	) {
		if (running || !owner || owner !== currentOwner) return;
		cancelPreselection();
		cancelHistoryLoad();
		historyError = null;
		const controller = new AbortController();
		historyController = controller;
		historyLoading = item.public_id;
		const version = generation;
		try {
			const cached = historyCache.get(item.public_id);
			const value =
				cached ??
				(await loadSelectionHistory({
					id: item.public_id,
					signal: controller.signal,
					getRun: (id, includeBooks, signal) =>
						api(
							`/api/recommendations/selection?request_id=${encodeURIComponent(id)}${includeBooks ? '&include_books=1' : ''}`,
							{ signal }
						),
					loadResults: (id, signal) =>
						fetchRecommendations(get(authStore).session?.access_token ?? null, id, {
							includeRated: true,
							signal
						})
				}));
			if (controller.signal.aborted || !active(version)) return;
			if (push) rememberCurrentHistoryView(item.public_id);
			historyLoading = null;
			await commitHistoricalResult(value, push, version);
		} catch (cause) {
			if (controller.signal.aborted || !active(version)) return;
			if (!push && cause instanceof SelectionHistoryError) {
				// Direct links retain failed-job recovery; in-page failures leave the picker alone.
				run = cause.run;
				mode = run.request_type;
				submittedBooks = restoreBooks(run.book_ids, cause.books);
				drafts = { ...drafts, [mode]: [...submittedBooks] };
				actionError = 'Error: Failed. Retry';
				if (cause.code === 'no_usable_selection')
					errorMessage =
						'None of the chosen books are available for recommendations. We have noted this error and it will be addressed.';
				updateUrl(null);
				return;
			}
			historyError = {
				id: item.public_id,
				message:
					cause instanceof SelectionJobError
						? 'The saved selection failed. We have noted this error and it will be addressed.'
						: cause instanceof RequestTimeoutError
							? 'Loading this selection timed out. Retry.'
							: 'Could not load this selection. Retry.'
			};
		} finally {
			if (historyController === controller) {
				historyController = null;
				historyLoading = null;
			}
		}
	}
	function handleHistoryClick(event: MouseEvent, item: SelectionRun) {
		if (running) {
			event.preventDefault();
			return;
		}
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return;
		event.preventDefault();
		void openHistoricalResult(item);
	}
	function saveHistoryScroll() {
		if (historyCommit || !appliedHistoryKey) return;
		const view = historyViews.get(appliedHistoryKey);
		if (view) {
			view.x = window.scrollX;
			view.y = window.scrollY;
		}
	}
	beforeNavigate(() => cancelHistoryLoad());
	async function focusResults() {
		await tick();
		resultsRegion?.focus({ preventScroll: true });
		resultsRegion?.scrollIntoView({ block: 'start', behavior: 'instant' });
	}
	async function backToSelection() {
		if (pickerHistoryKey && historyViews.has(pickerHistoryKey)) {
			const saved = historyViews.get(pickerHistoryKey)!;
			const url = new SvelteURL(page.url);
			url.search = '';
			url.searchParams.set('mode', saved.mode);
			routeKey = `${owner}:${url.search}`;
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- restore the preserved in-page picker
			replaceState(url, {
				...page.state,
				selectionHistory: { ownerId: owner!, key: pickerHistoryKey }
			});
			await applyHistoryView(pickerHistoryKey);
			return;
		}
		mode = run?.request_type ?? mode;
		drafts = { ...drafts, [mode]: [...submittedBooks] };
		clearedSelections = { ...clearedSelections, [mode]: null };
		source = 'all';
		query = '';
		editing = true;
		updateUrl(null);
		await tick();
		selectionRegion?.focus({ preventScroll: true });
		selectionRegion?.scrollIntoView({ block: 'start', behavior: 'instant' });
	}
	async function executeJob(
		snapshot: SelectionPending,
		version: number,
		create = false,
		restore = false
	) {
		pollController?.abort();
		const controller = new AbortController();
		pollController = controller;
		submitting = true;
		editing = true;
		recovering = false;
		actionError = '';
		errorMessage = '';
		notice = '';
		mode = snapshot.request_type;
		submittedBooks = restoreBooks(snapshot.book_ids, snapshot.books ?? drafts[mode]);
		drafts = { ...drafts, [mode]: [...submittedBooks] };
		persistPending({ ...snapshot, books: submittedBooks });
		clearTimeout(slowTimer);
		slow = Date.now() - snapshot.since >= SELECTION_SLOW_MS;
		if (!slow)
			slowTimer = setTimeout(
				() => {
					slow = true;
				},
				SELECTION_SLOW_MS - (Date.now() - snapshot.since)
			);
		let needsBooks = restore;
		try {
			const completed = await runSelectionJob({
				pending: snapshot,
				signal: controller.signal,
				visibilityTarget: document,
				submit: create
					? async (signal) => {
							await librarySaves.flush();
							if (signal.aborted) throw signal.reason;
							if (!isUserLibraryIdsReady(owner, get(userLibraryHydrationStore)))
								throw Object.assign(new Error('Library unavailable'), { notStarted: true });
							const data = await api<{ request_id: string }>('/api/recommendations/selection', {
								method: 'POST',
								body: JSON.stringify({
									request_type: snapshot.request_type,
									book_ids: snapshot.book_ids
								}),
								signal
							});
							return data.request_id;
						}
					: undefined,
				getStatus: async (id, signal) => {
					const data = await api<{ request: SelectionRun; books?: Book[] }>(
						`/api/recommendations/selection?request_id=${encodeURIComponent(id)}${needsBooks ? '&include_books=1' : ''}`,
						{ signal }
					);
					if (active(version) && !signal.aborted && needsBooks) {
						mode = data.request.request_type;
						submittedBooks = restoreBooks(data.request.book_ids, data.books ?? submittedBooks);
						drafts = { ...drafts, [mode]: [...submittedBooks] };
						if (pending)
							persistPending({
								...pending,
								request_type: mode,
								book_ids: data.request.book_ids,
								books: submittedBooks
							});
						needsBooks = false;
					}
					return data.request;
				},
				getRecent: async (signal) =>
					(await api<{ requests: SelectionRun[] }>('/api/recommendations/selection', { signal }))
						.requests,
				loadResults: (id, signal) =>
					fetchRecommendations(get(authStore).session?.access_token ?? null, id, {
						includeRated: true,
						signal
					}),
				onPending: (value) => {
					if (!active(version) || controller.signal.aborted) return;
					persistPending({ ...value, books: submittedBooks });
					if (value.public_id) updateUrl(value.public_id);
				},
				onRun: (value) => {
					if (active(version) && !controller.signal.aborted) run = value;
				},
				onRecovering: (value) => {
					if (active(version) && !controller.signal.aborted) recovering = value;
				}
			});
			if (!active(version) || controller.signal.aborted) return;
			run = completed.run;
			result = {
				...completed.result,
				books: selectionResultBooks(run, completed.result, submittedBooks)
			};
			saveLatest({ run, result, books: [...submittedBooks] });
			persistPending(null);
			editing = false;
			updateUrl(run.public_id);
			recommendationsPageStore.ensureUser(owner);
			recommendationsPageStore.reset();
			selectionCandidates.invalidate();
			void refreshRecommendationsCountFromApi(get(authStore).session?.access_token ?? null);
			void loadRecent(version);
			await focusResults();
		} catch (cause) {
			if (!active(version) || controller.signal.aborted) return;
			if (pending?.public_id) abandonedIds.push(pending.public_id);
			persistPending(null);
			result = null;
			editing = true;
			actionError =
				cause instanceof RequestTimeoutError ? 'Error: Timed out. Retry' : 'Error: Failed. Retry';
			if (cause instanceof SelectionJobError && cause.code === 'no_usable_selection')
				errorMessage =
					'None of the chosen books are available for recommendations. We have noted this error and it will be addressed.';
			updateUrl(null);
		} finally {
			if (active(version) && pollController === controller) {
				submitting = false;
				recovering = false;
				clearTimeout(slowTimer);
			}
		}
	}
	async function initialize(userId: string, url: URL, version: number, signal: AbortSignal) {
		cancelHistoryLoad();
		preselection = null;
		if (owner !== userId) {
			historyCache.clear();
			historyViews.clear();
		}
		appliedHistoryKey = null;
		pickerHistoryKey = null;
		selectedDetails = null;
		if (owner !== userId) selectionDetailsCache = {};
		owner = userId;
		clearedSelections = { rank_selection: null, recommend_from_selection: null };
		loading = true;
		submitting = false;
		recovering = false;
		actionError = '';
		latest = null;
		abandonedIds = [];
		clearTimeout(slowTimer);
		drafts = readSelectionDrafts(sessionStorage, userId);
		mode = isSelectionType(url.searchParams.get('mode'))
			? (url.searchParams.get('mode') as SelectionType)
			: 'rank_selection';
		selectionCandidates.activate(userId);
		run = null;
		result = null;
		pending = null;
		errorMessage = '';
		notice = '';
		recent = [];
		recentError = '';
		query = '';
		visibleCount = 24;
		const id = url.searchParams.get('request_id');
		editing = true;
		try {
			const stored = JSON.parse(sessionStorage.getItem(selectionPendingKey(userId)) ?? 'null');
			if (stored) {
				const payload = parseSelectionRequest({
					request_type: stored.request_type,
					book_ids: stored.book_ids
				});
				if (typeof stored.since === 'number' && Number.isFinite(stored.since))
					pending = {
						...payload,
						since: stored.since,
						...(typeof stored.public_id === 'string' ? { public_id: stored.public_id } : {}),
						books: Array.isArray(stored.books) ? stored.books : drafts[payload.request_type],
						excluded_ids: Array.isArray(stored.excluded_ids) ? stored.excluded_ids : []
					};
			}
		} catch {
			/* Ignore an invalid journal without changing the selection draft. */
		}
		try {
			const saved = JSON.parse(
				sessionStorage.getItem(`unread:selection-latest:v1:${userId}`) ?? 'null'
			);
			if (
				saved?.run?.status === 'completed' &&
				Array.isArray(saved.books) &&
				Array.isArray(saved.result?.books)
			) {
				parseSelectionRequest({
					request_type: saved.run.request_type,
					book_ids: saved.run.book_ids
				});
				latest = saved;
				historyCache.set(saved.run.public_id, saved);
			}
		} catch {
			/* Ignore an invalid or unavailable results cache. */
		}
		const origin = url.searchParams.get('from');
		const restoringRequest = Boolean(pending || id);
		source = origin === 'bookmarks' || origin === 'recommendations' ? origin : 'all';
		if (pending) mode = pending.request_type;
		loading = false;
		void loadRecent(version, signal);
		if (pending) void executeJob(pending, version);
		else if (id) {
			void openHistoricalResult({ public_id: id, request_type: mode }, false);
			loading = false;
			return;
		}
		if (!restoringRequest && source !== 'all') preselection = { source, mode, version };
	}
	$effect(() => {
		const userId = owner;
		const activeSource = source;
		const visible = editing;
		if (userId && userId === currentOwner && visible && !running && activeSource !== 'all') {
			// Track invalidation, but never restart an error automatically on each render.
			void $selectionCandidates;
			untrack(() => loadSource());
		}
	});
	$effect(() => {
		const intent = preselection;
		if (!intent || !idsReady || !sourceLoaded || sourceError || !editing || running) return;
		const available = sourceBooks.filter(automaticallyEligible);
		untrack(() => {
			if (!active(intent.version) || intent.source !== source || intent.mode !== mode) return;
			drafts = { ...drafts, [mode]: addSelection([], available) };
			if (available.length > SELECTION_MAX)
				notice = `Selected 200 most recently ${source === 'bookmarks' ? 'bookmarked' : 'recommended'} unrated books.`;
			writeSelectionDrafts(sessionStorage, owner!, drafts);
			cancelPreselection();
		});
	});
	$effect(() => {
		if (!browser || !$authReady) return;
		const userId = currentOwner;
		const url = page.url;
		const key = `${userId ?? ''}:${url.search}`;
		const markerKey = page.state.selectionHistory?.key;
		untrack(() => {
			const historyMarker = page.state.selectionHistory;
			if (
				historyMarker?.ownerId === userId &&
				owner === userId &&
				historyViews.has(historyMarker.key) &&
				markerKey === historyMarker.key
			) {
				routeKey = `${userId}:${window.location.search}`;
				if (appliedHistoryKey !== historyMarker.key) void applyHistoryView(historyMarker.key);
				return;
			}
			// SvelteKit shallow entries update page.state but retain the loaded page URL.
			if (url.search !== window.location.search && owner === userId) return;
			if (key === routeKey) return;
			routeKey = key;
			const version = ++generation;
			routeController?.abort();
			pollController?.abort();
			cancelHistoryLoad();
			clearTimeout(slowTimer);
			routeController = new AbortController();
			if (!userId) {
				selectedDetails = null;
				selectionDetailsCache = {};
				preselection = null;
				historyCache.clear();
				historyViews.clear();
				owner = null;
				drafts = emptySelectionDrafts();
				pending = null;
				run = null;
				result = null;
				loading = false;
				return;
			}
			void initialize(userId, new URL(window.location.href), version, routeController.signal);
		});
	});
	$effect(() => {
		const value = drafts;
		const userId = owner;
		if (browser && userId && userId === currentOwner && !loading)
			writeSelectionDrafts(sessionStorage, userId, value);
	});
	$effect(() => {
		const value = query.trim();
		const currentSource = source;
		const userId = currentOwner;
		void searchVersion;
		searchResults = [];
		nextOffset = 0;
		hasMoreSearch = false;
		searchError = '';
		searching = false;
		visibleCount = 24;
		if (currentSource !== 'all' || value.length < 3 || !userId) return;
		let live = true;
		searching = true;
		const timer = setTimeout(() => {
			void searchBooks(value, 0, 24)
				.then((data) => {
					if (!live) return;
					searchResults = data.books;
					nextOffset = data.nextOffset;
					hasMoreSearch = data.hasMore;
				})
				.catch(() => {
					if (live) searchError = 'Book search is unavailable. Please try again.';
				})
				.finally(() => {
					if (live) searching = false;
				});
		}, 250);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	});
	async function moreSearch() {
		if (searching || running) return;
		const value = query;
		const version = generation;
		searching = true;
		searchError = '';
		try {
			const data = await searchBooks(value, nextOffset, 24);
			if (!active(version) || source !== 'all' || value !== query) return;
			const byId = new Map([...searchResults, ...data.books].map((book) => [book.book_id, book]));
			searchResults = [...byId.values()];
			nextOffset = data.nextOffset;
			hasMoreSearch = data.hasMore;
			visibleCount += 24;
		} catch {
			if (active(version) && value === query)
				searchError = 'Could not load more books. Please try again.';
		} finally {
			if (active(version) && value === query) searching = false;
		}
	}
	async function submit() {
		if (!canSubmit) return;
		submitting = true;
		errorMessage = '';
		const version = generation;
		const snapshot = parseSelectionRequest({
			request_type: mode,
			book_ids: selected.map((book) => book.book_id)
		});
		if (latest && sameSelection(latest.run, snapshot)) {
			run = latest.run;
			result = latest.result;
			submittedBooks = [...selected];
			saveLatest({ ...latest, books: submittedBooks });
			editing = false;
			submitting = false;
			actionError = '';
			updateUrl(run.public_id);
			await focusResults();
			return;
		}
		await executeJob(
			{
				...snapshot,
				since: Date.now(),
				books: [...selected],
				excluded_ids: [...new Set([...recent.map((item) => item.public_id), ...abandonedIds])]
			},
			version,
			true
		);
	}
	onDestroy(() => {
		generation++;
		routeController?.abort();
		pollController?.abort();
		cancelHistoryLoad();
		releaseHistoryGeometry();
		clearTimeout(slowTimer);
	});
</script>

<svelte:window onscroll={saveHistoryScroll} />

<svelte:head>
	<title>Choose your next read — Unread</title>
	<meta
		name="description"
		content="Choose what to read from your books, or discover more based on books you loved."
	/>
</svelte:head>

<div class="selection-page">
	<LibraryLoadNotice collections={['ratings', 'bookmarks', 'dismissals']} />
	{#if !$authReady}
		<p role="status">Restoring your session…</p>
	{:else if $authInitStore.status === 'error' && !currentOwner}
		<h1>We couldn’t restore your session.</h1>
		<p>Reload the page to try again.</p>
		<Button onclick={() => window.location.reload()}>Reload</Button>
	{:else if !currentOwner}
		<h1>Sign in to choose books</h1>
		<p>Rank your list or find recommendations based on books you select.</p>
		<Button onclick={() => authModalRequestStore.open('signin')}>Sign in</Button>
	{:else if loading || owner !== currentOwner}
		<p role="status">Loading your books…</p>
	{:else}
		<nav class="mode-tabs" aria-label="Recommendation mode">
			<button
				class="chrome-nav-link"
				aria-pressed={displayedMode === 'rank_selection'}
				disabled={running}
				onclick={() => changeMode('rank_selection')}>Rank my list</button
			>
			<button
				class="chrome-nav-link"
				aria-pressed={displayedMode === 'recommend_from_selection'}
				disabled={running}
				onclick={() => changeMode('recommend_from_selection')}>Find more like these</button
			>
		</nav>
		<div class="selection-editor" hidden={!editing}>
			<h1 class="sr-only">
				{mode === 'rank_selection' ? 'Rank my list' : 'Find more like these'}
			</h1>
			<section
				class="selection-stage"
				aria-label="Book selection"
				bind:this={selectionRegion}
				tabindex="-1"
			>
				{#if selected.length}
					{#key mode}
						<LoopingSelectionStrip
							books={selected}
							dismissed={$notInterestedStore}
							onRemove={removeBook}
							onOpen={openSelectionDetails}
							resetLayers={editing}
							disabled={running}
						/>
					{/key}
				{:else}
					<div class="empty-selection">
						<p>
							Search for books or add your bookmarks and previous recommendations for consideration.
						</p>
					</div>
				{/if}
				<div class="selection-toolbar">
					<div class="selection-tools">
						<span aria-live="polite">{selectionLabel}</span>
						{#if selected.length || clearedSelections[mode]}
							<button
								class="text-button"
								disabled={running}
								onclick={() => (clearedSelections[mode] ? undoClear() : clearSelection())}
								>{clearedSelections[mode] ? 'Undo clear' : 'Clear entire selection'}</button
							>
						{/if}
					</div>
					<div class="selection-action">
						<Button
							pill
							disabled={!canSubmit}
							aria-busy={running ? 'true' : 'false'}
							aria-label={actionLabel}
							onclick={() => void submit()}
						>
							<span class="submit-label" role="status" aria-live="polite">
								{#if running}<LoaderCircle
										size={18}
										class="selection-spinner"
										aria-hidden="true"
									/>{/if}
								{actionLabel}
								{#if !running && !actionError}<ArrowRight size={18} aria-hidden="true" />{/if}
							</span>
						</Button>
						{#if !idsReady && !running}
							<p class="action-readiness" role="status">
								{libraryFailed
									? 'Load your library before getting recommendations. Use Retry above.'
									: 'Loading your library before getting recommendations…'}
							</p>
						{:else if preselection}
							<p class="action-readiness" role="status">Preparing your selection…</p>
						{/if}
					</div>
				</div>
				{#if selected.length < 4 && !running}
					<div class="selection-hints">
						{#if selected.length < 4}<span>Choose at least 4 books to continue.</span>{/if}
					</div>
				{/if}
			</section>
			{#if notice}<p class="notice" role="status">{notice}</p>{/if}

			<fieldset class="book-browser" disabled={running} aria-labelledby="add-books-heading">
				<div class="browser-heading">
					<h2 id="add-books-heading">Add to your selection</h2>
					<nav aria-label="Book sources">
						{#each sources as item (item.id)}<button
								class="chrome-nav-link"
								aria-pressed={source === item.id}
								onclick={() => selectSource(item.id)}>{item.label}</button
							>{/each}
					</nav>
				</div>
				<div class="selection-search">
					<SearchBar
						id="selection-search"
						bind:value={query}
						placeholder={source === 'all'
							? 'Search all books by title or author'
							: source === 'bookmarks'
								? 'Search bookmarks by title or author'
								: 'Search previous recommendations by title or author'}
						ariaLabel="Search books to select"
					/>
				</div>
				{#if source !== 'all'}
					<div class="browser-meta">
						<button
							class="text-button"
							disabled={!sourceLoaded || !idsReady || selected.length >= 200 || !candidates.length}
							onclick={() => addBooks(candidates.filter(automaticallyEligible))}
							>{source === 'bookmarks'
								? 'Add all Bookmarks'
								: 'Add all previous recommendations'}</button
						>
					</div>
				{/if}
				<div class="browser-state" aria-live="polite">
					{#if sourceError}
						<p role="alert">
							{sourceError}
							<button class="text-button" onclick={() => loadSource(true)}>Retry</button>
						</p>
					{:else if sourceLoading}<p role="status">Loading the collection…</p>
					{:else if source === 'all' && query.trim().length > 0 && query.trim().length < 3}<p>
							Type at least 3 characters to search books.
						</p>
					{:else if source !== 'all' && !idsReady}<p>
							{libraryFailed
								? 'Load your library to add this collection. Use Retry above.'
								: 'Loading your library before adding this collection…'}
						</p>
					{/if}
				</div>
				{#if (source !== 'all' && sourceLoaded) || (source === 'all' && query.trim().length >= 3)}
					<ul class="candidate-grid" aria-label="Books to add">
						{#each visibleCandidates as book (book.book_id)}
							<li class:dismissed={$notInterestedStore.has(book.book_id)}>
								<button
									type="button"
									class="candidate-cover-hit"
									aria-label={book.author?.trim()
										? t('shared.recommendationCard.seeSummaryCoverAriaLabelWithAuthor', {
												title: book.title,
												author: book.author
											})
										: t('shared.recommendationCard.seeSummaryCoverAriaLabelTitleOnly', {
												title: book.title
											})}
									onclick={(event) => openSelectionDetails(book, event.currentTarget)}
								>
									<SelectionCover {book} />
								</button>
								<div class="candidate-info">
									<h3>
										<button
											type="button"
											class="candidate-title-hit"
											onclick={(event) => openSelectionDetails(book, event.currentTarget)}
											>{book.title}</button
										>
									</h3>
									<p>{book.author}</p>
									<button
										class="add-book"
										aria-label={selectedIds.has(book.book_id)
											? `${book.title} selected`
											: `Add ${book.title}`}
										aria-pressed={selectedIds.has(book.book_id)}
										disabled={!selectedIds.has(book.book_id) && selected.length >= 200}
										onclick={() =>
											selectedIds.has(book.book_id) ? removeBook(book.book_id) : addBooks([book])}
									>
										{#if selectedIds.has(book.book_id)}<Check size={15} />Selected{:else}<Plus
												size={15}
											/>Add{/if}
									</button>
								</div>
							</li>
						{/each}
					</ul>
					{#if searching}<p role="status">
							Searching books…
						</p>{:else if !candidates.length && !searchError}<p class="browser-empty">
							{query.trim() || source === 'all'
								? 'No books match your search.'
								: source === 'bookmarks'
									? t('rated.emptyBookmarked')
									: 'No previous recommendations available.'}
						</p>{/if}
					{#if searchError}<p role="alert">
							{searchError}
							<button class="text-button" onclick={() => searchVersion++}>Retry search</button>
						</p>{/if}
					{#if candidates.length > visibleCount}<Button
							variant="secondary"
							compact
							onclick={() => (visibleCount += 24)}>Show more books</Button
						>{:else if source === 'all' && hasMoreSearch}<Button
							variant="secondary"
							compact
							disabled={searching}
							onclick={() => void moreSearch()}>Load more results</Button
						>{/if}
				{/if}
			</fieldset>
		</div>
		{#if errorMessage}<p class="notice" role="alert">{errorMessage}</p>{/if}
		{#if result && !editing}
			<section
				class="selection-results"
				aria-label="Recommendations"
				bind:this={resultsRegion}
				tabindex="-1"
			>
				<div class="results-title">
					<h1 class="sr-only">Recommendations</h1>
					<Button variant="secondary" onclick={() => void backToSelection()}
						>Back to selection</Button
					>
				</div>
				{#if !result.books.length}<p>
						No matches found. We have noted this error and it will be addressed.
					</p>{/if}
				<ol class="book-card-grid">
					{#each result.books as book, index (book.book_id)}<li>
							<BookCard
								context="recommendations"
								{book}
								coverPriority={index < 4 ? 'eager' : 'lazy'}
								bookmarked={$planToReadStore.has(book.id)}
								onBookmark={() => bookmarkResult(book)}
								currentRating={$ratingsStore.get(book.id) ?? null}
								onRate={(_id, value) => setBookRating(book, value)}
								onRemoveRating={() => removeBookRating(book)}
								notInterested={$notInterestedStore.has(book.book_id)}
								onNotInterested={() => dismissResult(book)}
								precedentsFromSelection={result.selectionSeedBookIds?.includes(book.book_id) ??
									false}
								likedBookPrecedents={result.selectionSeedBookIds?.includes(book.book_id)
									? (result.likedBookPrecedentsByBookId[book.book_id] ?? [])
									: filterRatedLikedBookPrecedents(
											result.likedBookPrecedentsByBookId[book.book_id] ?? [],
											$ratingsStore
										)}
								dimensionMatches={result.dimensionMatchSnapshotsByBookId[book.book_id]?.matches ??
									[]}
							/>
						</li>{/each}
				</ol>
			</section>
		{/if}
		{#if recent.length || recentError || recentLoading}<section
				class="recent-selections"
				aria-busy={recentLoading}
			>
				<h2>Recent selections</h2>
				{#if recentLoading && !recent.length}<p role="status">Loading recent selections…</p>{/if}
				{#if recentError}<p role="alert">
						{recentError}
						<button class="text-button" onclick={() => void loadRecent(generation)}>Retry</button>
					</p>{/if}
				<ul>
					{#each recent.slice(0, 8) as item (item.public_id)}<li>
							<!-- eslint-disable svelte/no-navigation-without-resolve -- Disabled links omit href; enabled URLs use resolve(). -->
							<a
								data-history-id={item.public_id}
								href={running
									? undefined
									: resolve(
											`/choose-books?mode=${item.request_type}&request_id=${encodeURIComponent(item.public_id)}`
										)}
								role={running ? 'link' : undefined}
								aria-disabled={running ? 'true' : undefined}
								tabindex={running ? -1 : undefined}
								aria-busy={historyLoading === item.public_id ? 'true' : undefined}
								onclick={(event) => handleHistoryClick(event, item)}
								><span
									>{item.request_type === 'rank_selection' ? 'Choose from' : 'More like'}
									{item.book_ids.length} books</span
								><span aria-live="polite"
									>{historyLoading === item.public_id
										? 'Loading selection…'
										: historyError?.id === item.public_id
											? 'Could not open · Retry'
											: `${item.status} · ${new Date(item.created_at).toLocaleDateString()}`}</span
								>{#if historyLoading === item.public_id}<LoaderCircle
										size={16}
										class="history-spinner"
									/>{:else}<ArrowRight size={16} />{/if}</a
							>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						</li>{/each}
				</ul>
				{#if historyError}<p class="history-error" role="alert">{historyError.message}</p>{/if}
			</section>{/if}
		{#if historyLoading && !recent.some((item) => item.public_id === historyLoading)}<p
				role="status"
			>
				Loading saved selection…
			</p>{/if}
		{#if historyError && !recent.some((item) => item.public_id === historyError?.id)}<p
				role="alert"
			>
				{historyError.message}<button
					class="text-button"
					onclick={() =>
						void openHistoricalResult({ public_id: historyError!.id, request_type: mode }, false)}
					>Retry</button
				>
			</p>{/if}
	{/if}
</div>

{#if selectedDetails && editing && owner === currentOwner}
	<SelectionBookDetails
		book={selectedDetails.book}
		trigger={selectedDetails.trigger}
		detailsKnown={Boolean(selectionDetailsCache[selectedDetails.book.book_id])}
		onResolved={(book) => {
			selectionDetailsCache = { ...selectionDetailsCache, [book.book_id]: book };
			if (selectedDetails?.book.book_id === book.book_id)
				selectedDetails = { ...selectedDetails, book };
		}}
		onClose={() => {
			selectedDetails = null;
		}}
		onSearchAuthor={async (author) => {
			detailsRestoreFocus = false;
			selectedDetails = null;
			selectSource('all');
			query = author;
			await tick();
			document.querySelector<HTMLInputElement>('.selection-search input')?.focus();
		}}
		restoreFocus={detailsRestoreFocus}
	/>
{/if}

<style>
	.browser-state {
		min-height: 32px;
		color: var(--color-text-muted);
		font-size: 13px;
	}
	.browser-state p {
		margin: 8px 0;
	}
	.action-readiness {
		max-width: 320px;
		margin: 8px 0 0;
		color: var(--color-text-muted);
		font-size: 12px;
	}
	.selection-editor[hidden] {
		display: none;
	}
	:global(.history-spinner) {
		animation: history-spin 1s linear infinite;
	}
	@keyframes history-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.history-error {
		font-size: 13px;
		color: var(--color-text-muted);
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.history-spinner) {
			animation: none;
		}
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}
	.selection-page {
		max-width: 1440px;
		margin: 0 auto;
		padding: 0 clamp(8px, 2vw, 32px) 40px;
	}
	.mode-tabs {
		display: flex;
		gap: 8px;
		padding-bottom: 14px;
		border-bottom: 1px solid var(--color-border);
		margin-bottom: 28px;
		flex-wrap: wrap;
	}
	button {
		cursor: pointer;
	}
	button:disabled {
		cursor: default;
		opacity: 0.45;
	}
	.mode-tabs button[aria-pressed='true'] {
		background: var(--color-accent-brand);
		color: var(--color-bg);
	}
	h1 {
		font-size: clamp(38px, 5.8vw, 80px);
		font-weight: 400;
		line-height: 1.05;
		letter-spacing: -0.035em;
		margin: 0;
	}
	h2 {
		font-size: clamp(24px, 2.5vw, 32px);
		font-weight: 400;
		margin: 0;
	}
	.selection-stage {
		margin: 8px 0 24px;
		min-width: 0;
	}
	.book-browser {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.submit-label :global(.selection-spinner) {
		animation: selection-spin 1s linear infinite;
	}
	@keyframes selection-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.submit-label :global(.selection-spinner) {
			animation-duration: 2s;
		}
	}
	.candidate-grid li.dismissed {
		opacity: 0.45;
	}
	.selection-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		padding-top: 8px;
	}
	.selection-tools {
		display: flex;
		flex-wrap: wrap;
		gap: 20px;
		align-items: center;
		min-width: 0;
		font-family: var(--font-family-interactive);
		font-size: 13px;
		color: var(--color-text-muted);
	}
	.text-button {
		border: 0;
		padding: 4px 0;
		background: transparent;
		color: var(--color-text);
		text-decoration: underline;
		text-underline-offset: 4px;
		font: inherit;
	}
	.empty-selection {
		min-height: 205px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
	}
	.empty-selection p {
		font-size: 24px;
		margin: 10px 0;
		text-align: center;
	}

	.browser-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 18px;
		flex-wrap: wrap;
	}
	.browser-heading nav {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}
	.browser-heading button[aria-pressed='true'] {
		color: var(--color-text);
		background: var(--color-bg-hover);
	}
	.selection-search {
		margin-bottom: 20px;
	}
	.browser-meta {
		display: flex;
		justify-content: flex-end;
		gap: 16px;
		align-items: center;
		min-height: 44px;
		font-family: var(--font-family-interactive);
		font-size: 12px;
		color: var(--color-text-muted);
	}
	.candidate-grid {
		list-style: none;
		padding: 0;
		margin: 0 0 16px;
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 14px;
	}
	.candidate-grid li {
		display: flex;
		gap: 14px;
		padding: 12px;
		min-width: 0;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-card-bg);
	}
	.candidate-info {
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
	}
	.candidate-cover-hit,
	.candidate-title-hit {
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.candidate-cover-hit {
		flex: 0 0 auto;
		align-self: flex-start;
		border-radius: 4px;
	}
	.candidate-title-hit:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.candidate-cover-hit:focus-visible,
	.candidate-title-hit:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 3px;
	}
	.candidate-info h3 {
		font-size: 17px;
		font-weight: 400;
		line-height: 1.25;
		margin: 0 0 5px;
		overflow-wrap: anywhere;
	}
	.candidate-info p {
		font-size: 13px;
		color: var(--color-text-muted);
		margin: 0 0 12px;
	}
	.add-book {
		display: flex;
		align-items: center;
		gap: 5px;
		margin-top: auto;
		border: 1px solid var(--color-border-hover);
		border-radius: 40px;
		padding: 5px 12px;
		background: transparent;
		color: var(--color-text);
		font-family: var(--font-family-interactive);
		font-size: 13px;
	}
	.add-book[aria-pressed='true'] {
		border-color: var(--color-accent-brand);
		color: var(--color-accent-brand);
	}
	.browser-empty {
		padding: 30px 0;
		color: var(--color-text-muted);
	}
	.selection-action {
		flex-shrink: 0;
		margin-left: auto;
	}
	.submit-label {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.selection-hints > span {
		display: block;
		font-size: 13px;
		font-family: var(--font-family-interactive);
		color: var(--color-text-muted);
		margin-top: 4px;
	}
	.notice {
		padding: 16px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-bg-muted);
		margin: 20px 0;
	}
	.results-title {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 20px;
		margin: 24px 0;
	}
	.selection-results {
		margin-top: 40px;
	}
	.selection-results ol {
		padding: 0;
		list-style: none;
	}
	.recent-selections {
		margin-top: 60px;
		border-top: 1px solid var(--color-border);
		padding-top: 24px;
	}
	.recent-selections ul {
		list-style: none;
		padding: 0;
	}
	.recent-selections a {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 14px 0;
		color: var(--color-text);
		text-decoration: none;
		border-bottom: 1px solid var(--color-border);
	}
	.recent-selections a span:nth-child(2) {
		margin-left: auto;
		color: var(--color-text-muted);
		font: 12px var(--font-family-interactive);
	}
	.recent-selections a[aria-disabled='true'] {
		cursor: default;
	}
	@media (max-width: 1100px) {
		.candidate-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	@media (max-width: 800px) {
		.candidate-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 520px) {
		.candidate-grid {
			grid-template-columns: 1fr;
		}
		.selection-toolbar {
			gap: 12px;
		}
		.selection-action :global(.btn) {
			padding: 12px;
			font-size: 13px;
		}
		.submit-label {
			gap: 8px;
		}
		.selection-tools {
			gap: 4px 12px;
			font-size: 11px;
		}
		.browser-heading nav {
			gap: 0;
		}
		.browser-heading :global(.chrome-nav-link) {
			padding: 8px;
			font-size: 12px;
		}
		.results-title {
			align-items: flex-start;
			flex-direction: column;
		}
		.recent-selections a {
			flex-wrap: wrap;
		}
		.recent-selections a span:nth-child(2) {
			margin-left: 0;
		}
	}
</style>
