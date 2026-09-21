<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { t } from '$lib/copy';
	import Spinner from '$lib/components/Spinner.svelte';
	import SearchBar from '$lib/components/SearchBar.svelte';
	import NavStyleTabList from '$lib/components/NavStyleTabList.svelte';
	import BookCoverStrip from '$lib/components/lab/BookCoverStrip.svelte';
	import type { Book } from '$lib/types/book';
	import { getFooterSupplementContext } from '$lib/footerSupplementContext';
	import { featureStanding } from '$lib/lab/book-search/standing';
	import { BookSearchClient, type SearchResult } from '$lib/lab/book-search/search-client';
	import { createAuthorProminenceCatalogLoader } from '$lib/lab/author-prominence/catalog-loader';
	import {
		formatScore,
		handlePositions,
		isPolarizing,
		normaliseWeights,
		placeOf,
		rank
	} from '$lib/lab/book-search/ranking';
	import { loadDataset, loadRelease, type Release } from '$lib/lab/book-search/release';
	import {
		BookRankingFormatError,
		type BookPopulation,
		type BookRanking,
		type RankingMode,
		type RankingPreset
	} from '$lib/lab/book-search/types';

	interface ControlPreset extends RankingPreset {
		label: string;
	}

	type RankingView = 'best' | 'polarizing';

	/** Rows shown before a search; also the most search matches shown at once. */
	const LIST_LENGTH = 100;
	/*
	 * Polarization percentiles saturate near the top, so with no popularity requirement the
	 * opening list is made of titles almost nobody has read. The view opens with popularity
	 * counting as much as disagreement; the slider takes it back down.
	 */
	const POLARIZING_OPENING_POPULARITY_SHARE = 0.5;
	const SEARCH_SETTLE_MS = 100;
	const RANK_CHANGE_SETTLE_MS = 340;
	const COPY = 'lab.bookSearch.';
	/**
	 * Best-list preset names as the release ships them → copy keys for their display names.
	 * A name not listed here is shown as the release wrote it.
	 */
	const PRESET_KEYS: Record<string, string> = {
		'Configured default': 'default',
		'Reader regard': 'regard',
		'Most read': 'reach',
		'Most recognised': 'recognition'
	};
	const rankingViewItems = [
		{ id: 'best', label: t(COPY + 'modes.bestItems') },
		{ id: 'polarizing', label: t(COPY + 'modes.polarizingItems') }
	] satisfies Array<{ id: RankingView; label: string }>;
	const compactNumber = new Intl.NumberFormat('en', {
		notation: 'compact',
		maximumFractionDigits: 1
	});

	let release = $state.raw<Release | null>(null);
	let datasets = $state.raw<Partial<Record<RankingMode, BookPopulation>>>({});
	/** In-flight and finished dataset downloads, so each mode is fetched once. */
	let datasetLoads: Partial<Record<RankingMode, Promise<BookPopulation>>> = {};
	let currentMode = $state<RankingMode>('best_items');
	let query = $state('');
	let searchQuery = $state('');
	let searchResult = $state.raw<
		(SearchResult & { query: string; population: BookPopulation; ranking: BookRanking }) | null
	>(null);
	const searchClient = new BookSearchClient();
	let animateRankChanges = $state(false);
	let resultsList: HTMLOListElement | undefined = $state();

	let expandedIndex = $state<number | null>(null);
	let loadError = $state<string | null>(null);
	let loadingMode = $state<RankingMode | null>(null);
	let settingsOpen = $state(false);
	let methodologyOpen = $state(false);
	let isMobile = $state(false);
	let reducedMotion = $state(false);
	let requestId = 0;

	let raw = $state<number[]>([]);
	let presetWeights = $state<number[] | null>(null);
	let activePreset = $state<string | null>(null);
	let popularityShare = $state(0);

	// Slider input is applied at most once per animation frame.
	let sliderFrame = 0;
	let queuedRaw: number[] | null = null;
	let queuedPopularityShare: number | null = null;

	// Rank movement compares two complete `places` arrays, so any size of jump is exact,
	// while only the rendered rows ever read from them.
	let movement = $state.raw<{ from: Int32Array; to: Int32Array } | null>(null);
	let motionBaseline: BookRanking | null = null;
	let rankChangeTimer: ReturnType<typeof setTimeout> | null = null;

	/*
	 * Catalog details for the open row. A series loads every volume in one request, so choosing
	 * another volume swaps the cover and the text without a second wait.
	 */
	const catalogLoader = createAuthorProminenceCatalogLoader();
	const GENRE_LIMIT = 4;
	let detailBooks = $state.raw<Array<Book | null>>([]);
	let detailsLoading = $state(false);
	let selectedVolume = $state(0);
	/** Spoken only when the reader switches volume, not every time the window opens. */
	let volumeAnnouncement = $state('');
	let detailRequestId = 0;

	const population = $derived(datasets[currentMode] ?? null);
	const model = $derived(release?.manifest.model[currentMode] ?? null);
	const modeIsPolarizing = $derived(isPolarizing(currentMode));
	const rankingView = $derived<RankingView>(modeIsPolarizing ? 'polarizing' : 'best');

	const weights = $derived.by(() => {
		if (!model) return [];
		return presetWeights ?? normaliseWeights(raw, model.default_weights);
	});
	const featureDetails = $derived.by(() => {
		if (!model) return [];
		return model.features.map((feature) => ({
			id: feature,
			label: t(COPY + 'features.' + feature + '.label'),
			blurb: t(COPY + 'features.' + feature + '.blurb')
		}));
	});
	/*
	 * Presets are offered only where they re-weight the mix. The polarizing release ships
	 * presets with identical weights that move popularity alone, which its slider already does.
	 */
	const controlPresets = $derived.by((): ControlPreset[] => {
		if (!release || modeIsPolarizing) return [];
		return release.manifest.presets[currentMode].map((preset) => {
			const key = PRESET_KEYS[preset.name];
			return {
				...preset,
				label: key ? t(COPY + 'presets.names.' + key) : preset.name
			};
		});
	});
	const activeControlPreset = $derived(
		controlPresets.find((preset) => preset.name === activePreset) ?? null
	);

	const ranking = $derived.by(() => {
		if (!population || !model || raw.length === 0) return null;
		return rank(population, weights, model.sigma_z, modeIsPolarizing ? popularityShare : 0);
	});
	const searchPending = $derived(
		query.trim() !== searchQuery ||
			(Boolean(searchQuery) &&
				(searchResult?.query !== searchQuery ||
					searchResult?.population !== population ||
					searchResult?.ranking !== ranking))
	);
	const matchCount = $derived(searchResult?.total ?? 0);
	const renderedSearchQuery = $derived(
		searchQuery && searchResult?.population === population ? searchResult.query : ''
	);
	const visibleIndices = $derived.by(() => {
		if (!population || !ranking) return [];
		return searchQuery && searchResult?.population === population
			? searchResult.indices
			: Array.from(ranking.order.subarray(0, LIST_LENGTH));
	});
	const featureStandings = $derived.by(() => {
		if (!population || expandedIndex === null) return [];
		const index = expandedIndex;
		return population.z.map((values) => featureStanding(values, index));
	});
	const popularityStanding = $derived(
		population?.culturalReachZ && expandedIndex !== null
			? featureStanding(population.culturalReachZ, expandedIndex)
			: null
	);

	/** Source ids carrying catalog details: a series shows its volumes, a book its own entry. */
	function detailIdsFor(current: BookPopulation, index: number): string[] {
		const ids = current.constituentBookIds[index];
		return current.itemTypes[index] === 'series' ? ids : ids.slice(0, 1);
	}
	const detailBook = $derived(detailBooks[selectedVolume] ?? null);
	const detailGenres = $derived((detailBook?.genres ?? []).slice(0, GENRE_LIMIT));

	function chooseVolume(volumeIndex: number): void {
		selectedVolume = volumeIndex;
		const book = detailBooks[volumeIndex];
		const volume = t(COPY + 'detail.volume', { number: volumeIndex + 1 });
		volumeAnnouncement = book ? volume + ', ' + book.title : volume;
	}

	function plural(key: string, count: number, params: Record<string, string | number> = {}) {
		return t(COPY + key + (count === 1 ? '.one' : '.other'), {
			count: count.toLocaleString(),
			...params
		});
	}
	function percent(share: number): number {
		return Math.round(share * 100);
	}
	function describeError(error: unknown): string {
		if (error instanceof BookRankingFormatError) return t(COPY + 'errors.format');
		return t(COPY + 'errors.load');
	}
	function seedControls(mode: RankingMode): void {
		if (!release) return;
		const modelForMode = release.manifest.model[mode];
		const preset = release.manifest.presets[mode][0];
		raw = handlePositions(preset.weights);
		presetWeights = preset.weights;
		if (isPolarizing(mode)) {
			activePreset = null;
			popularityShare = POLARIZING_OPENING_POPULARITY_SHARE;
			return;
		}
		activePreset = preset.name;
		popularityShare = preset.reach_share ?? modelForMode.default_reach_share ?? 0;
	}

	function clearRankMotion(): void {
		if (rankChangeTimer !== null) clearTimeout(rankChangeTimer);
		if (sliderFrame) cancelAnimationFrame(sliderFrame);
		sliderFrame = 0;
		queuedRaw = null;
		queuedPopularityShare = null;
		rankChangeTimer = null;
		motionBaseline = null;
		movement = null;
	}
	/**
	 * Call before changing the weighting: movement is measured once the changes settle, and then
	 * stays on the rows until the next change. Switching view, searching or leaving clears it.
	 */
	function beginRankMotion(): void {
		if (!ranking) return;
		animateRankChanges = true;
		if (motionBaseline === null) {
			motionBaseline = ranking;
			movement = null;
		}
		if (rankChangeTimer !== null) clearTimeout(rankChangeTimer);
		rankChangeTimer = setTimeout(() => {
			rankChangeTimer = null;
			const baseline = motionBaseline;
			motionBaseline = null;
			const settled = ranking;
			if (!baseline || !settled || baseline.places.length !== settled.places.length) return;
			movement = { from: baseline.places, to: settled.places };
		}, RANK_CHANGE_SETTLE_MS);
	}
	function flushSliders(): void {
		sliderFrame = 0;
		if (!queuedRaw && queuedPopularityShare === null) return;
		beginRankMotion();
		if (queuedRaw) {
			raw = queuedRaw;
			presetWeights = null;
			activePreset = null;
		}
		if (queuedPopularityShare !== null) {
			popularityShare = queuedPopularityShare;
			activePreset = null;
		}
		queuedRaw = null;
		queuedPopularityShare = null;
	}
	function scheduleSliders(): void {
		if (!sliderFrame) sliderFrame = requestAnimationFrame(flushSliders);
	}
	function setManualWeight(index: number, value: number): void {
		queuedRaw = [...(queuedRaw ?? raw)];
		queuedRaw[index] = value;
		scheduleSliders();
	}
	function setPopularityShare(value: number): void {
		queuedPopularityShare = value;
		scheduleSliders();
	}
	function applyPreset(preset: ControlPreset): void {
		if (sliderFrame) cancelAnimationFrame(sliderFrame);
		sliderFrame = 0;
		queuedRaw = null;
		queuedPopularityShare = null;
		beginRankMotion();
		raw = handlePositions(preset.weights);
		presetWeights = preset.weights;
		activePreset = preset.name;
		if (preset.reach_share !== undefined) popularityShare = preset.reach_share;
	}

	function rankMovement(index: number): number {
		return movement ? movement.from[index] - movement.to[index] : 0;
	}
	function rowLabel(index: number, current: BookPopulation, currentRanking: BookRanking): string {
		const label = t(COPY + 'board.rowLabel', {
			title: current.titles[index],
			author: current.authors[index],
			score: formatScore(currentRanking.scores[index]),
			rank: placeOf(currentRanking, index).toLocaleString()
		});
		const delta = rankMovement(index);
		if (delta === 0) return label;
		return label + ', ' + plural(delta > 0 ? 'board.movedUp' : 'board.movedDown', Math.abs(delta));
	}
	function aheadOfText(index: number, current: BookPopulation, currentRanking: BookRanking) {
		const aheadOf = ((current.count - placeOf(currentRanking, index)) / current.count) * 100;
		return t(COPY + 'detail.aheadOf', {
			percent: (aheadOf >= 99.95 ? '>99.9' : aheadOf.toFixed(1)) + '%'
		});
	}
	function coverIdsFor(current: BookPopulation, index: number): string[] {
		return current.constituentBookIds[index].slice(0, 1);
	}
	function explanationId(index: number): string {
		return 'book-search-explanation-' + currentMode + '-' + index;
	}
	function rowId(index: number): string {
		return 'book-search-row-' + currentMode + '-' + index;
	}

	/** Native modal dialog: outside clicks and Escape close it; focus returns to the opener. */
	function openDialog(node: HTMLDialogElement, onClose: () => void) {
		const trigger = document.activeElement;
		node.showModal();
		let startedOutside = false;
		const outside = (event: MouseEvent) => {
			const rect = node.getBoundingClientRect();
			return (
				event.clientX < rect.left ||
				event.clientX > rect.right ||
				event.clientY < rect.top ||
				event.clientY > rect.bottom
			);
		};
		const pointerDown = (event: PointerEvent) => {
			startedOutside = outside(event);
		};
		const click = (event: MouseEvent) => {
			if (startedOutside && outside(event)) {
				event.preventDefault();
				event.stopPropagation();
				onClose();
			}
		};
		const close = () => onClose();
		node.addEventListener('pointerdown', pointerDown);
		node.addEventListener('click', click);
		node.addEventListener('close', close);
		return {
			destroy() {
				node.removeEventListener('pointerdown', pointerDown);
				node.removeEventListener('click', click);
				node.removeEventListener('close', close);
				node.close();
				if (trigger instanceof HTMLElement && trigger.isConnected) {
					trigger.focus({ preventScroll: true });
				}
			}
		};
	}
	/** Hover/focus tooltip that Escape hides until the pointer or focus leaves it. */
	function dismissibleTooltip(node: HTMLElement) {
		let hovered = false;
		const dismissedClass = 'book-search-info--dismissed';
		const focused = () => node.contains(document.activeElement);
		const keydown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || node.classList.contains(dismissedClass)) return;
			if (!hovered && !focused()) return;
			// Capture phase: hide the tooltip instead of also closing a surrounding dialog.
			event.preventDefault();
			event.stopPropagation();
			node.classList.add(dismissedClass);
		};
		const enter = () => (hovered = true);
		const leave = () => {
			hovered = false;
			if (!focused()) node.classList.remove(dismissedClass);
		};
		const focusout = () => {
			if (!hovered) node.classList.remove(dismissedClass);
		};
		window.addEventListener('keydown', keydown, true);
		node.addEventListener('mouseenter', enter);
		node.addEventListener('mouseleave', leave);
		node.addEventListener('focusout', focusout);
		return {
			destroy() {
				window.removeEventListener('keydown', keydown, true);
				node.removeEventListener('mouseenter', enter);
				node.removeEventListener('mouseleave', leave);
				node.removeEventListener('focusout', focusout);
			}
		};
	}
	function toggleExplanation(index: number): void {
		expandedIndex = expandedIndex === index ? null : index;
	}

	function datasetFor(nextRelease: Release, mode: RankingMode): Promise<BookPopulation> {
		let load = datasetLoads[mode];
		if (!load) {
			load = loadDataset(nextRelease, mode).then((loaded) => {
				// Keep every finished download, even after switching away, so returning is instant.
				if (release === nextRelease) {
					searchClient.prepare(loaded);
					datasets = { ...datasets, [mode]: loaded };
				}
				return loaded;
			});
			load.catch(() => delete datasetLoads[mode]);
			datasetLoads[mode] = load;
		}
		return load;
	}
	function chooseMode(nextMode: RankingMode): void {
		if (!release) return;
		// Re-selecting the current tab must not reset a custom weighting.
		if (nextMode === currentMode && (datasets[nextMode] || loadingMode === nextMode)) return;
		if (currentMode !== nextMode) {
			animateRankChanges = false;
			expandedIndex = null;
			clearRankMotion();
		}
		currentMode = nextMode;
		loadError = null;
		seedControls(nextMode);
		const thisRequest = ++requestId;
		if (datasets[nextMode]) {
			loadingMode = null;
			return;
		}
		loadingMode = nextMode;
		void datasetFor(release, nextMode)
			.catch((error) => {
				if (thisRequest === requestId) loadError = describeError(error);
			})
			.finally(() => {
				if (thisRequest === requestId) loadingMode = null;
			});
	}
	function chooseRankingView(view: RankingView): void {
		chooseMode(view === 'best' ? 'best_items' : 'polarizing_items');
	}
	function openSettings(): void {
		if (isMobile) settingsOpen = true;
	}
	function closeSettings(): void {
		settingsOpen = false;
	}

	async function start(): Promise<void> {
		loadError = null;
		datasets = {};
		datasetLoads = {};
		expandedIndex = null;
		clearRankMotion();
		try {
			release = await loadRelease();
			chooseMode('best_items');
		} catch (error) {
			loadError = describeError(error);
		}
	}

	const footerSupplement = getFooterSupplementContext();
	const footerSupplementOwner = Symbol('book-search');
	$effect(() => {
		if (release)
			footerSupplement?.set(
				footerSupplementOwner,
				t(COPY + 'footer', {
					count: release.manifest.quality.items[currentMode].toLocaleString(),
					version: release.manifest.version
				})
			);
		else footerSupplement?.clear(footerSupplementOwner);
	});

	let previousQuery = '';
	$effect(() => {
		const currentQuery = query;
		if (currentQuery === previousQuery) return;
		previousQuery = currentQuery;
		animateRankChanges = false;
		clearRankMotion();
		expandedIndex = null;
	});
	$effect(() => {
		const nextQuery = query.trim();
		if (!nextQuery) {
			searchQuery = '';
			return;
		}
		// Keep the input immediate and retain the current results during a typing burst.
		const timer = setTimeout(() => (searchQuery = nextQuery), SEARCH_SETTLE_MS);
		return () => clearTimeout(timer);
	});
	$effect(() => {
		// New searches start at the top; weight changes keep the current scroll position.
		void renderedSearchQuery;
		void currentMode;
		if (resultsList) resultsList.scrollTop = 0;
	});
	$effect(() => {
		const currentPopulation = population;
		const currentRanking = ranking;
		const currentQuery = searchQuery;
		if (!currentPopulation || !currentRanking || !currentQuery) {
			searchResult = null;
			return;
		}
		let cancelled = false;
		void searchClient
			.search(currentPopulation, currentRanking, currentQuery, LIST_LENGTH)
			.then((result) => {
				if (!cancelled)
					searchResult = {
						...result,
						query: currentQuery,
						population: currentPopulation,
						ranking: currentRanking
					};
			});
		return () => {
			cancelled = true;
		};
	});
	$effect(() => {
		const index = expandedIndex;
		const current = population;
		const request = ++detailRequestId;
		selectedVolume = 0;
		volumeAnnouncement = '';
		if (index === null || !current) {
			detailBooks = [];
			detailsLoading = false;
			return;
		}
		detailsLoading = true;
		void catalogLoader.loadMany(detailIdsFor(current, index)).then((books) => {
			if (request !== detailRequestId) return;
			detailBooks = books;
			detailsLoading = false;
		});
	});
	onMount(() => {
		const mobileQuery = window.matchMedia('(max-width: 767px)');
		const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		const syncMobile = () => {
			isMobile = mobileQuery.matches;
			if (!isMobile) settingsOpen = false;
		};
		const syncMotion = () => (reducedMotion = motionQuery.matches);
		syncMobile();
		syncMotion();
		mobileQuery.addEventListener('change', syncMobile);
		motionQuery.addEventListener('change', syncMotion);
		void start();
		return () => {
			mobileQuery.removeEventListener('change', syncMobile);
			motionQuery.removeEventListener('change', syncMotion);
		};
	});
	onDestroy(() => {
		clearRankMotion();
		catalogLoader.destroy();
		searchClient.destroy();
		footerSupplement?.clear(footerSupplementOwner);
	});
