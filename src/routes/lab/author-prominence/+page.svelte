<script lang="ts">
	import { beforeNavigate, pushState, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import { onDestroy, onMount, tick } from 'svelte';
	import { get } from 'svelte/store';
	import { page } from '$app/stores';
	import BookSummarySheet from '$lib/components/book-card/BookSummarySheet.svelte';
	import ProminenceField from '$lib/components/lab/ProminenceField.svelte';
	import ProminenceInspector from '$lib/components/lab/ProminenceInspector.svelte';
	import ProminenceLensControl from '$lib/components/lab/ProminenceLensControl.svelte';
	import ProminenceMethod from '$lib/components/lab/ProminenceMethod.svelte';
	import ProminenceRanking from '$lib/components/lab/ProminenceRanking.svelte';
	import ProminenceSearch from '$lib/components/lab/ProminenceSearch.svelte';
	import ScreenReaderOnly from '$lib/components/ScreenReaderOnly.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import { t } from '$lib/copy';
	import { getFooterSupplementContext } from '$lib/footerSupplementContext';
	import { buildDisplayModel } from '$lib/lab/author-prominence/display';
	import {
		beginLensGesture,
		cancelLensGesture,
		commitLensGesture,
		type GestureSource,
		type LensGesture,
		updateLensGesture
	} from '$lib/lab/author-prominence/lens-controller';
	import {
		defaultLens,
		lensState,
		LENS_WEIGHT_TOLERANCE,
		type LensState
	} from '$lib/lab/author-prominence/lens';
	import {
		RankingClient,
		type RankingClientStatus
	} from '$lib/lab/author-prominence/ranking-client';
	import {
		cloneRankingResult,
		type RankingResult
	} from '$lib/lab/author-prominence/ranking-engine';
	import {
		calculateImmediateSelectedRanking,
		calculateImmediateVisibleRanking,
		type ImmediateSelectedRanking,
		type ImmediateRankingMetrics
	} from '$lib/lab/author-prominence/immediate-ranking';
	import { loadRelease, type Release } from '$lib/lab/author-prominence/release';
	import { SvelteMap } from 'svelte/reactivity';
	import { AuthorDetailRepository } from '$lib/lab/author-prominence/detail-data';
	import { createAuthorProminenceCatalogLoader } from '$lib/lab/author-prominence/catalog-loader';
	import {
		computeDimensionStandings,
		type DimensionStandings
	} from '$lib/lab/author-prominence/standings';
	import {
		calculateSimilarProfiles,
		type SimilarityProfile
	} from '$lib/lab/author-prominence/similarity';
	import { auditBadges, formatScore } from '$lib/lab/author-prominence/score';
	import { validateLensWeights } from '$lib/lab/author-prominence/simplex';
	import { PUBLIC_PRESET_NAME } from '$lib/lab/author-prominence/contract';
	import {
		prominenceTimingMeasure,
		prominenceTimingMark,
		withProminenceTiming
	} from '$lib/lab/author-prominence/performance';
	import {
		PublicationController,
		type PublicationMotionIntent
	} from '$lib/lab/author-prominence/publication-controller';
	import {
		buildAuthorSearchIndex,
		searchAuthors,
		type AuthorSearchEntry
	} from '$lib/lab/author-prominence/search';
	import type {
		ContributionSegment,
		RankingEntry,
		SelectedAuthorSnapshot
	} from '$lib/lab/author-prominence/presentation';
	import type { AuthorBook, NormalizedAuthorDetail } from '$lib/lab/author-prominence/types';
	import type { Book, RatingValue } from '$lib/types/book';
	import {
		bookSummarySheetHistory,
		clearBookSummarySheetHistory,
		consumeBookSummaryHistoryEntry,
		createBookSummarySheetOwnerId,
		ownsBookSummarySheet
	} from '$lib/stores/bookSummarySheetHistory';
	import {
		removeBookRating,
		setBookRating,
		toggleBookmarked,
		toggleNotInterested
	} from '$lib/stores/libraryActions';
	import { ratingsStore } from '$lib/stores/ratings';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import type {
		BookSummaryIdentity,
		BookSummarySheetCloseOptions,
		BookSummarySheetState
	} from '$lib/components/book-card/bookSummarySheet';
	import {
		parseProminenceUrl,
		serializeProminenceUrl,
		type ProminenceUrlState
	} from '$lib/lab/author-prominence/url-state';

	type HoverSource = 'map' | 'ranking' | 'similar' | null;
	type SelectionOrigin = 'ranking' | 'map' | 'search' | 'similar' | 'url';
	type DetailStatus = 'loading' | 'ready' | 'error';

	let release = $state.raw<Release | null>(null);
	let loadError = $state<string | null>(null);
	let rankingError = $state<string | null>(null);
	let committedLens = $state.raw<LensState | null>(null);
	let draftLens = $state.raw<LensState | null>(null);
	let selected = $state<number | null>(null);
	let hovered = $state<number | null>(null);
	let hoveredSource = $state<HoverSource>(null);
	let selectionOrigin = $state<SelectionOrigin | null>(null);
	let selectedRankingIndex = $state<number | null>(null);
	let selectedRankingScrollTop = $state(0);
	let searchQuery = $state('');
	let searchFocused = $state(false);
	let searchActiveOption = $state(-1);
	let methodOpen = $state(false);
	let rankingResult = $state.raw<RankingResult | null>(null);
	let acknowledgedRanking = $state.raw<RankingResult | null>(null);
	let activeGesture = $state<LensGesture | null>(null);
	let gestureSequence = 0;
	let cancelToken = $state(0);
	let rankingClient: RankingClient | null = null;
	let rankingStatus = $state<RankingClientStatus>('starting');
	let searchIndex = $state<AuthorSearchEntry[]>([]);
	let announcement = $state('');
	let isMobile = $state(false);
	let lensSheetOpen = $state(false);
	let lensDialog: HTMLDialogElement | null = $state(null);
	let summaryButton: HTMLButtonElement | null = $state(null);
	let railContent: HTMLDivElement | null = $state(null);
	let rankingRegion: HTMLDivElement | null = $state(null);
	let reducedMotion = $state(false);
	let rankingFrame: number | null = null;
	let publishedMotionIntent = $state<PublicationMotionIntent>('none');
	let publishedMotionRevision = $state(0);
	let publishedOrder = $state<number[]>([]);
	let committedPublishedOrder = $state<number[]>([]);
	let publishedOrderChanged = $state(false);
	let lifecycleGeneration = 0;
	let mounted = false;
	const footerSupplement = getFooterSupplementContext();
	const footerSupplementOwner = Symbol('author-prominence');
	let publicationController: PublicationController;
	let rankingProgressVisible = $state(false);
	let rankingProgressShowTimer: ReturnType<typeof setTimeout> | null = null;
	let rankingProgressHideTimer: ReturnType<typeof setTimeout> | null = null;
	let rankingProgressShownAt = 0;
	let detailRepository: AuthorDetailRepository | null = null;
	let selectedDetail = $state.raw<NormalizedAuthorDetail | null>(null);
	let detailStatus = $state<DetailStatus>('loading');
	let detailRequestSequence = 0;
	const catalogLoader = createAuthorProminenceCatalogLoader();
	const bookSummaryOwnerId = createBookSummarySheetOwnerId();
	let bookSummaryState = $state<BookSummarySheetState>({ kind: 'closed' });
	let bookSummaryRestoreFocus = $state(true);
	let bookSummaryRequestSequence = 0;
	let pendingUrlInspectorFocus = false;
	let dimensionStandings = $state.raw<DimensionStandings | null>(null);
	let standingsRelease: Release | null = null;
	let standingsPendingRelease: Release | null = null;
	let standingsTimer: ReturnType<typeof setTimeout> | null = null;
	const similarityCache = new SvelteMap<number, SimilarityProfile[]>();
	let similarityCacheRelease = $state.raw<Release | null>(null);
	let immediateSelectedCache: {
		release: Release;
		lens: LensState;
		selected: number | null;
		ranking: ImmediateSelectedRanking;
	} | null = null;

	const activeLens = $derived(draftLens ?? committedLens);
	const display = $derived.by(() =>
		release ? buildDisplayModel(release.population, release.manifest) : null
	);
	const rankingUpdating = $derived.by(() => {
		if (!rankingResult || !activeLens || rankingResult.selectedIndex !== selected) return true;
		return (
			!sameWeights(rankingResult.weights, activeLens.weights) ||
			rankingStatus === 'busy' ||
			rankingStatus === 'starting'
		);
	});
	const rankByIndex = $derived(
		rankingResult?.rankByIndex ?? new Int32Array(release?.population.count ?? 0)
	);
	const topIndices = $derived.by((): number[] => {
		if (!rankingResult) return [];
		return Array.from(rankingResult.top250.slice(0, rankingResult.topN));
	});
	const bookSummaryBook = $derived(
		bookSummaryState.kind === 'ready' ? bookSummaryState.book : null
	);
	const bookSummaryRating = $derived(
		bookSummaryBook ? ($ratingsStore.get(bookSummaryBook.id) ?? null) : null
	);
	const bookSummaryBookmarked = $derived(
		bookSummaryBook ? $planToReadStore.has(bookSummaryBook.id) : false
	);
	const bookSummaryNotInterested = $derived(
		bookSummaryBook ? $notInterestedStore.has(bookSummaryBook.book_id) : false
	);

	function currentImmediateRanking(): ImmediateRankingMetrics | null {
		const current = release;
		const lens = activeLens;
		if (!current || !lens) return null;
		if (
			!immediateSelectedCache ||
			immediateSelectedCache.release !== current ||
			!sameWeightValues(immediateSelectedCache.lens.weights, lens.weights) ||
			immediateSelectedCache.selected !== selected
		) {
			const ranking = withProminenceTiming('immediate-ranking', () =>
				calculateImmediateSelectedRanking({
					population: current.population,
					sigmaZ: current.manifest.model.sigma_z,
					weights: lens.weights,
					selectedIndex: selected
				})
			);
			immediateSelectedCache = { release: current, lens, selected, ranking };
		}
		return calculateImmediateVisibleRanking({
			population: current.population,
			weights: lens.weights,
			denominator: immediateSelectedCache.ranking.denominator,
			visibleIndices: topIndices,
			selected: immediateSelectedCache.ranking.selected
		});
	}

	const immediateRanking = $derived.by(() => currentImmediateRanking());
	const searchMatches = $derived.by(() => {
		if (!release || !searchQuery.trim()) return [];
		return searchAuthors(searchIndex, searchQuery, rankByIndex, 8);
	});

	const entries = $derived.by((): RankingEntry[] => {
		const current = release;
		const result = rankingResult;
		const model = display;
		const metrics = immediateRanking;
		if (!current || !result || !model || !metrics) return [];
		return topIndices.map((index, position) => {
			const local = metrics.byIndex.get(index);
			const values = local?.values ?? [];
			return {
				index,
				place: position + 1,
				name: current.population.names[index],
				score: formatScore(current.manifest, local?.score ?? 0),
				badges: auditBadges(current.population, index, values, current.manifest),
				books: current.population.nBooks[index],
				recognitions: current.population.nAwards[index]
			};
		});
	});

	const selectedSnapshot = $derived.by((): SelectedAuthorSnapshot | null => {
		if (!release || selected === null || !immediateRanking?.selected) return null;
		const local = immediateRanking.selected;
		return {
			index: selected,
			name: release.population.names[selected],
			place: local.place,
			score: formatScore(release.manifest, local.score),
			values: local.values,
			badges: auditBadges(release.population, selected, local.values, release.manifest)
		};
	});

	const selectedContributionSegments = $derived.by((): ContributionSegment[] => {
		const model = display;
		const snapshot = selectedSnapshot;
		if (!model || !snapshot) return [];
		return model.features.map((feature, index) => ({
			feature: feature.key,
			label: feature.label,
			value: snapshot.values[index] ?? 0,
			colour: feature.colour
		}));
	});

	const lensSummaryLabel = $derived.by(() => {
		if (!activeLens || !display) return 'Open lens control';
		return `Open lens control. ${display.features
			.map((feature, index) => `${feature.label} ${activeLens.displayShares[index] ?? 0}%`)
			.join(', ')}`;
	});

	const selectedSimilarProfiles = $derived.by(() => {
		if (!release || selected === null || similarityCacheRelease !== release) return [];
		return (similarityCache.get(selected) ?? []).map((profile) => ({
			...profile,
			name: release!.population.names[profile.index],
			place: rankByIndex[profile.index] ?? 0
		}));
	});

	const RANKING_PROGRESS_DELAY_MS = 140;
	const RANKING_PROGRESS_MIN_VISIBLE_MS = 360;

	function sameWeights(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
		return sameWeightValues(a, b);
	}

	function sameWeightValues(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
		if (a.length !== b.length) return false;
		for (let index = 0; index < a.length; index++) {
			if (Math.abs(a[index] - b[index]) > LENS_WEIGHT_TOLERANCE) return false;
		}
		return true;
	}

	function clearStandingsTimer(): void {
		if (standingsTimer !== null) clearTimeout(standingsTimer);
		standingsTimer = null;
		standingsPendingRelease = null;
	}

	function calculateStandings(current: Release): void {
		clearStandingsTimer();
		if (standingsRelease === current && dimensionStandings) return;
		dimensionStandings = computeDimensionStandings(
			current.population,
			current.manifest.model.features
		);
		standingsRelease = current;
	}

	function scheduleStandings(current: Release): void {
		if (standingsRelease === current && dimensionStandings) return;
		if (standingsPendingRelease === current) return;
		clearStandingsTimer();
		standingsPendingRelease = current;
		standingsTimer = setTimeout(() => {
			standingsTimer = null;
			standingsPendingRelease = null;
			if (release === current) calculateStandings(current);
		}, 0);
	}

	function ensureStandings(current: Release): void {
		calculateStandings(current);
	}

	function resetSimilarityCache(current: Release | null = null): void {
		similarityCache.clear();
		similarityCacheRelease = current;
	}

	function ensureSimilarity(index: number): void {
		const current = release;
		if (!current) return;
		if (similarityCacheRelease !== current) resetSimilarityCache(current);
		if (similarityCache.has(index)) return;
		try {
			similarityCache.set(
				index,
				calculateSimilarProfiles({
					population: current.population,
					sigmaZ: current.manifest.model.sigma_z,
					selectedIndex: index,
					featureOrder: current.manifest.model.features
				})
			);
		} catch {
			// Similarity is an optional enrichment. A bad covariance must not hide the base inspector.
			similarityCache.set(index, []);
		}
	}

	function authorBookSummaryIdentity(book: AuthorBook): BookSummaryIdentity {
		return { bookUlid: book.bookUlid, title: book.title };
	}

	function currentPageUrl(): string {
		if (browser) return `${window.location.pathname}${window.location.search}`;
		return `${get(page).url.pathname}${get(page).url.search}`;
	}

	function loadAuthorBookSummary(
		identity: BookSummaryIdentity,
		trigger: HTMLElement,
		requestId: number
	): void {
		void catalogLoader
			.load(identity.bookUlid)
			.then((book) => {
				if (
					requestId !== bookSummaryRequestSequence ||
					bookSummaryState.kind !== 'loading' ||
					bookSummaryState.identity.bookUlid !== identity.bookUlid
				)
					return;
				bookSummaryState = { kind: 'ready', book, trigger };
			})
			.catch((error: unknown) => {
				console.error('[author-prominence] book summary load failed', {
					bookUlid: identity.bookUlid,
					error
				});
				if (
					requestId !== bookSummaryRequestSequence ||
					bookSummaryState.kind !== 'loading' ||
					bookSummaryState.identity.bookUlid !== identity.bookUlid
				)
					return;
				bookSummaryState = {
					kind: 'error',
					identity,
					message: t('shared.bookSummary.unavailable'),
					trigger
				};
			});
	}

	function openAuthorBookSummary(book: AuthorBook, trigger: HTMLButtonElement): void {
		if (!browser) return;
		if (bookSummaryState.kind !== 'closed') {
			bookSummaryRequestSequence += 1;
			bookSummaryState = { kind: 'closed' };
			clearBookSummarySheetHistory(bookSummaryOwnerId);
		}
		const identity = authorBookSummaryIdentity(book);
		bookSummaryRestoreFocus = true;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- retain the current author/lens URL for the shallow sheet entry
		pushState(currentPageUrl(), {
			...(get(page).state as App.PageState),
			bookSummarySheet: { ownerId: bookSummaryOwnerId, bookUlid: identity.bookUlid }
		});
		bookSummarySheetHistory.set({
			ownerId: bookSummaryOwnerId,
			bookUlid: identity.bookUlid,
			applyClose: () => {
				void closeAuthorBookSummary({ skipFlyOut: true, fromHistoryApply: true });
			}
		});
		const requestId = ++bookSummaryRequestSequence;
		bookSummaryState = { kind: 'loading', identity, trigger };
		loadAuthorBookSummary(identity, trigger, requestId);
	}

	async function closeAuthorBookSummary(options?: BookSummarySheetCloseOptions): Promise<void> {
		const current = bookSummaryState;
		if (current.kind === 'closed') return;
		const pageSheet = browser ? (get(page).state as App.PageState).bookSummarySheet : undefined;
		const ownsHistoryMarker = ownsBookSummarySheet(pageSheet, bookSummaryOwnerId);
		const ownsHistoryEntry =
			ownsHistoryMarker && ownsBookSummarySheet(get(bookSummarySheetHistory), bookSummaryOwnerId);
		bookSummaryRequestSequence += 1;
		bookSummaryState = { kind: 'closed' };

		if (options?.fromHistoryApply || !ownsHistoryEntry || !browser) {
			if (!options?.fromHistoryApply && ownsHistoryMarker && !ownsHistoryEntry) {
				stripOwnedBookSummaryMarker();
			}
			clearBookSummarySheetHistory(bookSummaryOwnerId);
		} else {
			// UI close consumes the shallow entry through Back; the popstate handler applies the inert close.
			await consumeBookSummaryHistoryEntry(bookSummaryOwnerId);
		}
	}

	function retryAuthorBookSummary(): void {
		if (bookSummaryState.kind !== 'error') return;
		const { identity, trigger } = bookSummaryState;
		const requestId = ++bookSummaryRequestSequence;
		bookSummaryState = { kind: 'loading', identity, trigger };
		loadAuthorBookSummary(identity, trigger, requestId);
	}

	async function handleAuthorBookSummarySearch(author: string): Promise<void> {
		const query = author.trim();
		bookSummaryRestoreFocus = false;
		try {
			await closeAuthorBookSummary();
			await tick();
			if (!query) return;
			searchQuery = query;
			searchFocused = true;
			searchActiveOption = -1;
			await tick();
			document.getElementById('author-search')?.focus({ preventScroll: true });
		} finally {
			bookSummaryRestoreFocus = true;
		}
	}

	function stripOwnedBookSummaryMarker(): void {
		if (!browser) return;
		const currentState = get(page).state as App.PageState;
		if (!ownsBookSummarySheet(currentState.bookSummarySheet, bookSummaryOwnerId)) return;
		const nextState = { ...currentState };
		delete nextState.bookSummarySheet;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- remove this page's marker during navigation cleanup
		replaceState(currentPageUrl(), nextState);
		clearBookSummarySheetHistory(bookSummaryOwnerId);
	}

	const authorProminencePath = resolve('/lab/author-prominence');
	let replacingSummaryNavigation = false;
	beforeNavigate(({ from, to, willUnload, cancel }) => {
		if (
			!browser ||
			replacingSummaryNavigation ||
			from?.url.pathname !== authorProminencePath ||
			to?.url.pathname === authorProminencePath
		)
			return;
		const hasOpenSummary = bookSummaryState.kind !== 'closed';
		void closeAuthorBookSummary({ skipFlyOut: true, fromHistoryApply: true });
		stripOwnedBookSummaryMarker();

		if (!hasOpenSummary || willUnload || !to?.url) return;
		// Replace the shallow sheet entry with the destination so returning with Back lands on the
		// underlying author state instead of an identical, markerless sheet entry.
		cancel();
		replacingSummaryNavigation = true;
		window.location.replace(to.url);
	});

	function handleAuthorBookSummaryBookmark(book: Book): void {
		toggleBookmarked(book);
	}

	function handleAuthorBookSummaryRating(book: Book, value: RatingValue): void {
		setBookRating(book, value);
	}

	function handleAuthorBookSummaryRemoveRating(book: Book): void {
		removeBookRating(book);
	}

	function handleAuthorBookSummaryNotInterested(book: Book): void {
		toggleNotInterested(book);
	}

	function resetDetailState(): void {
		detailRequestSequence += 1;
		selectedDetail = null;
		detailStatus = 'loading';
	}

	function loadSelectedDetail(index: number, retry = false): void {
		const repository = detailRepository;
		if (!repository) return;
		const requestId = ++detailRequestSequence;
		selectedDetail = null;
		detailStatus = 'loading';
		void (async () => {
			try {
				const detail = retry
					? await repository.retryAuthor(index)
					: await repository.getAuthorDetail(index);
				if (requestId !== detailRequestSequence || selected !== index) return;
				selectedDetail = detail;
				detailStatus = 'ready';
			} catch (error) {
				if (requestId !== detailRequestSequence || selected !== index) return;
				detailStatus = 'error';
				if (import.meta.env.DEV) console.warn('[author-prominence] detail load failed', error);
			}
		})();
	}

	function beginSelectedEnrichment(index: number): void {
		if (!release) return;
		ensureStandings(release);
		ensureSimilarity(index);
		loadSelectedDetail(index);
	}

	function retrySelectedDetail(): void {
		if (selected !== null) loadSelectedDetail(selected, true);
	}

	function clearRankingProgressTimers(): void {
		if (rankingProgressShowTimer !== null) clearTimeout(rankingProgressShowTimer);
		if (rankingProgressHideTimer !== null) clearTimeout(rankingProgressHideTimer);
		rankingProgressShowTimer = null;
		rankingProgressHideTimer = null;
	}

	function hideRankingProgress(): void {
		clearRankingProgressTimers();
		rankingProgressVisible = false;
	}

	function scheduleRankingProgress(): void {
		clearRankingProgressTimers();
		rankingProgressVisible = false;
		rankingProgressShowTimer = setTimeout(() => {
			rankingProgressShowTimer = null;
			if (rankingUpdating && activeGesture?.status !== 'active') {
				rankingProgressVisible = true;
				rankingProgressShownAt = performance.now();
			}
		}, RANKING_PROGRESS_DELAY_MS);
	}

	function finishRankingProgress(): void {
		if (rankingProgressShowTimer !== null) clearTimeout(rankingProgressShowTimer);
		rankingProgressShowTimer = null;
		if (!rankingProgressVisible) return;
		const elapsed = performance.now() - rankingProgressShownAt;
		const remaining = RANKING_PROGRESS_MIN_VISIBLE_MS - elapsed;
		if (remaining <= 0) {
			rankingProgressVisible = false;
			return;
		}
		if (rankingProgressHideTimer !== null) clearTimeout(rankingProgressHideTimer);
		rankingProgressHideTimer = setTimeout(() => {
			rankingProgressHideTimer = null;
			rankingProgressVisible = false;
		}, remaining);
	}

	function invalidateRankingPublication(resetThrottle = true): void {
		publicationController?.invalidate(resetThrottle);
		hideRankingProgress();
		publishedOrderChanged = false;
		publishedMotionIntent = 'none';
		publishedMotionRevision = 0;
		if (rankingFrame !== null) cancelAnimationFrame(rankingFrame);
		rankingFrame = null;
	}

	function applyRankingResult(result: RankingResult): void {
		rankingResult = result;
		if (release) scheduleStandings(release);
		if (pendingUrlInspectorFocus && selected !== null) {
			pendingUrlInspectorFocus = false;
			void tick().then(focusInspector);
		}
		if (
			committedLens &&
			!draftLens &&
			sameWeights(result.weights, committedLens.weights) &&
			result.selectedIndex === selected
		)
			acknowledgedRanking = cloneRankingResult(result);
	}

	function orderFor(result: RankingResult): number[] {
		return Array.from(result.top250.slice(0, result.topN));
	}

	function publishRankingResult(
		result: RankingResult,
		intent: PublicationMotionIntent = 'none'
	): void {
		const nextOrder = orderFor(result);
		const comparisonOrder = intent === 'live' ? publishedOrder : committedPublishedOrder;
		publishedOrderChanged =
			comparisonOrder.length > 0 &&
			(nextOrder.length !== comparisonOrder.length ||
				nextOrder.some((index, position) => index !== comparisonOrder[position]));
		publishedOrder = nextOrder;
		if (intent !== 'live') committedPublishedOrder = nextOrder;
		publishedMotionIntent = intent;
		publishedMotionRevision = result.revision;
		withProminenceTiming('reactive-update', () => applyRankingResult(result));
		finishRankingProgress();
	}

	publicationController = new PublicationController({ onPublish: publishRankingResult });

	function receiveRankingResult(result: RankingResult): void {
		publicationController.receive(result, activeGesture?.status === 'active');
	}

	function committedRankingSnapshot(): RankingResult | null {
		if (!acknowledgedRanking || !committedLens) return null;
		if (acknowledgedRanking.selectedIndex !== selected) return null;
		if (!sameWeights(acknowledgedRanking.weights, committedLens.weights)) return null;
		return cloneRankingResult(acknowledgedRanking);
	}

	function beginGesture(source: GestureSource): void {
		if (!release || !committedLens || (activeGesture && activeGesture.status === 'active')) return;
		invalidateRankingPublication();
		const baseline = committedRankingSnapshot();
		activeGesture = beginLensGesture(++gestureSequence, source, committedLens, baseline);
	}

	function lensAnnouncement(prefix: string, lens: LensState): void {
		announcement = `${prefix} Shares: ${lens.displayShares.join(', ')}%.`;
	}

	function cancelGesture(): void {
		if (!release || !activeGesture || activeGesture.status !== 'active') return;
		const cancelled = cancelLensGesture(activeGesture);
		invalidateRankingPublication();
		activeGesture = cancelled.gesture;
		committedLens = cancelled.lens;
		draftLens = null;
		cancelToken += 1;
		const startingRanking = cancelled.gesture.startingRanking;
		const hasKnownBaseline = Boolean(startingRanking);
		if (startingRanking)
			publicationController.publishKnownSnapshot(cloneRankingResult(startingRanking), 'restore');
		activeGesture = null;
		requestRanking(true, cancelled.lens.weights, hasKnownBaseline ? 'none' : 'restore');
		lensAnnouncement('Lens restored.', cancelled.lens);
	}

	function handleLensChange(
		next: number[],
		phase: 'start' | 'move' | 'end',
		preferredIndex?: number,
		source: GestureSource = 'triangle'
	): void {
		if (!release || !committedLens) return;
		const currentRelease = release;
		const pointerMark = prominenceTimingMark('pointer');
		if (phase === 'start') beginGesture(source);
		if (!activeGesture || activeGesture.status !== 'active' || activeGesture.source !== source) {
			prominenceTimingMeasure('pointer', pointerMark);
			return;
		}
		activeGesture = withProminenceTiming('lens-derivation', () =>
			updateLensGesture(activeGesture!, currentRelease.manifest, next, preferredIndex)
		);
		draftLens = activeGesture.currentDraft;
		if (phase !== 'end') {
			requestRanking(false, activeGesture.currentDraft.weights);
			prominenceTimingMeasure('pointer', pointerMark);
			return;
		}
		const committed = withProminenceTiming('settlement', () =>
			commitLensGesture(activeGesture!, currentRelease.manifest)
		);
		invalidateRankingPublication();
		activeGesture = committed.gesture;
		committedLens = committed.lens;
		draftLens = null;
		activeGesture = null;
		requestRanking(true, committed.lens.weights, 'commit');
		commitUrl('replace');
		if (source === 'keyboard') lensAnnouncement('Lens updated.', committed.lens);
		prominenceTimingMeasure('pointer', pointerMark);
	}

	function handleLensCancel(source: GestureSource): void {
		if (activeGesture && activeGesture.source !== source) return;
		cancelGesture();
	}

	function restoreBalanced(): void {
		if (!release || !committedLens) return;
		const currentLens = draftLens ?? committedLens;
		if (!activeGesture && sameWeights(currentLens.weights, release.settledPreset.weights)) return;
		const baseline = committedRankingSnapshot();
		invalidateRankingPublication();
		committedLens = lensState(release.manifest, release.settledPreset.weights, {
			presets: release.manifest.presets,
			presetId: PUBLIC_PRESET_NAME,
			comparisonBaselineName: baseline?.lens.displayName ?? null,
			settled: true
		});
		draftLens = null;
		activeGesture = null;
		cancelToken += 1;
		requestRanking(true, committedLens.weights, 'preset');
		commitUrl('push');
		lensAnnouncement(`${PUBLIC_PRESET_NAME} selected.`, committedLens);
	}

	function setMapHover(index: number | null): void {
		if (index === null) {
			if (hoveredSource === 'map') {
				hovered = null;
				hoveredSource = null;
			}
			return;
		}
		hovered = index;
		hoveredSource = 'map';
	}

	function setRankingHover(index: number | null): void {
		if (index === null) {
			if (hoveredSource === 'ranking') {
				hovered = null;
				hoveredSource = null;
			}
			return;
		}
		hovered = index;
		hoveredSource = 'ranking';
	}

	function focusInspector(): void {
		const heading = document.getElementById('inspector-heading');
		if (heading instanceof HTMLElement) heading.focus({ preventScroll: true });
	}

	function useBestMix(): void {
		const currentRelease = release;
		const currentLens = activeLens;
		const currentDetail = selectedDetail;
		if (
			!currentRelease ||
			selected === null ||
			!currentDetail ||
			currentDetail.populationIndex !== selected ||
			!currentLens ||
			sameWeightValues(currentLens.weights, currentDetail.peakWeights)
		)
			return;
		try {
			validateLensWeights(
				currentDetail.peakWeights,
				currentRelease.manifest.model.sigma_z,
				currentRelease.manifest.model.features.length
			);
		} catch {
			return;
		}
		const baseline = committedRankingSnapshot();
		invalidateRankingPublication();
		committedLens = lensState(currentRelease.manifest, currentDetail.peakWeights, {
			presets: currentRelease.manifest.presets,
			comparisonBaselineName: baseline?.lens.displayName ?? null,
			settled: true,
			forceCustom: true
		});
		draftLens = null;
		activeGesture = null;
		cancelToken += 1;
		requestRanking(true, committedLens.weights, 'commit');
		commitUrl('push');
		announcement = `${currentRelease.population.names[selected]} best mix applied.`;
	}

	function setSimilarHover(index: number | null): void {
		if (index === null) {
			if (hoveredSource === 'similar') {
				hovered = null;
				hoveredSource = null;
			}
			return;
		}
		hovered = index;
		hoveredSource = 'similar';
	}

	function selectAuthor(index: number, origin: SelectionOrigin): void {
		if (!release) return;
		if (origin === 'ranking') {
			selectedRankingIndex = index;
			selectedRankingScrollTop = rankingRegion?.scrollTop ?? 0;
		} else selectedRankingIndex = null;
		invalidateRankingPublication();
		selected = index;
		selectionOrigin = origin;
		pendingUrlInspectorFocus = false;
		hovered = null;
		hoveredSource = null;
		searchFocused = false;
		searchActiveOption = -1;
		searchQuery = '';
		announcement = `${release.population.names[index]} selected.`;
		beginSelectedEnrichment(index);
		requestRanking(true, undefined, 'none');
		commitUrl('push');
		if ((origin === 'map' || origin === 'similar') && isMobile) {
			void tick().then(() => rankingRegion?.scrollIntoView({ behavior: 'auto', block: 'start' }));
		}
		void tick().then(focusInspector);
	}

	function selectFromRanking(index: number): void {
		selectAuthor(index, 'ranking');
	}

	function selectFromMap(index: number | null): void {
		if (index !== null) selectAuthor(index, 'map');
	}

	function selectSearchResult(index: number): void {
		selectAuthor(index, 'search');
	}

	function selectSimilar(index: number): void {
		selectAuthor(index, 'similar');
	}

	function clearSelection(): void {
		if (selected === null) return;
		const origin = selectionOrigin;
		const selectedAuthor = selectedRankingIndex ?? selected;
		const previousScrollTop = selectedRankingScrollTop;
		invalidateRankingPublication();
		selected = null;
		pendingUrlInspectorFocus = false;
		resetDetailState();
		selectedRankingIndex = null;
		selectionOrigin = null;
		searchQuery = '';
		searchFocused = false;
		searchActiveOption = -1;
		hovered = null;
		hoveredSource = null;
		requestRanking(true, undefined, 'none');
		commitUrl('push');
		void tick().then(() => {
			if (origin === 'url') {
				document.getElementById('author-search')?.focus({ preventScroll: true });
				return;
			}
			if (origin === 'ranking') {
				if (rankingRegion) rankingRegion.scrollTop = previousScrollTop;
				const row = Array.from(
					rankingRegion?.querySelectorAll<HTMLButtonElement>('.ranking-row__select') ?? []
				).find((button) => Number(button.dataset.authorIndex) === selectedAuthor);
				(row ?? rankingRegion?.querySelector<HTMLButtonElement>('.ranking-row__select'))?.focus({
					preventScroll: true
				});
			} else if (origin === 'map') {
				document.querySelector<HTMLCanvasElement>('.prominence-field__overlay')?.focus({
					preventScroll: true
				});
			} else if (origin === 'search') {
				document.getElementById('author-search')?.focus({ preventScroll: true });
			} else if (origin === 'similar') {
				const row = Array.from(
					rankingRegion?.querySelectorAll<HTMLButtonElement>('.ranking-row__select') ?? []
				).find((button) => Number(button.dataset.authorIndex) === selectedAuthor);
				(row ?? document.getElementById('author-search'))?.focus({ preventScroll: true });
			}
		});
	}

	function parseUrlState(): void {
		if (!release || typeof window === 'undefined') return;
		const state = parseProminenceUrl(
			window.location.search,
			release.manifest,
			release.population,
			release.manifest.model.sigma_z
		);
		committedLens = state.lens;
		draftLens = null;
		selected = state.selectedIndex;
		selectionOrigin = state.selectedIndex === null ? null : 'url';
		selectedRankingIndex = null;
		selectedRankingScrollTop = 0;
		hovered = null;
		hoveredSource = null;
		searchQuery = '';
		searchFocused = false;
		searchActiveOption = -1;
		activeGesture = null;
		pendingUrlInspectorFocus = state.selectedIndex !== null;
		cancelToken += 1;
		if (state.invalidLens) {
			announcement = 'The URL lens was invalid. Restored the tested default lens.';
			commitUrl('replace');
		}
	}

	function commitUrl(mode: 'push' | 'replace'): void {
		if (!release || !committedLens || typeof window === 'undefined') return;
		const state: ProminenceUrlState = { lens: committedLens, selectedIndex: selected };
		const href = withProminenceTiming('url-serialization', () =>
			serializeProminenceUrl(
				window.location.href,
				resolve('/lab/author-prominence'),
				state,
				release!.manifest,
				release!.population
			)
		);
		const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
		if (href === current) return;
		// `href` already contains resolve()'s configured base path.
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- href was built with resolve()
		(mode === 'push' ? pushState : replaceState)(href, {});
	}

	function requestRanking(
		definitive = false,
		weightsOverride?: number[],
		motionIntent: PublicationMotionIntent = definitive ? 'commit' : 'live'
	): void {
		const weights = weightsOverride ?? activeLens?.weights;
		if (!weights || !rankingClient) return;
		try {
			validateLensWeights(
				weights,
				release?.manifest.model.sigma_z ?? [],
				release?.manifest.model.features.length ?? 0
			);
		} catch (error) {
			if (activeGesture?.status === 'active') {
				cancelGesture();
				return;
			}
			rankingError = describeError(error);
			return;
		}
		if (definitive) {
			scheduleRankingProgress();
			if (rankingFrame !== null) cancelAnimationFrame(rankingFrame);
			rankingFrame = null;
			rankingClient.request(weights.slice(), selected, (revision) =>
				publicationController.registerRequest(revision, motionIntent)
			);
			return;
		}
		hideRankingProgress();
		if (rankingFrame !== null || typeof window === 'undefined') return;
		rankingFrame = requestAnimationFrame(() => {
			rankingFrame = null;
			const latest = activeLens?.weights ?? weightsOverride;
			if (!latest || !rankingClient) return;
			rankingClient.request(latest.slice(), selected, (revision) =>
				publicationController.registerRequest(revision, 'live')
			);
		});
	}

	function handleSearchMove(index: number): void {
		searchActiveOption = index;
	}

	function handleSearchQuery(value: string): void {
		searchQuery = value;
		searchFocused = true;
		searchActiveOption = value.trim() && searchMatches.length ? 0 : -1;
	}

	function syncMobileMode(): void {
		const next = window.matchMedia('(max-width: 900px)').matches;
		if (next === isMobile) return;
		if (!next) closeLensSheet(false);
		isMobile = next;
	}

	function openLensSheet(): void {
		if (!isMobile) return;
		lensSheetOpen = true;
	}

	function closeLensSheet(restoreFocus = true): void {
		if (lensDialog?.open) lensDialog.close();
		lensSheetOpen = false;
		if (restoreFocus)
			void tick().then(() => {
				if (summaryButton instanceof HTMLElement) summaryButton.focus({ preventScroll: true });
			});
	}

	function handleLensDialogClose(): void {
		lensSheetOpen = false;
		void tick().then(() => {
			if (summaryButton instanceof HTMLElement) summaryButton.focus({ preventScroll: true });
		});
	}

	function handleLensDialogKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		if (activeGesture?.status === 'active') {
			event.preventDefault();
			event.stopPropagation();
			cancelGesture();
		} else {
			// Let the native dialog close itself, but keep the page-level Escape handler out of it.
			event.stopPropagation();
		}
	}

	function handleLensDialogClick(event: MouseEvent): void {
		if (event.target === event.currentTarget) closeLensSheet();
	}

	function syncMotionPreference(): void {
		reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	}

	function describeError(error: unknown): string {
		return error instanceof Error &&
			(error.name === 'ProminenceFormatError' || error.name === 'ProminenceScoringError')
			? t('lab.authorProminence.errors.format')
			: t('lab.authorProminence.errors.load');
	}

	function start(): void {
		closeAuthorBookSummary({ skipFlyOut: true, fromHistoryApply: true });
		clearBookSummarySheetHistory(bookSummaryOwnerId);
		catalogLoader.destroy();
		loadError = null;
		rankingError = null;
		const requestGeneration = ++lifecycleGeneration;
		invalidateRankingPublication();
		rankingClient?.destroy();
		detailRepository?.clear();
		detailRepository = null;
		rankingClient = null;
		release = null;
		committedLens = null;
		draftLens = null;
		selected = null;
		selectionOrigin = null;
		resetDetailState();
		clearStandingsTimer();
		dimensionStandings = null;
		standingsRelease = null;
		resetSimilarityCache();
		rankingResult = null;
		acknowledgedRanking = null;
		immediateSelectedCache = null;
		publicationController.reset();
		publishedOrder = [];
		committedPublishedOrder = [];
		publishedOrderChanged = false;
		void loadRelease()
			.then((loaded) => {
				if (!mounted || requestGeneration !== lifecycleGeneration) return;
				release = loaded;
				detailRepository = new AuthorDetailRepository({
					base: loaded.base,
					webRoot: loaded.webRoot,
					manifest: loaded.manifest,
					populationCount: loaded.population.count
				});
				committedLens = defaultLens(loaded.manifest);
				draftLens = null;
				searchIndex = buildAuthorSearchIndex(loaded.population.names);
				parseUrlState();
				rankingResult = null;
				acknowledgedRanking = null;
				rankingClient = new RankingClient({
					onResult: receiveRankingResult,
					onStatus: (status) => (rankingStatus = status),
					onDiagnostic: ({ kind }) => {
						if (import.meta.env.DEV) console.info(`[author-prominence] ${kind}`);
					},
					onFatal: (error) => {
						rankingError = describeError(error);
					}
				});
				rankingClient.start(
					loaded.population,
					loaded.manifest.model.sigma_z,
					loaded.settledPreset,
					loaded.manifest.display.top_n
				);
				if (selected !== null) beginSelectedEnrichment(selected);
				requestRanking(true, undefined, 'none');
			})
			.catch((error) => {
				if (mounted && requestGeneration === lifecycleGeneration) loadError = describeError(error);
			});
	}

	function handleEscape(): void {
		if (activeGesture?.status === 'active') cancelGesture();
		else if (selected !== null) clearSelection();
	}

	$effect(() => {
		if (!release) {
			footerSupplement?.clear(footerSupplementOwner);
			return;
		}
		footerSupplement?.set(
			footerSupplementOwner,
			t('lab.authorProminence.about.release', { version: release.manifest.version })
		);
	});

	$effect(() => {
		if (!lensSheetOpen || !isMobile) return;
		void tick().then(() => {
			if (lensDialog && !lensDialog.open) lensDialog.showModal();
			lensDialog
				?.querySelector<SVGSVGElement>('.prominence-lens-control__triangle')
				?.focus({ preventScroll: true });
		});
	});

	onDestroy(() => {
		closeAuthorBookSummary({ skipFlyOut: true, fromHistoryApply: true });
		stripOwnedBookSummaryMarker();
		clearBookSummarySheetHistory(bookSummaryOwnerId);
		catalogLoader.destroy();
		footerSupplement?.clear(footerSupplementOwner);
	});

	onMount(() => {
		mounted = true;
		start();
		syncMobileMode();
		syncMotionPreference();
		const onResize = () => syncMobileMode();
		const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		const onMotionChange = (event: MediaQueryListEvent) => (reducedMotion = event.matches);
		const onPopState = () => {
			const bookHistory = get(bookSummarySheetHistory);
			if (bookHistory && ownsBookSummarySheet(bookHistory, bookSummaryOwnerId)) {
				bookHistory.applyClose();
				clearBookSummarySheetHistory(bookSummaryOwnerId);
				return;
			}
			if (!release) return;
			const state = get(page).state as App.PageState;
			if (state.bookSummarySheet) {
				if (bookHistory) return;
				const next = { ...state };
				delete next.bookSummarySheet;
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- remove an orphaned shallow sheet state on the current URL
				replaceState(currentPageUrl(), next);
				return;
			}
			rankingError = null;
			invalidateRankingPublication();
			parseUrlState();
			if (selected !== null) beginSelectedEnrichment(selected);
			else resetDetailState();
			acknowledgedRanking = null;
			requestRanking(true, undefined, 'restore');
		};
		const onKeydown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			if (railContent?.contains(event.target as Node | null) && searchFocused) return;
			handleEscape();
		};
		window.addEventListener('resize', onResize);
		window.addEventListener('popstate', onPopState);
		window.addEventListener('keydown', onKeydown);
		motionQuery.addEventListener('change', onMotionChange);
		return () => {
			mounted = false;
			lifecycleGeneration += 1;
			invalidateRankingPublication();
			window.removeEventListener('resize', onResize);
			window.removeEventListener('popstate', onPopState);
			window.removeEventListener('keydown', onKeydown);
			motionQuery.removeEventListener('change', onMotionChange);
			rankingClient?.destroy();
		};
	});
