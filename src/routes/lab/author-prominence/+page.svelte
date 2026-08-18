<script lang="ts">
	import { pushState, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onDestroy, onMount, tick } from 'svelte';
	import ProminenceField from '$lib/components/lab/ProminenceField.svelte';
	import ProminenceInspector from '$lib/components/lab/ProminenceInspector.svelte';
	import ProminenceLensMixer from '$lib/components/lab/ProminenceLensMixer.svelte';
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
	import { defaultLens, lensState, type LensState } from '$lib/lab/author-prominence/lens';
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
	import { auditBadges, formatScore } from '$lib/lab/author-prominence/score';
	import { validateLensWeights } from '$lib/lab/author-prominence/simplex';
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
		ContributionRow,
		RankingEntry,
		SelectedAuthorSnapshot
	} from '$lib/lab/author-prominence/presentation';
	import {
		parseProminenceUrl,
		serializeProminenceUrl,
		type ProminenceUrlState
	} from '$lib/lab/author-prominence/url-state';

	let release = $state.raw<Release | null>(null);
	let loadError = $state<string | null>(null);
	let rankingError = $state<string | null>(null);
	let committedLens = $state.raw<LensState | null>(null);
	let draftLens = $state.raw<LensState | null>(null);
	let selected = $state<number | null>(null);
	let hovered = $state<number | null>(null);
	let searchQuery = $state('');
	let searchFocused = $state(false);
	let searchActiveOption = $state(-1);
	let methodOpen = $state(false);
	let rankingResult = $state.raw<RankingResult | null>(null);
	let acknowledgedRanking = $state.raw<RankingResult | null>(null);
	let comparisonSnapshot = $state.raw<RankingResult | null>(null);
	let activeGesture = $state<LensGesture | null>(null);
	let gestureSequence = 0;
	let cancelToken = $state(0);
	let rankingClient: RankingClient | null = null;
	let rankingStatus = $state<RankingClientStatus>('starting');
	let searchIndex = $state<AuthorSearchEntry[]>([]);
	let announcement = $state('');
	let mobileDestination = $state<'lens' | 'ranking' | 'author'>('ranking');
	let isMobile = $state(false);
	let reducedMotion = $state(false);
	let rankingFrame: number | null = null;
	let publishedMotionIntent = $state<PublicationMotionIntent>('none');
	let publishedMotionRevision = $state(0);
	let publishedOrder = $state<number[]>([]);
	let committedPublishedOrder = $state<number[]>([]);
	let publishedOrderChanged = $state(false);
	let lifecycleGeneration = 0;
	let mounted = false;
	let searchRegion: HTMLDivElement | null = $state(null);
	const footerSupplement = getFooterSupplementContext();
	const footerSupplementOwner = Symbol('author-prominence');
	let publicationController: PublicationController;
	let rankingProgressVisible = $state(false);
	let rankingProgressShowTimer: ReturnType<typeof setTimeout> | null = null;
	let rankingProgressHideTimer: ReturnType<typeof setTimeout> | null = null;
	let rankingProgressShownAt = 0;
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
			immediateSelectedCache = {
				release: current,
				lens,
				selected,
				ranking
			};
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
	const visibleBarScale = $derived.by(() => {
		return immediateRanking?.barScale ?? 1;
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
			const badges = auditBadges(current.population, index, values, current.manifest);
			return {
				index,
				place: position + 1,
				name: current.population.names[index],
				score: formatScore(current.manifest, local?.score ?? 0),
				values,
				badges,
				observation: badges.map((badge) => `${badge.badge}: ${badge.explain}`).join(' '),
				readers: current.population.nReaders[index],
				books: current.population.nBooks[index],
				awards: current.population.nAwards[index],
				tier: current.population.bestTier[index]
			};
		});
	});

	const selectedSnapshot = $derived.by((): SelectedAuthorSnapshot | null => {
		if (!release || selected === null || !immediateRanking?.selected) return null;
		const local = immediateRanking.selected;
		const values = local.values;
		const badges = auditBadges(release.population, selected, values, release.manifest);
		const place = local.place;
		return {
			index: selected,
			name: release.population.names[selected],
			place,
			score: formatScore(release.manifest, local.score),
			values,
			badges,
			readers: release.population.nReaders[selected],
			books: release.population.nBooks[selected],
			awards: release.population.nAwards[selected],
			tier: release.population.bestTier[selected],
			concentration: release.population.concentration[selected]
		};
	});

	const selectedContributionRows = $derived.by((): ContributionRow[] => {
		const current = release;
		const model = display;
		const lens = activeLens;
		const snapshot = selectedSnapshot;
		if (!current || !model || !lens || !snapshot) return [];
		return model.features.map((feature, index) => ({
			feature: feature.key,
			label: feature.label,
			z: current.population.z[index][snapshot.index],
			weight: lens.weights[index] ?? 0,
			displayShare: lens.displayShares[index] ?? 0,
			value: snapshot.values[index] ?? 0,
			width: Math.min(Math.abs(snapshot.values[index] ?? 0) / visibleBarScale, 1) * 50,
			colour: feature.colour
		}));
	});
	const presetProfiles = $derived(
		rankingResult?.selectedIndex === selected ? rankingResult.presetProfiles : []
	);

	const RANKING_PROGRESS_DELAY_MS = 140;
	const RANKING_PROGRESS_MIN_VISIBLE_MS = 360;

	function sameWeights(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
		return sameWeightValues(a, b);
	}

	function sameWeightValues(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
		if (a.length !== b.length) return false;
		for (let index = 0; index < a.length; index++) {
			if (a[index] !== b[index]) return false;
		}
		return true;
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

	/**
	 * End the publication epoch at every gesture/discrete-state boundary. An old timer
	 * callback may still be in the event queue, so clearing the handle alone is not enough.
	 */
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
		comparisonSnapshot = baseline;
	}

	function cancelGesture(): void {
		if (!release || !activeGesture || activeGesture.status !== 'active') return;
		const cancelled = cancelLensGesture(activeGesture);
		invalidateRankingPublication();
		activeGesture = cancelled.gesture;
		committedLens = cancelled.lens;
		draftLens = null;
		comparisonSnapshot = null;
		cancelToken += 1;
		const startingRanking = cancelled.gesture.startingRanking;
		const hasKnownBaseline = Boolean(startingRanking);
		if (startingRanking)
			publicationController.publishKnownSnapshot(cloneRankingResult(startingRanking), 'restore');
		activeGesture = null;
		// The known baseline carries the single restore animation. The definitive request
		// confirms the same snapshot without starting a second animation.
		requestRanking(true, cancelled.lens.weights, hasKnownBaseline ? 'none' : 'restore');
		announcement = `Lens restored to ${cancelled.lens.displayName}.`;
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
		announcement = `${committed.lens.displayName} settled. Shares: ${committed.lens.displayShares.join(', ')}%.`;
		prominenceTimingMeasure('pointer', pointerMark);
	}

	function handleLensCancel(source: GestureSource): void {
		if (activeGesture && activeGesture.source !== source) return;
		cancelGesture();
	}

	function choosePreset(name: string, weights: number[]): void {
		if (!release || !committedLens) return;
		const baseline = committedRankingSnapshot();
		invalidateRankingPublication();
		comparisonSnapshot = baseline;
		committedLens = lensState(release.manifest, weights, {
			presets: release.manifest.presets,
			presetId: name,
			comparisonBaselineName: comparisonSnapshot?.lens.displayName ?? null,
			settled: true
		});
		draftLens = null;
		activeGesture = null;
		cancelToken += 1;
		requestRanking(true, committedLens.weights, 'preset');
		commitUrl('push');
		announcement = `${committedLens.displayName} lens selected. Shares: ${committedLens.displayShares.join(', ')}%.`;
	}

	function selectAuthor(index: number | null): void {
		invalidateRankingPublication();
		selected = index;
		hovered = null;
		searchFocused = false;
		searchActiveOption = -1;
		if (index !== null && release) {
			searchQuery = release.population.names[index];
			mobileDestination = 'author';
			announcement = `${release.population.names[index]} selected.`;
		} else {
			mobileDestination = 'ranking';
			announcement = 'Author selection cleared.';
		}
		requestRanking(true, undefined, 'none');
		commitUrl('push');
		void tick().then(() => {
			const target =
				index === null
					? document.querySelector('#prominence-panel-ranking h2, #ranking-heading')
					: document.querySelector(
							'#prominence-panel-author, [data-testid="prominence-inspector"] h2'
						);
			if (target instanceof HTMLElement) target.focus({ preventScroll: true });
		});
	}

	function selectSearchResult(index: number): void {
		selectAuthor(index);
		searchQuery = release?.population.names[index] ?? '';
	}

	function clearSelection(): void {
		selectAuthor(null);
		searchQuery = '';
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
		hovered = null;
		searchQuery = state.selectedIndex === null ? '' : release.population.names[state.selectedIndex];
		searchFocused = false;
		searchActiveOption = -1;
		mobileDestination = state.selectedIndex === null ? 'ranking' : 'author';
		activeGesture = null;
		cancelToken += 1;
		if (state.invalidLens) {
			announcement = 'The URL lens was invalid. Restored the tested default lens.';
			commitUrl('replace');
		}
	}

	function commitUrl(mode: 'push' | 'replace'): void {
		if (!release || !committedLens || typeof window === 'undefined') return;
		const state: ProminenceUrlState = { lens: committedLens, selectedIndex: selected };
		const currentRelease = release;
		const href = withProminenceTiming('url-serialization', () =>
			serializeProminenceUrl(
				window.location.href,
				resolve('/lab/author-prominence'),
				state,
				currentRelease.manifest,
				currentRelease.population
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
			// A malformed URL or impossible gesture must never reach the worker. Restore the
			// last committed lens when possible; a release-wide failure is handled by loading.
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

	function setMobileDestination(destination: 'lens' | 'ranking' | 'author'): void {
		if (destination === 'author' && selected === null) mobileDestination = 'ranking';
		else {
			if (destination !== 'lens' && activeGesture?.status === 'active') cancelGesture();
			mobileDestination = destination;
		}
	}

	function handleTabKeydown(event: KeyboardEvent): void {
		const destinations: Array<'lens' | 'ranking' | 'author'> =
			selected === null ? ['lens', 'ranking'] : ['lens', 'ranking', 'author'];
		const current = destinations.indexOf(mobileDestination);
		let next = current;
		if (event.key === 'ArrowRight') next = (current + 1) % destinations.length;
		else if (event.key === 'ArrowLeft')
			next = (current - 1 + destinations.length) % destinations.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = destinations.length - 1;
		else return;
		event.preventDefault();
		setMobileDestination(destinations[next]);
		(
			document.getElementById(`prominence-tab-${destinations[next]}`) as HTMLButtonElement | null
		)?.focus();
	}

	function syncMobileMode(): void {
		const next = window.matchMedia('(max-width: 900px)').matches;
		if (next !== isMobile) {
			isMobile = next;
			mobileDestination = selected === null ? 'ranking' : 'author';
		}
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
		loadError = null;
		rankingError = null;
		const requestGeneration = ++lifecycleGeneration;
		invalidateRankingPublication();
		rankingClient?.destroy();
		rankingClient = null;
		release = null;
		committedLens = null;
		draftLens = null;
		rankingResult = null;
		acknowledgedRanking = null;
		comparisonSnapshot = null;
		immediateSelectedCache = null;
		publicationController.reset();
		publishedOrder = [];
		publishedOrderChanged = false;
		void loadRelease()
			.then((loaded) => {
				if (!mounted || requestGeneration !== lifecycleGeneration) return;
				release = loaded;
				committedLens = defaultLens(loaded.manifest);
				draftLens = null;
				searchIndex = buildAuthorSearchIndex(loaded.population.names);
				parseUrlState();
				rankingResult = null;
				acknowledgedRanking = null;
				comparisonSnapshot = null;
				rankingClient = new RankingClient({
					onResult: (result) => {
						receiveRankingResult(result);
					},
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
					loaded.manifest.presets,
					loaded.manifest.display.top_n
				);
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

	onDestroy(() => footerSupplement?.clear(footerSupplementOwner));

	onMount(() => {
		mounted = true;
		start();
		syncMobileMode();
		syncMotionPreference();
		const onResize = () => syncMobileMode();
		const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		const onMotionChange = (event: MediaQueryListEvent) => (reducedMotion = event.matches);
		const onPopState = () => {
			if (!release) return;
			rankingError = null;
			invalidateRankingPublication();
			parseUrlState();
			comparisonSnapshot = null;
			acknowledgedRanking = null;
			requestRanking(true, undefined, 'restore');
		};
		const onKeydown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			if (searchRegion?.contains(event.target as Node | null) && searchFocused) return;
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

<div class="prominence-page">
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
		{#if release}<ProminenceMethod
				manifest={release.manifest}
				open={methodOpen}
				onToggle={(open) => (methodOpen = open)}
			/>{/if}
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
				<ProminenceField
					population={release.population}
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
					onSelect={selectAuthor}
					onHover={(index) => (hovered = index)}
					onEscape={handleEscape}
				/>
			</section>

			<aside class="prominence-rail" aria-label="Lens controls and author ranking">
				{#if isMobile}<button
						type="button"
						class="mobile-lens-summary"
						onclick={() => setMobileDestination('lens')}
						><span>{activeLens.displayName}</span><strong
							>{activeLens.displayShares.join(' / ')}%</strong
						><span aria-hidden="true">+</span></button
					>
					<div
						class="mobile-destinations"
						class:mobile-destinations--has-author={selected !== null}
						aria-label="Author prominence destinations"
						role="tablist"
						aria-orientation="horizontal"
						tabindex="-1"
						onkeydown={handleTabKeydown}
					>
						<button
							id="prominence-tab-lens"
							type="button"
							role="tab"
							aria-selected={mobileDestination === 'lens'}
							aria-controls="prominence-panel-lens"
							tabindex={mobileDestination === 'lens' ? 0 : -1}
							class:active={mobileDestination === 'lens'}
							onclick={() => setMobileDestination('lens')}>Lens</button
						><button
							id="prominence-tab-ranking"
							type="button"
							role="tab"
							aria-selected={mobileDestination === 'ranking'}
							aria-controls="prominence-panel-ranking"
							tabindex={mobileDestination === 'ranking' ? 0 : -1}
							class:active={mobileDestination === 'ranking'}
							onclick={() => setMobileDestination('ranking')}>Ranking</button
						>{#if selected !== null}<button
								id="prominence-tab-author"
								type="button"
								role="tab"
								aria-selected={mobileDestination === 'author'}
								aria-controls="prominence-panel-author"
								tabindex={mobileDestination === 'author' ? 0 : -1}
								class:active={mobileDestination === 'author'}
								onclick={() => setMobileDestination('author')}>Selected author</button
							>{/if}
					</div>{/if}
				<div class="rail-content" bind:this={searchRegion}>
					{#if isMobile}
						{@render authorSearch()}
						{#if mobileDestination === 'lens'}<div
								id="prominence-panel-lens"
								role="tabpanel"
								aria-labelledby="prominence-tab-lens"
							>
								<ProminenceLensMixer
									manifest={release.manifest}
									lens={activeLens}
									{cancelToken}
									onChange={handleLensChange}
									onCancel={handleLensCancel}
									onPreset={choosePreset}
								/>
							</div>
						{:else if mobileDestination === 'author' && selected !== null}<div
								id="prominence-panel-author"
								role="tabpanel"
								aria-labelledby="prominence-tab-author"
								tabindex="-1"
							>
								<ProminenceInspector
									{display}
									selected={selectedSnapshot}
									rows={selectedContributionRows}
									profiles={presetProfiles}
									currentPresetId={activeLens.presetId}
									onClear={clearSelection}
								/>
							</div>
						{:else}<div
								id="prominence-panel-ranking"
								role="tabpanel"
								aria-labelledby="prominence-tab-ranking"
							>
								<ProminenceRanking
									{display}
									{entries}
									barScale={visibleBarScale}
									updating={rankingUpdating}
									showUpdating={rankingProgressVisible}
									{reducedMotion}
									motionDuration={activeLens.source === 'preset' ? 260 : 150}
									motionIntent={publishedMotionIntent}
									motionRevision={publishedMotionRevision}
									animateRows={publishedOrderChanged}
									onSelect={selectAuthor}
								/>
							</div>{/if}
					{:else}
						<div class="desktop-lens-module">
							<ProminenceLensMixer
								manifest={release.manifest}
								lens={activeLens}
								{cancelToken}
								onChange={handleLensChange}
								onCancel={handleLensCancel}
								onPreset={choosePreset}
							/>
						</div>
						{@render authorSearch()}
						<div class="desktop-ranking-region">
							{#if selected !== null}<ProminenceInspector
									{display}
									selected={selectedSnapshot}
									rows={selectedContributionRows}
									profiles={presetProfiles}
									currentPresetId={activeLens.presetId}
									onClear={clearSelection}
								/>{:else}<ProminenceRanking
									{display}
									{entries}
									barScale={visibleBarScale}
									updating={rankingUpdating}
									showUpdating={rankingProgressVisible}
									{reducedMotion}
									motionDuration={activeLens.source === 'preset' ? 260 : 150}
									motionIntent={publishedMotionIntent}
									motionRevision={publishedMotionRevision}
									animateRows={publishedOrderChanged}
									onSelect={selectAuthor}
								/>{/if}
						</div>
					{/if}
				</div>
			</aside>
		</div>
	{/if}
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
		--violet: #9b8cf4;
		--amber: #e0a52f;
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
		display: grid;
		flex: 1 1 auto;
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas:
			'scene'
			'rail';
		gap: var(--space-5);
		min-height: 0;
	}
	.prominence-scene-panel,
	.prominence-rail {
		min-height: 0;
	}
	.prominence-scene-panel {
		grid-area: scene;
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 10px;
	}
	:global(.prominence-scene-panel > .prominence-field) {
		flex: 1 1 auto;
		height: auto;
		min-height: 0;
	}
	.prominence-rail {
		grid-area: rail;
		display: flex;
		min-width: 0;
		flex-direction: column;
		overflow: visible;
	}
	.rail-content {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-height: 0;
		padding: 0 2px 4px 0;
		overflow: visible;
		scrollbar-color: rgba(164, 204, 206, 0.25) transparent;
	}
	.desktop-lens-module {
		flex: 0 0 auto;
	}
	.desktop-ranking-region {
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
	.mobile-destinations,
	.mobile-lens-summary {
		display: none;
	}
	@container author-prominence (max-width: 69.99rem) {
		.prominence-hero {
			align-items: start;
			flex-direction: column;
		}
		.prominence-workbench {
			display: flex;
			min-height: 0;
			flex-direction: column;
		}
		.prominence-scene-panel {
			height: clamp(20rem, 56vh, 36rem);
			min-height: 0;
		}
		:global(.prominence-scene-panel > .prominence-field) {
			height: 100%;
		}
		.prominence-rail {
			overflow: visible;
		}
		.rail-content {
			display: block;
			overflow: visible;
			padding: 5px 0 0;
		}
		.mobile-destinations {
			display: grid;
			grid-template-columns: repeat(2, 1fr);
			gap: 4px;
			margin-bottom: 8px;
			padding: 4px;
			border: 1px solid rgba(164, 204, 206, 0.16);
			border-radius: 8px;
			background: rgba(14, 27, 27, 0.8);
		}
		.mobile-destinations--has-author {
			grid-template-columns: repeat(3, 1fr);
		}
		.mobile-lens-summary {
			display: flex;
			align-items: center;
			gap: 8px;
			width: 100%;
			min-height: 48px;
			margin-bottom: 6px;
			padding: 8px 10px;
			border: 1px solid rgba(164, 204, 206, 0.18);
			border-radius: 8px;
			background: rgba(14, 27, 27, 0.72);
			color: rgba(207, 231, 232, 0.78);
			text-align: left;
			font: 600 12px var(--font-family-interactive);
		}
		.mobile-lens-summary strong {
			margin-left: auto;
			color: #efffff;
			font-variant-numeric: tabular-nums;
		}
		.mobile-destinations button {
			min-height: 44px;
			border: 0;
			border-radius: 5px;
			background: transparent;
			color: rgba(207, 231, 232, 0.68);
			font: 600 12px var(--font-family-interactive);
		}
		.mobile-destinations button.active {
			background: rgba(57, 197, 150, 0.16);
			color: #efffff;
		}
	}
	@container author-prominence (min-width: 70rem) {
		.prominence-hero {
			align-items: center;
			flex-direction: row;
			gap: var(--space-5);
		}
		.prominence-workbench {
			grid-template-columns: minmax(0, 58fr) minmax(19rem, 42fr);
			grid-template-rows: minmax(0, 1fr);
			grid-template-areas: 'scene rail';
			column-gap: var(--space-5);
			min-height: 36rem;
			align-items: stretch;
		}
		.prominence-scene-panel,
		.prominence-rail {
			height: 100%;
			min-height: 0;
		}
		.prominence-loading {
			grid-template-columns: minmax(0, 58fr) minmax(19rem, 42fr);
		}
	}
	@container author-prominence (max-width: 47.99rem) {
		.prominence-scene-panel {
			height: clamp(20rem, 56vh, 30rem);
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