</script>

<svelte:head>
	<title>{t(COPY + 'title')} — {t('shared.header.siteName')}</title>
	<meta name="description" content={t(COPY + 'metaDescription')} />
</svelte:head>

{#snippet infoTip(id: string, label: string, blurb: string)}
	<span class="book-search-info" use:dismissibleTooltip
		><button type="button" aria-label={label} aria-describedby={id}>i</button><span
			role="tooltip"
			{id}>{blurb}</span
		></span
	>
{/snippet}

{#snippet controlsBody()}
	<div class="book-search-controls__body">
		{#if controlPresets.length > 0}
			<section
				class="book-search-controls__section book-search-controls__section--preset"
				aria-labelledby="book-search-presets-heading"
			>
				<h2 class="book-search-controls__heading" id="book-search-presets-heading">
					{t(COPY + 'presets.heading')}
				</h2>
				<div class="book-search-presets">
					{#each controlPresets as preset (preset.name)}
						<button
							type="button"
							class="book-search-preset"
							aria-pressed={activePreset === preset.name}
							onclick={() => applyPreset(preset)}>{preset.label}</button
						>
					{/each}
				</div>
			</section>
		{/if}
		<section class="book-search-controls__section" aria-labelledby="book-search-weighting-heading">
			<h2 class="book-search-controls__heading" id="book-search-weighting-heading">
				{t(COPY + 'weights.heading')}
			</h2>
			{#each featureDetails as feature, index (feature.id)}
				<div
					class="book-search-dimension"
					style={'--dimension-color: var(--color-viz-series-' +
						(modeIsPolarizing ? 'alt-' : '') +
						(index + 1) +
						')'}
				>
					<div class="book-search-dimension__label-row">
						<span class="book-search-feature-label"
							><label for={'book-search-weight-' + feature.id}>{feature.label}</label
							>{@render infoTip(
								'help-' + feature.id,
								t(COPY + 'weights.about', { feature: feature.label }),
								feature.blurb
							)}</span
						>
						<output for={'book-search-weight-' + feature.id}>{percent(weights[index] ?? 0)}%</output
						>
					</div>
					<input
						id={'book-search-weight-' + feature.id}
						type="range"
						min="0"
						max="100"
						step="1"
						value={raw[index] ?? 0}
						aria-valuetext={t(COPY + 'weights.valueText', {
							feature: feature.label,
							percent: percent(weights[index] ?? 0)
						})}
						oninput={(event) => setManualWeight(index, Number(event.currentTarget.value))}
					/>
				</div>
			{/each}
		</section>

		{#if modeIsPolarizing}
			<section class="book-search-controls__section">
				<div class="book-search-dimension">
					<div class="book-search-dimension__label-row">
						<span class="book-search-feature-label"
							><label for="book-search-popularity">{t(COPY + 'popularity.label')}</label
							>{@render infoTip(
								'help-popularity',
								t(COPY + 'popularity.about'),
								t(COPY + 'popularity.blurb')
							)}</span
						>
					</div>
					<input
						id="book-search-popularity"
						type="range"
						min="0"
						max="50"
						step="5"
						value={percent(popularityShare)}
						aria-valuetext={t(COPY + 'popularity.valueText', { value: percent(popularityShare) })}
						oninput={(event) => setPopularityShare(Number(event.currentTarget.value) / 100)}
					/>
				</div>
			</section>
		{/if}
	</div>
{/snippet}

<div class="book-search-page">
	<header class="book-search-page__header">
		<h1 class="book-search-page__title typ-display2 typ-display2--content">
			{t(COPY + 'title')}
		</h1>

		<button
			type="button"
			class="book-search-button"
			aria-haspopup="dialog"
			disabled={!release}
			onclick={() => (methodologyOpen = true)}>{t(COPY + 'methodology.open')}</button
		>
	</header>

	{#if loadError && !release}
		<div class="book-search-state book-search-state--error" role="alert">
			<div>
				<strong>{t(COPY + 'errors.pageHeading')}</strong>
				<p>{loadError}</p>
			</div>
			<button
				type="button"
				class="book-search-button book-search-button--secondary"
				onclick={() => void start()}
			>
				{t(COPY + 'errors.retry')}
			</button>
		</div>
	{:else if !release || (loadingMode === 'best_items' && !population)}
		<div class="book-search-state" aria-live="polite">
			<Spinner />
			<p>{t(COPY + 'loading')}</p>
		</div>
	{:else}
		<div class="book-search-toolbar">
			<div class="book-search-toolbar__search">
				<SearchBar
					bind:value={query}
					placeholder={t(COPY + 'search.placeholder')}
					ariaLabel={t(COPY + 'search.label')}
				/>
			</div>
			<div class="book-search-toolbar__switches">
				<div class="book-search-toolbar__switch-group">
					<NavStyleTabList
						items={rankingViewItems}
						selectedId={rankingView}
						ariaLabel={t(COPY + 'modes.tabsLabel')}
						panelId="book-search-panel"
						idPrefix="book-search-ranking"
						showCounts={false}
						onSelect={(view) => chooseRankingView(view as RankingView)}
					/>
				</div>
			</div>
		</div>

		<div
			class="book-search-page__panel"
			id="book-search-panel"
			role="tabpanel"
			aria-label={t(COPY + (modeIsPolarizing ? 'modes.panelPolarizing' : 'modes.panelBest'))}
		>
			{#if isMobile}
				<button
					type="button"
					class="book-search-settings-trigger"
					aria-haspopup="dialog"
					aria-expanded={settingsOpen}
					onclick={openSettings}
				>
					<span class="book-search-settings-trigger__icon" aria-hidden="true">☷</span>
					<span>
						<strong>{t(COPY + 'weights.heading')}</strong>
						{#if activeControlPreset}
							<small>{activeControlPreset.label}</small>
						{/if}
					</span>
					<span class="book-search-settings-trigger__chevron" aria-hidden="true">⌄</span>
				</button>
			{/if}

			{#if loadError}
				<div class="book-search-state book-search-state--error" role="alert">
					<div>
						<strong>{t(COPY + 'errors.viewHeading')}</strong>
						<p>{loadError}</p>
					</div>
					<button
						type="button"
						class="book-search-button book-search-button--secondary"
						onclick={() => chooseMode(currentMode)}
					>
						{t(COPY + 'errors.retry')}
					</button>
				</div>
			{:else if loadingMode === currentMode || !population || !ranking}
				<div class="book-search-state" aria-live="polite">
					<Spinner />
					<p>{t(COPY + 'loading')}</p>
				</div>
			{:else}
				<div class="book-search-page__workspace">
					{#if isMobile}
						{#if settingsOpen}
							<dialog
								class="book-search-controls book-search-sheet"
								aria-label={t(COPY + 'settings.heading')}
								use:openDialog={closeSettings}
							>
								<div class="book-search-controls__mobile-header">
									<button
										type="button"
										class="book-search-icon-button"
										aria-label={t(COPY + 'settings.close')}
										onclick={closeSettings}
									>
										<span aria-hidden="true">×</span>
									</button>
								</div>
								{@render controlsBody()}
							</dialog>
						{/if}
					{:else}
						<aside class="book-search-controls" aria-label={t(COPY + 'settings.heading')}>
							{@render controlsBody()}
						</aside>
					{/if}

					<section
						class="book-search-board"
						aria-label={t(COPY + 'board.label')}
						aria-busy={searchPending}
					>
						<div class="book-search-board__surface">
							<div class="book-search-board__columns" aria-hidden="true">
								<span>{t(COPY + 'board.columns.rank')}</span>
								<span class="book-search-column-identity"
									><span>{t(COPY + 'board.columns.title')}</span><span
										>{t(COPY + 'board.columns.author')}</span
									></span
								>
								<span>{t(COPY + 'board.columns.score')}</span>
							</div>
							<ol
								bind:this={resultsList}
								class="book-search-board__list"
								aria-label={t(COPY + 'board.listLabel')}
							>
								{#key currentMode + ':' + renderedSearchQuery}
									{#each visibleIndices as index (index)}
										{@const delta = rankMovement(index)}
										{@const expanded = expandedIndex === index}
										<li
											id={rowId(index)}
											class="book-search-board__item"
											class:book-search-board__item--expanded={expanded}
											animate:flip={{ duration: reducedMotion || !animateRankChanges ? 0 : 280 }}
										>
											<button
												type="button"
												class="book-search-board__row"
												aria-label={rowLabel(index, population, ranking)}
												aria-expanded={expanded}
												aria-haspopup="dialog"
												aria-controls={expanded ? explanationId(index) : undefined}
												onclick={() => toggleExplanation(index)}
											>
												<span class="book-search-board__rank">
													<strong>{placeOf(ranking, index)}</strong>
													{#if delta !== 0}
														<span
															class="book-search-board__movement"
															class:book-search-board__movement--up={delta > 0}
															><span>{delta > 0 ? '↑' : '↓'}</span><span
																>{compactNumber.format(Math.abs(delta))}</span
															></span
														>
													{/if}
												</span>

												<span class="book-search-board__identity">
													<span class="book-search-board__cover"
														><BookCoverStrip bookIds={coverIdsFor(population, index)} /></span
													>
													<span class="book-search-board__identity-copy">
														<strong class="book-search-board__title"
															>{population.titles[index]}</strong
														>
														<span class="book-search-board__author"
															>{population.authors[index]}</span
														>
													</span>
												</span>

												<span class="book-search-board__score">
													<strong>{formatScore(ranking.scores[index])}</strong>
												</span>
											</button>
											{#if expanded}
												{@const title = population.titles[index]}
												{@const volumes = population.constituentBookIds[index]}
												<dialog
													id={explanationId(index)}
													class="book-search-explanation"
													use:openDialog={() => (expandedIndex = null)}
													aria-label={t(COPY + 'detail.dialogLabel', { title })}
												>
													<button
														type="button"
														class="book-search-close"
														aria-label={t(COPY + 'detail.close')}
														onclick={() => (expandedIndex = null)}>&times;</button
													>
													<div class="book-search-explanation__header">
														<span class="book-search-context-cover"
															><BookCoverStrip
																bookIds={detailIdsFor(population, index).slice(
																	selectedVolume,
																	selectedVolume + 1
																)}
															/></span
														>
														<div>
															<h2>{title}</h2>
															<p class="book-search-explanation__author">
																{population.authors[index]}
															</p>
															<div class="book-search-about">
																{#if detailBook}
																	{#if population.itemTypes[index] === 'series'}
																		<p class="book-search-about__volume">
																			{t(COPY + 'detail.volume', { number: selectedVolume + 1 })} ·
																			{detailBook.title}
																		</p>
																	{/if}
																	{#if detailBook.year || detailGenres.length > 0}
																		<p class="book-search-about__facts">
																			{[detailBook.year, ...detailGenres]
																				.filter(Boolean)
																				.join(' · ')}
																		</p>
																	{/if}
																	{#if detailBook.summary}
																		<p class="book-search-about__summary">{detailBook.summary}</p>
																	{/if}
																{:else if detailsLoading}
																	<p class="book-search-about__facts">
																		{t(COPY + 'detail.loadingBook')}
																	</p>
																{/if}
															</div>
														</div>

														<div class="book-search-explanation__facts">
															<div>
																<strong>{formatScore(ranking.scores[index])}</strong>
																<span>{t(COPY + 'detail.score')}</span>
															</div>
															<div>
																<strong
																	>{t(COPY + 'detail.rankValue', {
																		rank: placeOf(ranking, index).toLocaleString(),
																		total: population.count.toLocaleString()
																	})}</strong
																>
																<span>{t(COPY + 'detail.rank')}</span>
															</div>
															<div>
																<strong>{aheadOfText(index, population, ranking)}</strong>
																<span>{t(COPY + 'detail.aheadOfLabel')}</span>
															</div>
														</div>

														<section
															class="book-search-dimension-cards"
															aria-label={t(COPY + 'detail.dimensions')}
														>
															{#each featureDetails as feature, featureIndex (feature.id)}
																<div class="book-search-dimension-card">
																	<h3>{feature.label}</h3>
																	<strong
																		>{t(COPY + 'detail.top', {
																			percent: featureStandings[featureIndex]?.top ?? ''
																		})}</strong
																	>
																	<span
																		>{t(COPY + 'detail.featureRank', {
																			rank:
																				featureStandings[featureIndex]?.rank.toLocaleString() ?? ''
																		})}</span
																	>
																</div>
															{/each}
															{#if popularityStanding}
																<div class="book-search-dimension-card">
																	<h3>{t(COPY + 'popularity.label')}</h3>
																	<strong
																		>{t(COPY + 'detail.top', {
																			percent: popularityStanding.top
																		})}</strong
																	>
																	<span
																		>{t(COPY + 'detail.featureRank', {
																			rank: popularityStanding.rank.toLocaleString()
																		})}</span
																	>
																</div>
															{/if}
														</section>
													</div>
													{#if population.itemTypes[index] === 'series' && volumes.length > 0}
														<section
															class="book-search-explanation__volumes"
															aria-labelledby={'book-search-volumes-' + index}
														>
															<h3
																class="book-search-explanation__subheading"
																id={'book-search-volumes-' + index}
															>
																{t(COPY + 'detail.volumesHeading')}
															</h3>
															<ul>
																{#each volumes as bookId, volumeIndex (bookId)}
																	<li>
																		<button
																			type="button"
																			class="book-search-volume"
																			class:book-search-volume--active={selectedVolume ===
																				volumeIndex}
																			aria-pressed={selectedVolume === volumeIndex}
																			aria-label={t(COPY + 'detail.showVolume', {
																				number: volumeIndex + 1,
																				title
																			})}
																			onclick={() => chooseVolume(volumeIndex)}
																		>
																			<BookCoverStrip bookIds={[bookId]} />
																		</button>
																	</li>
																{/each}
															</ul>
														</section>
													{/if}
													<span class="book-search-sr-only" aria-live="polite"
														>{volumeAnnouncement}</span
													>
												</dialog>
											{/if}
										</li>
									{:else}
										<li class="book-search-board__empty">
											<strong>{t(COPY + 'board.noMatches')}</strong>
											<span
												>{t(COPY + 'board.noMatchesDetail', { query: renderedSearchQuery })}</span
											>
											<button
												type="button"
												class="book-search-button book-search-button--secondary"
												onclick={() => (query = '')}
											>
												{t(COPY + 'board.clearSearch')}
											</button>
										</li>
									{/each}
								{/key}
							</ol>
						</div>
						{#if searchPending || (searchQuery && matchCount > 0)}
							<p class="book-search-board__note" aria-live="polite">
								{#if searchPending}
									{t(COPY + 'board.updating')}
								{:else}
									{plural('board.matches', matchCount)}
									{matchCount > LIST_LENGTH
										? t(COPY + 'board.limited', { limit: LIST_LENGTH })
										: ''}
								{/if}
							</p>
						{/if}
					</section>
				</div>
			{/if}
		</div>

		{#if methodologyOpen}
			<dialog
				use:openDialog={() => (methodologyOpen = false)}
				class="book-search-methodology"
				aria-labelledby="book-search-methodology-heading"
			>
				<button
					type="button"
					class="book-search-close"
					aria-label={t(COPY + 'methodology.close')}
					onclick={() => (methodologyOpen = false)}>&times;</button
				>
				<div>
					<h2 id="book-search-methodology-heading">{t(COPY + 'methodology.heading')}</h2>
					<p>
						{t(COPY + 'methodology.intro')}
						{#if modeIsPolarizing}
							{t(COPY + 'methodology.evidencePolarizing')}
							<strong>{t(COPY + 'methodology.signalsPolarizing')}</strong>.
							{t(COPY + 'methodology.popularityIntro')}
						{:else}
							{t(COPY + 'methodology.evidenceBest')}
							<strong>{t(COPY + 'methodology.signalsBest')}</strong>.
						{/if}
					</p>
				</div>
				<dl class="book-search-methodology-signals">
					{#each featureDetails as feature (feature.id)}
						<div>
							<dt>{feature.label}</dt>
							<dd>
								{t(COPY + 'methodology.signals.' + feature.id)}
							</dd>
						</div>
					{/each}
					{#if modeIsPolarizing}
						<div>
							<dt>{t(COPY + 'popularity.label')}</dt>
							<dd>{t(COPY + 'methodology.popularityPolarizing')}</dd>
						</div>
					{/if}
				</dl>
				<p>
					{t(COPY + 'methodology.outroBefore')}
					<strong>{t(COPY + 'methodology.outroScore')}</strong>
					{t(COPY + 'methodology.outroAfter')}
					{#if modeIsPolarizing}{t(COPY + 'methodology.polarizingNote')}{/if}
				</p>
			</dialog>
		{/if}
	{/if}
</div>

<style>
	.book-search-page {
		--book-search-accent: var(--color-accent-brand);
		display: flex;
		flex-direction: column;
		gap: clamp(var(--space-5), 3vw, var(--space-8));
		width: 100%;
		min-width: 0;
		padding-bottom: var(--space-12);
		overflow-x: clip;
	}
	.book-search-page__header {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		max-width: 48rem;
	}

	.book-search-page__title {
		margin: 0 !important;
		color: var(--color-text);
		font-size: clamp(2.375rem, 6vw, 4rem);
		letter-spacing: -0.035em;
		line-height: 0.98;
	}

	.book-search-toolbar {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding-bottom: var(--space-5);
		border-bottom: 1px solid var(--color-border);
	}
	.book-search-toolbar__search {
		width: 100%;
		max-width: 48rem;
	}

	.book-search-toolbar__switches {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4) var(--space-8);
	}
	.book-search-toolbar__switch-group {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.book-search-toolbar__switch-group :global(.nav-style-tabs__wrap),
	.book-search-toolbar__switch-group :global(.nav-style-tabs__list) {
		width: auto;
	}
	.book-search-toolbar__switch-group :global(.nav-style-tabs__list) {
		flex-wrap: nowrap;
	}
	.book-search-toolbar__switch-group :global(.nav-style-tabs__tab) {
		padding-block: var(--space-2);
	}
	.book-search-page__panel {
		display: flex;
		flex-direction: column;
		gap: clamp(var(--space-4), 3vw, var(--space-6));
		min-width: 0;
	}
	.book-search-page__workspace {
		display: grid;
		grid-template-columns: minmax(16rem, 18.5rem) minmax(0, 1fr);
		gap: clamp(var(--space-5), 3vw, var(--space-8));
		align-items: start;
		min-width: 0;
	}
	.book-search-controls {
		grid-column: 1;
		min-width: 0;
		overflow: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-card-bg) 92%, var(--color-bg));
		box-shadow: var(--shadow-card);
		scrollbar-width: thin;
		scrollbar-color: var(--color-border) transparent;
	}
	.book-search-controls__body {
		display: flex;
		flex-direction: column;
		gap: 0;
		padding: var(--space-4);
	}
	.book-search-controls__section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-5) 0;
		border-top: 1px solid var(--color-border);
	}
	.book-search-controls__section:first-child {
		padding-top: 0;
		border-top: 0;
	}
	.book-search-dimension__label-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		min-width: 0;
	}
	.book-search-controls__heading {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		line-height: 1.2;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.book-search-methodology p,
	.book-search-board__note {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: 0.8125rem;
		line-height: 1.55;
		color: var(--color-text-muted);
	}
	.book-search-dimension {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.book-search-dimension__label-row label,
	.book-search-dimension__label-row output {
		font-family: var(--font-family-interactive);
		font-size: 0.8125rem;
		line-height: 1.3;
	}
	.book-search-dimension__label-row label {
		min-width: 0;
		font-weight: 600;
		color: var(--color-text);
	}
	.book-search-dimension__label-row output {
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		white-space: nowrap;
	}
	.book-search-dimension input[type='range'] {
		width: 100%;
		margin: 0;
		accent-color: var(--dimension-color, var(--book-search-accent));
		cursor: pointer;
	}
	.book-search-board {
		display: flex;
		grid-column: 2;
		min-width: 0;
		flex-direction: column;
		gap: var(--space-3);
	}
	.book-search-board__surface {
		min-width: 0;
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-card-bg);
	}
	.book-search-board__columns,
	.book-search-board__row {
		display: grid;
		grid-template-columns: 3.25rem minmax(0, 1fr) minmax(7rem, 8.5rem);
		gap: var(--space-3);
		min-width: 0;
	}
	.book-search-board__columns {
		align-items: center;
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--color-border);
		font-family: var(--font-family-interactive);
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		line-height: 1.2;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.book-search-board__columns span:nth-child(3) {
		text-align: right;
	}
	.book-search-board__list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.book-search-board__item {
		margin: 0;
		padding: 0;
		border-bottom: 1px solid var(--color-border);
	}
	.book-search-board__item:last-child {
		border-bottom: 0;
	}
	.book-search-board__row {
		width: 100%;
		align-items: center;
		padding: var(--space-1) 10px;
		border: 0;
		font: inherit;
		text-align: left;
		color: var(--color-text);
		background: transparent;
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease-default);
	}
	.book-search-board__item:hover .book-search-board__row,
	.book-search-board__item--expanded .book-search-board__row {
		background: color-mix(in srgb, var(--book-search-accent) 5%, transparent);
	}
	.book-search-board__rank {
		display: flex;
		align-items: flex-start;
		gap: var(--space-1);
		font-family: var(--font-family-interactive);
		font-variant-numeric: tabular-nums;
	}
	.book-search-board__rank strong {
		font-size: 0.8125rem;
		font-weight: 600;
		line-height: 1.1;
		color: var(--color-text);
	}
	.book-search-board__movement {
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
		padding: 0.125rem 0.25rem;
		border-radius: var(--radius-xs);
		font-size: 0.6875rem;
		font-weight: 600;
		line-height: 1.1;
		color: var(--color-error-text);
		background: var(--color-danger-tonal-bg);
	}
	.book-search-board__movement--up {
		color: var(--color-success-text);
		background: var(--color-success-bg);
	}
	.book-search-board__identity {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--space-2);
		align-items: center;
		min-width: 0;
	}
	.book-search-board__cover {
		display: block;
		width: 24px;
		min-width: 0;
	}
	.book-search-board__cover :global(.book-cover-strip) {
		height: 36px;
		overflow: hidden;
		padding: 0;
	}
	.book-search-board__cover :global(.book-cover-strip__item),
	.book-search-board__cover :global(img),
	.book-search-board__cover :global(.book-cover-strip__fallback) {
		width: 24px;
		height: 36px;
	}
	.book-search-board__identity-copy {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.book-search-board__title {
		font-family: var(--font-family-content);
		font-size: 0.875rem;
		font-weight: 400;
		line-height: 1.18;
		color: var(--color-text);
		text-wrap: balance;
	}
	.book-search-board__author {
		font-family: var(--font-family-interactive);
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}
	.book-search-board__score {
		font-family: var(--font-family-interactive);
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	.book-search-board__score strong {
		font-size: 0.875rem;
		font-weight: 600;
		line-height: 1.1;
		color: var(--color-text);
	}
	.book-search-explanation__header {
		--context-cover-width: 14rem;
		display: grid;
		grid-template-columns: var(--context-cover-width) minmax(0, 1fr);
		align-items: start;
		gap: var(--space-4) var(--space-5);
		grid-template-rows: auto auto 1fr;
	}
	.book-search-explanation__header h2 {
		padding-right: 1.5rem;
		margin: var(--space-1) 0 0;
		font-family: var(--font-family-content);
		font-size: 1.35rem;
		font-weight: 400;
		line-height: 1.15;
		color: var(--color-text);
	}
	.book-search-explanation__author {
		margin: var(--space-1) 0 0;
		font-family: var(--font-family-interactive);
		font-size: 0.8125rem;
		line-height: 1.4;
		color: var(--color-text-muted);
	}
	.book-search-explanation__facts {
		grid-column: 2;
		align-self: start;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		margin: 0;
		text-align: left;
	}
	.book-search-explanation__facts > div {
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.book-search-explanation__facts span,
	.book-search-explanation__facts strong {
		font-family: var(--font-family-interactive);
		font-size: 0.75rem;
		line-height: 1.35;
	}
	.book-search-explanation__facts span {
		font-weight: 400;
		color: var(--color-text-muted);
	}
	.book-search-explanation__facts strong {
		font-size: 0.875rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--color-text);
	}
	.book-search-explanation__volumes {
		margin-top: var(--space-5);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}
	.book-search-explanation__subheading {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.book-search-explanation__volumes ul {
		display: flex;
		gap: var(--space-3);
		margin: var(--space-3) 0 0;
		padding: 0;
		overflow-x: auto;
		list-style: none;
	}
	.book-search-volume {
		display: block;
		min-width: 3.5rem;
		padding: 0;
		border: 0;
		border-radius: var(--radius-xs);
		background: transparent;
		cursor: pointer;
		/* The chosen volume is the one at full strength; the rest of the shelf recedes. */
		opacity: 0.5;
		transition: opacity var(--duration-fast) var(--ease-default);
	}
	.book-search-volume:hover,
	.book-search-volume--active {
		opacity: 1;
	}
	.book-search-about {
		display: grid;
		gap: 0.35rem;
		margin-top: var(--space-3);
		font-family: var(--font-family-interactive);
		font-size: 0.8125rem;
		line-height: 1.45;
	}
	.book-search-about p {
		margin: 0;
	}
	.book-search-about__volume {
		font-weight: 600;
		color: var(--color-text);
	}
	.book-search-about__facts {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	.book-search-about__summary {
		color: var(--color-text);
	}
	.book-search-board__empty {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		padding: clamp(var(--space-6), 7vw, var(--space-12)) var(--space-5);
		font-family: var(--font-family-interactive);
	}
	.book-search-board__empty strong {
		font-family: var(--font-family-content);
		font-size: 1.35rem;
		font-weight: 400;
		color: var(--color-text);
	}
	.book-search-board__empty span {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
	.book-search-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.5rem;
		padding: 0.625rem 0.875rem;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		font-family: var(--font-family-interactive);
		font-size: 0.8125rem;
		font-weight: 600;
		line-height: 1.2;
		cursor: pointer;
		transition:
			background var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
	}

	.book-search-button--secondary {
		border-color: var(--color-border);
		color: var(--color-text);
		background: var(--color-bg-muted);
	}
	.book-search-button--secondary:hover {
		border-color: var(--color-border-hover);
		background: var(--color-interactive-hover-subtle);
	}
	.book-search-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-12) var(--space-4);
		font-family: var(--font-family-interactive);
		font-size: 0.875rem;
		text-align: center;
		color: var(--color-text-muted);
	}
	.book-search-state p {
		margin: 0;
	}
	.book-search-state--error {
		align-items: flex-start;
		justify-content: space-between;
		flex-direction: row;
		padding: var(--space-4);
		border: 1px solid var(--color-error-border);
		border-radius: var(--radius-sm);
		text-align: left;
		color: var(--color-error-text);
		background: var(--color-error-bg);
	}
	.book-search-state--error strong {
		display: block;
		margin-bottom: var(--space-1);
		font-family: var(--font-family-interactive);
		font-size: 0.875rem;
	}
	.book-search-state--error p {
		font-size: 0.8125rem;
		line-height: 1.5;
		color: inherit;
	}
	.book-search-methodology h2 {
		margin: var(--space-2) 0 var(--space-3);
		font-family: var(--font-family-content);
		font-size: clamp(1.5rem, 3vw, 2rem);
		font-weight: 400;
		letter-spacing: -0.02em;
		line-height: 1.1;
		color: var(--color-text);
	}

	@media (max-width: 767px) {
		.book-search-page {
			gap: var(--space-5);
			padding-bottom: var(--space-8);
		}
		.book-search-page__title {
			font-size: clamp(2.5rem, 14vw, 3.5rem);
		}
		.book-search-toolbar {
			gap: var(--space-5);
			padding-bottom: var(--space-4);
		}
		.book-search-toolbar__switches {
			align-items: stretch;
			flex-direction: column;
			gap: var(--space-3);
		}
		.book-search-toolbar__switch-group {
			justify-content: space-between;
			width: 100%;
		}
		.book-search-toolbar__switch-group :global(.nav-style-tabs__wrap),
		.book-search-toolbar__switch-group :global(.nav-style-tabs__list) {
			max-width: 100%;
		}
		.book-search-toolbar__switch-group :global(.nav-style-tabs__tab) {
			padding-inline: var(--space-2);
		}
		.book-search-settings-trigger {
			display: flex;
			align-items: center;
			justify-content: flex-start;
			gap: var(--space-3);
			width: 100%;
			min-height: 3.75rem;
			padding: var(--space-3) var(--space-4);
			border: 1px solid var(--color-border);
			border-radius: var(--radius-sm);
			font: inherit;
			text-align: left;
			color: var(--color-text);
			background: var(--color-card-bg);
			cursor: pointer;
		}
		.book-search-settings-trigger__icon {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 2rem;
			height: 2rem;
			border: 1px solid var(--color-border);
			border-radius: var(--radius-xs);
			font-size: 1.15rem;
			line-height: 1;
			color: var(--color-text-muted);
		}
		.book-search-settings-trigger > span:nth-child(2) {
			display: flex;
			flex: 1;
			flex-direction: column;
			gap: 0.2rem;
			min-width: 0;
		}
		.book-search-settings-trigger strong,
		.book-search-settings-trigger small {
			font-family: var(--font-family-interactive);
			line-height: 1.2;
		}
		.book-search-settings-trigger strong {
			font-size: 0.8125rem;
		}
		.book-search-settings-trigger small {
			font-size: 0.75rem;
			color: var(--color-text-muted);
		}
		.book-search-settings-trigger__chevron {
			font-size: 1.3rem;
			line-height: 1;
			color: var(--color-text-muted);
		}
		.book-search-page__workspace {
			display: block;
		}
		.book-search-sheet {
			position: fixed;
			inset: auto 0 0;
			width: 100%;
			max-width: 100%;
			max-height: min(88dvh, 42rem);
			margin: 0;
			padding: 0;
			border-right: 0;
			border-bottom: 0;
			border-radius: var(--radius-md) var(--radius-md) 0 0;
			color: var(--color-text);
			box-shadow: 0 -0.5rem 2rem rgba(0, 0, 0, var(--primitive-shadow-opacity-medium));
		}
		.book-search-sheet[open] {
			display: flex;
			flex-direction: column;
		}
		.book-search-sheet::backdrop {
			background: var(--color-overlay-scrim);
		}
		.book-search-controls__mobile-header {
			display: flex;
			justify-content: flex-end;
			padding: var(--space-3) var(--space-4) 0;
		}
		.book-search-icon-button {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 2.5rem;
			height: 2.5rem;
			padding: 0;
			border: 1px solid var(--color-border);
			border-radius: var(--radius-pill);
			font-family: var(--font-family-interactive);
			font-size: 1.5rem;
			line-height: 1;
			color: var(--color-text-muted);
			background: transparent;
			cursor: pointer;
		}
		.book-search-controls__body {
			min-height: 0;
			overflow: auto;
			padding: var(--space-4) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
		}
		.book-search-controls__section {
			padding-block: var(--space-4);
		}

		.book-search-board {
			grid-column: auto;
		}
		.book-search-board__columns {
			display: none;
		}
		.book-search-board__columns,
		.book-search-board__row {
			grid-template-columns: 2.5rem minmax(0, 1fr) 4.5rem;
			gap: var(--space-2);
		}
		.book-search-board__movement {
			font-size: 0.625rem;
		}
		.book-search-explanation__header {
			gap: var(--space-3);
		}
		.book-search-explanation__header h2 {
			font-size: 1.15rem;
		}
	}
	@media (max-width: 380px) {
		.book-search-toolbar__switch-group {
			align-items: flex-start;
			flex-direction: column;
			gap: var(--space-1);
		}
		.book-search-toolbar__switch-group :global(.nav-style-tabs__wrap),
		.book-search-toolbar__switch-group :global(.nav-style-tabs__list) {
			width: 100%;
		}
		.book-search-toolbar__switch-group :global(.nav-style-tabs__tab) {
			flex: 1 1 0;
			justify-content: center;
		}
		.book-search-board__columns,
		.book-search-board__row {
			grid-template-columns: 2.1rem minmax(0, 1fr) 4rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.book-search-page *,
		.book-search-page *::before,
		.book-search-page *::after {
			animation-duration: 0.01ms !important;
			animation-iteration-count: 1 !important;
			scroll-behavior: auto !important;
			transition-duration: 0.01ms !important;
		}
	}
	.book-search-explanation,
	.book-search-methodology {
		position: fixed;
		inset: 0;
		margin: auto;
		max-height: 80dvh;
		overflow: auto;
		padding: var(--space-5);
		color: var(--color-text);
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.book-search-methodology:not([open]) {
		display: none;
	}
	.book-search-methodology[open] {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.book-search-explanation::backdrop,
	.book-search-methodology::backdrop {
		background: var(--color-overlay-scrim);
	}
	.book-search-explanation {
		width: min(46rem, calc(100vw - 2rem));
	}
	.book-search-methodology {
		width: min(40rem, calc(100vw - 2rem));
	}
	.book-search-sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	:global(html:has(.book-search-page dialog[open])) {
		overflow: hidden;
	}
	@media (min-width: 768px) {
		.book-search-page {
			flex: 1;
			min-height: 0;
			gap: var(--space-2);
			padding-bottom: 0;
			overflow: hidden;
		}
		.book-search-page__header {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			max-width: none;
			flex: 0 0 auto;
		}
		.book-search-page__title {
			font-size: 1.75rem;
		}

		.book-search-toolbar {
			flex-direction: row;
			align-items: center;
			gap: var(--space-4);
			padding-bottom: var(--space-2);
			flex: 0 0 auto;
		}
		.book-search-toolbar__search {
			flex: 1;
			min-width: 180px;
		}
		.book-search-toolbar__switches {
			gap: var(--space-4);
			flex-wrap: nowrap;
		}

		.book-search-page__panel {
			flex: 1;
			min-height: 0;
			gap: var(--space-2);
		}
		.book-search-page__workspace {
			flex: 1;
			min-height: 0;
			grid-template-columns: 230px minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr);
			align-items: stretch;
			gap: var(--space-3);
		}
		.book-search-controls {
			min-height: 0;
		}
		.book-search-controls__body {
			padding: var(--space-3);
		}
		.book-search-controls__section {
			gap: 6px;
			padding-block: var(--space-2);
		}
		.book-search-board {
			display: flex;
			flex-direction: column;
			min-height: 0;
			gap: 6px;
		}
		.book-search-board__note {
			font-size: 0.6875rem;
		}
		.book-search-board__surface {
			flex: 1;
			min-height: 0;
			display: flex;
			flex-direction: column;
		}
		.book-search-board__columns {
			flex: 0 0 auto;
			padding: 6px 10px;
			overflow-y: auto;
			scrollbar-gutter: stable;
		}
		.book-search-board__list {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
			scrollbar-gutter: stable;
			overscroll-behavior: contain;
		}
		.book-search-board__columns,
		.book-search-board__row {
			grid-template-columns: 3.5rem minmax(0, 1fr) 4.5rem;
			gap: var(--space-2);
		}
		.book-search-board__row {
			height: 46px;
			box-sizing: border-box;
		}
		.book-search-board__identity-copy {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(5rem, 30%);
			align-items: center;
			gap: var(--space-3);
		}
		.book-search-board__title,
		.book-search-board__author {
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.book-search-column-identity {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(5rem, 30%);
			gap: var(--space-3);
			padding-left: var(--space-8);
		}
		.book-search-board__columns .book-search-column-identity span {
			text-align: left;
		}
	}
	@media (max-width: 767px) {
		.book-search-column-identity > span:last-child {
			display: none;
		}
	}
	.book-search-presets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.book-search-preset {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: transparent;
		color: var(--color-text-muted);
		font: 500 0.75rem var(--font-family-interactive);
		cursor: pointer;
	}
	.book-search-preset:hover,
	.book-search-preset[aria-pressed='true'] {
		border-color: var(--book-search-accent);
		background: color-mix(in srgb, var(--book-search-accent) 10%, transparent);
		color: var(--color-text);
	}
	.book-search-feature-label {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 0;
	}

	.book-search-info {
		display: inline-flex;
	}
	.book-search-info button {
		width: 1.125rem;
		height: 1.125rem;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		color: var(--color-text-muted);
		background: transparent;
		font: 0.6875rem var(--font-family-interactive);
		cursor: help;
	}
	.book-search-info [role='tooltip'] {
		position: absolute;
		inset: 1.4rem 0 auto;
		z-index: 2;
		visibility: hidden;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-card-bg);
		color: var(--color-text);
		box-shadow: var(--shadow-card-hover);
		font: 0.75rem/1.5 var(--font-family-interactive);
	}
	.book-search-info:hover [role='tooltip'],
	.book-search-info:focus-within [role='tooltip'] {
		visibility: visible;
	}
	.book-search-info:global(.book-search-info--dismissed) [role='tooltip'] {
		visibility: hidden;
	}
	.book-search-board__row:focus-visible {
		outline: 2px solid var(--book-search-accent);
		outline-offset: -2px;
	}
	.book-search-close {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: 0;
		border-radius: 50%;
		color: var(--color-text-muted);
		background: transparent;
		font-size: 1.5rem;
		cursor: pointer;
	}
	.book-search-close:hover {
		background: var(--color-interactive-hover-subtle);
		color: var(--color-text);
	}
	.book-search-explanation__header > div:nth-child(2) {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.book-search-context-cover {
		grid-row: 1 / span 3;
		align-self: center;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
	}
	.book-search-context-cover :global(.book-cover-strip__item),
	.book-search-context-cover :global(.book-cover-strip__fallback) {
		width: var(--context-cover-width);
		height: calc(var(--context-cover-width) * 1.5);
	}
	.book-search-context-cover :global(.book-cover-strip) {
		padding: 0;
		overflow: hidden;
	}
	.book-search-context-cover :global(img) {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.book-search-methodology-signals {
		margin: 0 0 1rem;
		font: 0.8125rem/1.55 var(--font-family-interactive);
	}
	.book-search-methodology-signals div + div {
		margin-top: 0.75rem;
	}
	.book-search-methodology-signals dt {
		font-weight: 600;
	}
	.book-search-methodology-signals dd {
		margin: 0.125rem 0 0;
		color: var(--color-text-muted);
	}
	.book-search-dimension-cards {
		grid-column: 2;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.875rem;
	}
	.book-search-dimension-card {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.125rem 0.75rem;
		min-width: 0;
		padding: 0;
		font: 0.75rem/1.4 var(--font-family-interactive);
		font-variant-numeric: tabular-nums;
	}
	.book-search-dimension-card + .book-search-dimension-card {
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border);
	}
	.book-search-dimension-card h3 {
		margin: 0 0 0.125rem;
		font-family: var(--font-family-interactive);
		font-size: 0.75rem;
		font-weight: 500;
	}
	.book-search-dimension-card strong {
		font-size: 0.875rem;
		font-weight: 600;
	}
	.book-search-dimension-card > span {
		color: var(--color-text-muted);
	}
	@media (min-width: 481px) and (max-width: 650px) {
		.book-search-explanation__header {
			--context-cover-width: 10rem;
		}
	}
	@media (max-width: 480px) {
		.book-search-explanation__header {
			--context-cover-width: 6rem;
		}
		.book-search-explanation__facts {
			grid-column: 1 / -1;
		}
		.book-search-context-cover {
			grid-row: 1;
		}
		.book-search-explanation__facts span {
			font-size: 0.6875rem;
		}
		.book-search-dimension-cards {
			grid-column: 1 / -1;
		}
	}
</style>