</script>

<svelte:head>
	<title>{t('lab.authorProminence.title')} - {t('shared.header.siteName')}</title>
	<meta
		name="description"
		content="Aim a prominence lens across reader regard, audience reach, and critical recognition. The ranking follows."
	/>
</svelte:head>

<div class="prominence-page" data-ranking-status={rankingStatus}>
	<header class="prominence-hero">
		<div class="prominence-hero__copy">
			<p class="prominence-kicker">Unread Lab / Observatory 01</p>
			<h1>Author prominence</h1>
			<p class="prominence-hero__lead">
				A map of {release && display ? display.count.toLocaleString() : 'eligible'} authors across
				{display
					? display.features.map((feature) => feature.label.toLocaleLowerCase()).join(', ')
					: 'the release features'}.
			</p>
		</div>
		{#if release}
			<ProminenceMethod
				manifest={release.manifest}
				open={methodOpen}
				onToggle={(open) => (methodOpen = open)}
			/>
		{/if}
	</header>

	{#if loadError || rankingError}
		<section class="prominence-state" role="alert">
			<div>
				<p class="eyebrow">Release unavailable</p>
				<h2>{loadError ?? rankingError}</h2>
				<p>
					{rankingError
						? 'The exact ranking could not be computed in this browser. Try loading the release again.'
						: 'The observatory shell is ready, but this release could not be parsed. Try loading it again.'}
				</p>
			</div>
			<button type="button" class="prominence-button" onclick={start}
				>{t('lab.authorProminence.errors.retry')}</button
			>
		</section>
	{:else if !release || !activeLens || !display || !rankingResult}
		<section class="prominence-loading" aria-busy="true">
			<div class="prominence-loading__scene"></div>
			<div class="prominence-loading__rail">
				<Spinner />
				<p>Loading the author field...</p>
			</div>
		</section>
	{:else}
		{#snippet authorSearch()}
			<ProminenceSearch
				count={display.count}
				names={release!.population.names}
				{rankByIndex}
				matches={searchMatches}
				query={searchQuery}
				focused={searchFocused}
				activeOption={searchActiveOption}
				onQuery={handleSearchQuery}
				onFocus={() => (searchFocused = true)}
				onClose={() => {
					searchFocused = false;
					searchActiveOption = -1;
				}}
				onMove={handleSearchMove}
				onSelect={selectSearchResult}
				onClear={() => {
					searchQuery = '';
					searchActiveOption = -1;
				}}
			/>
		{/snippet}

		<div class="prominence-workbench">
			<section class="prominence-scene-panel" aria-label="Author prominence field">
				<div class="prominence-map-stack">
					<ProminenceField
						population={release!.population}
						{display}
						lens={activeLens}
						{topIndices}
						top250Indices={rankingResult.top250}
						rankByIndex={rankingResult.rankByIndex}
						rankBuckets={rankingResult.rankBuckets}
						selectedIndex={selected}
						hoveredIndex={hovered}
						{rankingUpdating}
						{rankingProgressVisible}
						onSelect={selectFromMap}
						onHover={setMapHover}
						onEscape={handleEscape}
						onResetView={restoreBalanced}
					/>
					{#if !isMobile}
						<div class="prominence-map-lens">
							<ProminenceLensControl
								manifest={release!.manifest}
								lens={activeLens!}
								settledPreset={release!.settledPreset}
								{cancelToken}
								onChange={handleLensChange}
								onCancel={handleLensCancel}
								onBalanced={restoreBalanced}
							/>
						</div>
					{/if}
				</div>
			</section>

			<aside class="prominence-rail" aria-label="Author search and ranking">
				{#if isMobile}
					<button
						bind:this={summaryButton}
						type="button"
						class="mobile-lens-summary"
						aria-label={lensSummaryLabel}
						onclick={openLensSheet}
					>
						<span class="mobile-lens-summary__shares">
							{#each display.features as feature, index (feature.key)}
								<span style:color={feature.colour}>{activeLens.displayShares[index] ?? 0}%</span>
							{/each}
						</span>
						<span class="mobile-lens-summary__affordance" aria-hidden="true">⌄</span>
					</button>
				{/if}

				<div class="rail-content" bind:this={railContent}>
					{@render authorSearch()}
					<div class="ranking-region" bind:this={rankingRegion}>
						{#if selected !== null}
							<ProminenceInspector
								selected={selectedSnapshot}
								segments={selectedContributionSegments}
								manifest={release!.manifest}
								features={display.features}
								currentWeights={activeLens.weights}
								detail={selectedDetail}
								{detailStatus}
								standings={dimensionStandings}
								similarProfiles={selectedSimilarProfiles}
								onClear={clearSelection}
								onRetry={retrySelectedDetail}
								onUseBestMix={useBestMix}
								onSelectSimilar={selectSimilar}
								onHoverSimilar={setSimilarHover}
								onOpenBook={openAuthorBookSummary}
							/>
						{:else}
							<ProminenceRanking
								{entries}
								hoveredIndex={hovered}
								updating={rankingUpdating}
								showUpdating={rankingProgressVisible}
								{reducedMotion}
								motionDuration={activeLens.source === 'preset' ? 260 : 150}
								motionIntent={publishedMotionIntent}
								motionRevision={publishedMotionRevision}
								animateRows={publishedOrderChanged}
								onSelect={selectFromRanking}
								onHover={setRankingHover}
							/>
						{/if}
					</div>
				</div>
			</aside>
		</div>
	{/if}

	{#if isMobile && lensSheetOpen}
		<dialog
			bind:this={lensDialog}
			class="mobile-lens-sheet"
			aria-label="Prominence lens control"
			onclose={handleLensDialogClose}
			onkeydown={handleLensDialogKeydown}
			onclick={handleLensDialogClick}
		>
			<div class="mobile-lens-sheet__surface">
				<button
					type="button"
					class="mobile-lens-sheet__close"
					aria-label="Close lens control"
					onclick={() => closeLensSheet()}><span aria-hidden="true">×</span></button
				>
				<ProminenceLensControl
					manifest={release!.manifest}
					lens={activeLens!}
					settledPreset={release!.settledPreset}
					{cancelToken}
					onChange={handleLensChange}
					onCancel={handleLensCancel}
					onBalanced={restoreBalanced}
				/>
			</div>
		</dialog>
	{/if}

	<BookSummarySheet
		state={bookSummaryState}
		restoreFocus={bookSummaryRestoreFocus}
		currentRating={bookSummaryRating}
		bookmarked={bookSummaryBookmarked}
		notInterested={bookSummaryNotInterested}
		onBookmark={handleAuthorBookSummaryBookmark}
		onRate={handleAuthorBookSummaryRating}
		onRemoveRating={handleAuthorBookSummaryRemoveRating}
		onNotInterested={handleAuthorBookSummaryNotInterested}
		onSearchAuthor={handleAuthorBookSummarySearch}
		onClose={closeAuthorBookSummary}
		onRetry={retryAuthorBookSummary}
	/>

	<ScreenReaderOnly aria-live="polite" aria-atomic="true">{announcement}</ScreenReaderOnly>
</div>

<style>
	.prominence-page {
		display: flex;
		flex: 1 1 auto;
		min-height: 0;
		flex-direction: column;
		gap: var(--space-5);
		width: 100%;
		min-width: 0;
		container: author-prominence / inline-size;
		color: #d8eeee;
	}
	.prominence-hero {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		flex-direction: column;
	}
	.prominence-hero__copy {
		max-width: 720px;
	}
	.prominence-kicker,
	.eyebrow {
		margin: 0 0 8px;
		color: rgba(207, 231, 232, 0.62);
		font: 600 11px/1.2 var(--font-family-interactive);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.prominence-hero h1 {
		margin: 0 !important;
		color: #efffff;
		font: 500 clamp(34px, 4vw, 50px)/0.96 var(--font-family-content);
		letter-spacing: -0.035em;
	}
	.prominence-hero__lead {
		max-width: 600px;
		margin: 10px 0 0;
		color: rgba(207, 231, 232, 0.76);
		font: 14px/1.55 var(--font-family-interactive);
	}
	.prominence-workbench {
		display: flex;
		flex: 1 1 auto;
		min-height: 0;
		flex-direction: column;
		gap: var(--space-5);
	}
	.prominence-scene-panel,
	.prominence-rail {
		min-height: 0;
	}
	.prominence-scene-panel {
		display: flex;
		min-width: 0;
		flex-direction: column;
	}
	.prominence-map-stack {
		position: relative;
		flex: 1 1 auto;
		min-height: 0;
		width: 100%;
	}
	:global(.prominence-map-stack > .prominence-field) {
		height: 100%;
		min-height: 0;
	}
	.prominence-map-lens {
		position: absolute;
		right: 18px;
		bottom: 64px;
		z-index: 5;
		width: clamp(220px, 19vw, 260px);
		pointer-events: none;
	}
	.prominence-map-lens::before {
		position: absolute;
		z-index: -1;
		inset: -22px -24px -18px;
		content: '';
		background: radial-gradient(
			ellipse at center,
			rgba(5, 12, 12, 0.64) 0%,
			rgba(5, 12, 12, 0.34) 48%,
			transparent 78%
		);
		pointer-events: none;
	}
	.prominence-rail {
		display: flex;
		min-width: 0;
		flex-direction: column;
		overflow: visible;
	}
	.rail-content {
		display: flex;
		flex: 1 1 auto;
		min-height: 0;
		flex-direction: column;
		padding: 0 2px 4px 0;
		overflow: visible;
		scrollbar-color: rgba(164, 204, 206, 0.25) transparent;
	}
	.ranking-region {
		min-height: 0;
		flex: 1 1 auto;
		overflow: auto;
		padding-right: 2px;
		scrollbar-color: rgba(164, 204, 206, 0.25) transparent;
	}
	.prominence-loading {
		display: grid;
		flex: 1 1 auto;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-5);
		min-height: 0;
	}
	.prominence-loading__scene {
		min-height: 0;
		border: 1px solid rgba(164, 204, 206, 0.15);
		border-radius: 14px;
		background: radial-gradient(circle at 45% 40%, #142525, #081010 70%);
	}
	.prominence-loading__rail {
		display: grid;
		place-content: center;
		justify-items: center;
		color: rgba(207, 231, 232, 0.68);
		font: 14px var(--font-family-interactive);
	}
	.prominence-state {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		padding: 30px;
		border: 1px solid rgba(224, 165, 47, 0.3);
		border-radius: 12px;
		background: rgba(64, 48, 19, 0.15);
	}
	.prominence-state h2 {
		margin: 0;
		color: #efffff;
		font: 500 28px var(--font-family-content);
	}
	.prominence-state p:last-child {
		color: rgba(207, 231, 232, 0.68);
		font: 14px var(--font-family-interactive);
	}
	.prominence-button {
		min-height: 44px;
		padding: 10px 15px;
		border: 1px solid rgba(207, 231, 232, 0.4);
		border-radius: 6px;
		background: transparent;
		color: #efffff;
		cursor: pointer;
		font: 13px var(--font-family-interactive);
	}
	.mobile-lens-summary,
	.mobile-lens-sheet {
		display: none;
	}

	@media (min-width: 901px) {
		.prominence-hero {
			align-items: center;
			flex-direction: row;
			gap: var(--space-5);
		}
		.prominence-workbench {
			display: grid;
			grid-template-columns: minmax(0, 58fr) minmax(0, 42fr);
			grid-template-rows: minmax(0, 1fr);
			grid-template-areas: 'scene rail';
			column-gap: var(--space-5);
			align-items: stretch;
		}
		.prominence-scene-panel {
			grid-area: scene;
			height: 100%;
		}
		.prominence-rail {
			grid-area: rail;
			height: 100%;
		}
		.prominence-loading {
			grid-template-columns: minmax(0, 58fr) minmax(0, 42fr);
		}
	}
	@media (min-width: 901px) and (max-width: 1119px) {
		.prominence-map-lens {
			width: 210px;
		}
	}
	@media (max-width: 900px) {
		.prominence-scene-panel {
			height: clamp(20rem, 56vh, 36rem);
		}
		.prominence-map-stack {
			height: 100%;
		}
		.rail-content {
			display: block;
			overflow: visible;
			padding: 5px 0 0;
		}
		.ranking-region {
			overflow: visible;
		}
		.mobile-lens-summary {
			display: flex;
			align-items: center;
			justify-content: space-between;
			width: 100%;
			min-height: 46px;
			margin: 8px 0 0;
			padding: 8px 11px;
			border: 1px solid rgba(164, 204, 206, 0.22);
			border-radius: 7px;
			background: transparent;
			color: #efffff;
			cursor: pointer;
		}
		.mobile-lens-summary:focus-visible {
			outline: 2px solid var(--color-focus);
			outline-offset: 3px;
		}
		.mobile-lens-summary__shares {
			display: inline-flex;
			gap: 12px;
			font: 650 13px var(--font-family-interactive);
			font-variant-numeric: tabular-nums;
		}
		.mobile-lens-summary__affordance {
			color: rgba(207, 231, 232, 0.68);
			font-size: 20px;
			line-height: 1;
		}
		.mobile-lens-sheet {
			position: fixed;
			inset: auto 0 0;
			display: block;
			width: 100%;
			max-width: none;
			max-height: min(92vh, 560px);
			margin: 0;
			padding: 0;
			border: 1px solid rgba(164, 204, 206, 0.24);
			border-bottom: 0;
			border-radius: 15px 15px 0 0;
			background: #0e1b1b;
			color: #d8eeee;
		}
		.mobile-lens-sheet::backdrop {
			background: rgba(4, 10, 10, 0.66);
		}
		.mobile-lens-sheet__surface {
			position: relative;
			max-width: 440px;
			margin: 0 auto;
			padding: 30px 22px 22px;
		}
		.mobile-lens-sheet__close {
			position: absolute;
			top: 9px;
			right: 10px;
			display: grid;
			width: 36px;
			height: 36px;
			place-items: center;
			padding: 0;
			border: 0;
			background: transparent;
			color: rgba(207, 231, 232, 0.7);
			font-size: 24px;
			line-height: 1;
			cursor: pointer;
		}
		.mobile-lens-sheet__close:focus-visible {
			outline: 2px solid var(--color-focus);
			outline-offset: 2px;
			border-radius: 4px;
		}
	}
	@media (max-width: 600px) {
		.prominence-hero h1 {
			font-size: 39px;
		}
		.prominence-hero__lead {
			font-size: 14px;
		}
	}
	@media (min-width: 901px) and (max-height: 920px) {
		.prominence-hero__lead {
			display: none;
		}
		.prominence-hero h1 {
			font-size: 44px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.prominence-page * {
			scroll-behavior: auto !important;
		}
	}
</style>
