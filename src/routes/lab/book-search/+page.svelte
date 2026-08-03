<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/copy';
	import Spinner from '$lib/components/Spinner.svelte';
	import NavStyleTabList from '$lib/components/NavStyleTabList.svelte';
	import ContributionBars from '$lib/components/lab/ContributionBars.svelte';
	import BookRankingControls from '$lib/components/lab/BookRankingControls.svelte';
	import BookCoverStrip from '$lib/components/lab/BookCoverStrip.svelte';
	import {
		barScale,
		formatScore,
		handlePositions,
		matchingIndices,
		normaliseWeights,
		placeOf,
		rank
	} from '$lib/lab/book-search/ranking';
	import { loadDataset, loadRelease, type Release } from '$lib/lab/book-search/release';
	import {
		BookRankingFormatError,
		type BookPopulation,
		type RankingMode,
		type RankingPreset
	} from '$lib/lab/book-search/types';

	interface ControlPreset extends RankingPreset {
		note: string;
	}

	const SEARCH_RESULT_LIMIT = 100;

	const modeItems = [
		{ id: 'best_books', label: t('lab.bookSearch.modes.bestBooks') },
		{ id: 'best_series', label: t('lab.bookSearch.modes.bestSeries') },
		{ id: 'polarizing_books', label: t('lab.bookSearch.modes.polarizingBooks') },
		{ id: 'polarizing_series', label: t('lab.bookSearch.modes.polarizingSeries') }
	] satisfies Array<{ id: RankingMode; label: string }>;

	let release = $state<Release | null>(null);
	let datasets = $state<Partial<Record<RankingMode, BookPopulation>>>({});
	let currentMode = $state<RankingMode>('best_books');
	let query = $state('');
	let selected = $state<number | null>(null);
	let loadError = $state<string | null>(null);
	let loadingMode = $state<RankingMode | null>(null);
	let requestId = 0;

	let raw = $state<number[]>([]);
	let presetWeights = $state<number[] | null>(null);
	let activePreset = $state<string | null>(null);
	let reachShare = $state(0);

	const population = $derived(datasets[currentMode] ?? null);
	const model = $derived(release?.manifest.model[currentMode] ?? null);
	const modeIsPolarizing = $derived(currentMode.startsWith('polarizing_'));

	const weights = $derived.by(() => {
		if (!model) return [];
		return presetWeights ?? normaliseWeights(raw, model.default_weights);
	});

	const featureDetails = $derived.by(() => {
		if (!model) return [];
		return model.features.map((feature) => ({
			id: feature,
			label: t(`lab.bookSearch.features.${feature}.label`),
			blurb: t(`lab.bookSearch.features.${feature}.blurb`)
		}));
	});

	const controlPresets = $derived.by((): ControlPreset[] => {
		if (!release) return [];
		const presetKeys = modeIsPolarizing
			? ['pure', 'cultural', 'broad']
			: ['default', 'regard', 'reach', 'recognition'];
		return release.manifest.presets[currentMode].map((preset, index) => ({
			...preset,
			note: t(
				`lab.bookSearch.presets.${modeIsPolarizing ? 'polarizing' : 'best'}.${
					presetKeys[index] ?? presetKeys[0]
				}`
			)
		}));
	});

	const ranking = $derived.by(() => {
		if (!population || !model || raw.length === 0) return null;
		return rank(population, weights, model.sigma_z, modeIsPolarizing ? reachShare : 0);
	});

	const allMatches = $derived.by(() => {
		if (!population || !ranking) return [];
		return matchingIndices(population, ranking, query);
	});

	const visibleIndices = $derived.by(() => {
		if (!release || !population || !ranking) return [];
		return query.trim()
			? allMatches.slice(0, SEARCH_RESULT_LIMIT)
			: Array.from(ranking.order.slice(0, release.manifest.display.top_n));
	});

	const visibleScale = $derived.by(() => {
		if (!ranking) return 1;
		const indices = selected === null ? visibleIndices : [...visibleIndices, selected];
		return barScale(ranking, indices);
	});

	const selection = $derived.by(() => {
		if (selected === null || !population || !ranking) return null;
		const index = selected;
		const place = placeOf(ranking, index);
		return {
			index,
			place,
			score: formatScore(currentMode, ranking.scores[index]),
			statisticalScore: formatScore(currentMode, ranking.statisticalScores[index]),
			values: ranking.contributions.map((values) => values[index]),
			aheadOf: ((population.count - place) / population.count) * 100,
			title: population.titles[index],
			author: population.authors[index],
			seriesName: population.seriesNames[index],
			volumes: population.constituentBookIds[index].length
		};
	});

	function describeError(error: unknown): string {
		if (error instanceof BookRankingFormatError) return t('lab.bookSearch.errors.format');
		return t('lab.bookSearch.errors.load');
	}

	function seedControls(mode: RankingMode): void {
		if (!release) return;
		const modelForMode = release.manifest.model[mode];
		const preset = release.manifest.presets[mode][0];
		raw = handlePositions(preset.weights);
		presetWeights = preset.weights;
		activePreset = preset.name;
		reachShare = preset.reach_share ?? modelForMode.default_reach_share ?? 0;
	}

	async function chooseMode(nextMode: RankingMode): Promise<void> {
		if (!release) return;
		currentMode = nextMode;
		query = '';
		selected = null;
		loadError = null;
		seedControls(nextMode);

		const thisRequest = ++requestId;
		if (datasets[nextMode]) {
			loadingMode = null;
			return;
		}

		loadingMode = nextMode;
		try {
			const loaded = await loadDataset(release, nextMode);
			if (thisRequest !== requestId) return;
			datasets[nextMode] = loaded;
		} catch (error) {
			if (thisRequest !== requestId) return;
			loadError = describeError(error);
		} finally {
			if (thisRequest === requestId) loadingMode = null;
		}
	}

	function applyPreset(preset: ControlPreset): void {
		raw = handlePositions(preset.weights);
		presetWeights = preset.weights;
		activePreset = preset.name;
		if (preset.reach_share !== undefined) reachShare = preset.reach_share;
	}

	function applyManualWeights(nextRaw: number[]): void {
		raw = nextRaw;
		presetWeights = null;
		activePreset = null;
	}

	function applyReachShare(value: number): void {
		reachShare = value;
		activePreset = null;
	}

	function contributionsFor(index: number): number[] {
		return ranking ? ranking.contributions.map((values) => values[index]) : [];
	}

	function coverIdsFor(index: number): string[] {
		if (!population) return [];
		return currentMode.endsWith('series')
			? population.constituentBookIds[index]
			: [population.itemIds[index]];
	}

	function itemAriaLabel(index: number): string {
		if (!population || !ranking) return '';
		return t('lab.bookSearch.board.itemAriaLabel', {
			title: population.titles[index],
			author: population.authors[index],
			rank: placeOf(ranking, index)
		});
	}

	async function start(): Promise<void> {
		loadError = null;
		try {
			const loaded = await loadRelease();
			release = loaded;
			await chooseMode('best_books');
		} catch (error) {
			loadError = describeError(error);
		}
	}

	onMount(start);
</script>

<svelte:head>
	<title>{t('lab.bookSearch.title')} — {t('shared.header.siteName')}</title>
	<meta name="description" content={t('lab.bookSearch.metaDescription')} />
</svelte:head>

<div class="book-search-page">
	<header class="book-search-page__header">
		<h1 class="book-search-page__title typ-display2 typ-display2--content">
			{t('lab.bookSearch.title')}
		</h1>
		<p class="book-search-page__lead typ-body">{t('lab.bookSearch.lead')}</p>
	</header>

	{#if loadError && !release}
		<div class="book-search-page__error" role="alert">
			<p>{loadError}</p>
			<button type="button" class="btn btn--secondary btn--compact" onclick={start}>
				{t('lab.bookSearch.errors.retry')}
			</button>
		</div>
	{:else if !release || (loadingMode === 'best_books' && !population)}
		<div class="book-search-page__loading" aria-live="polite">
			<Spinner />
			<p>{t('lab.bookSearch.loading')}</p>
		</div>
	{:else}
		<p class="book-search-page__headline">{release.manifest.disclosure.headline}</p>

		<NavStyleTabList
			items={modeItems}
			selectedId={currentMode}
			ariaLabel={t('lab.bookSearch.modes.label')}
			panelId="book-search-panel"
			idPrefix="book-search-mode"
			getCount={(mode) => release?.manifest.quality.items[mode as RankingMode] ?? 0}
			onSelect={(mode) => void chooseMode(mode as RankingMode)}
		/>

		<div
			class="book-search-page__panel"
			id="book-search-panel"
			role="tabpanel"
			aria-labelledby="book-search-mode-{currentMode}"
		>
			<div class="book-search-page__search-row">
				<label class="book-search-page__search-label" for="book-search-query">
					{t('lab.bookSearch.search.label')}
				</label>
				<div class="book-search-page__search-control">
					<input
						id="book-search-query"
						type="search"
						value={query}
						placeholder={t('lab.bookSearch.search.placeholder')}
						autocomplete="off"
						oninput={(event) => {
							query = event.currentTarget.value;
							selected = null;
						}}
					/>
					{#if query}
						<button
							type="button"
							class="book-search-page__clear"
							aria-label={t('lab.bookSearch.search.clear')}
							onclick={() => {
								query = '';
								selected = null;
							}}
						>
							×
						</button>
					{/if}
				</div>
			</div>

			{#if loadError}
				<div class="book-search-page__error" role="alert">
					<p>{loadError}</p>
					<button
						type="button"
						class="btn btn--secondary btn--compact"
						onclick={() => void chooseMode(currentMode)}
					>
						{t('lab.bookSearch.errors.retry')}
					</button>
				</div>
			{:else if loadingMode === currentMode || !population || !ranking}
				<div class="book-search-page__loading" aria-live="polite">
					<Spinner />
					<p>{t('lab.bookSearch.loading')}</p>
				</div>
			{:else}
				<div class="book-search-page__layout">
					<aside class="book-search-page__controls">
						<BookRankingControls
							features={featureDetails}
							{raw}
							shares={weights}
							presets={controlPresets}
							{activePreset}
							showReachControl={modeIsPolarizing}
							{reachShare}
							onSlide={applyManualWeights}
							onPreset={applyPreset}
							onReachShare={applyReachShare}
						/>
					</aside>

					<section class="book-search-page__board" aria-labelledby="book-search-board-heading">
						<div class="book-search-page__board-header">
							<h2 class="book-search-page__board-heading" id="book-search-board-heading">
								{query
									? t('lab.bookSearch.board.searchHeading', {
											count: allMatches.length.toLocaleString()
										})
									: t('lab.bookSearch.board.heading', {
											count: release.manifest.display.top_n,
											total: population.count.toLocaleString()
										})}
							</h2>
							<p class="book-search-page__board-note" aria-live="polite">
								{query && allMatches.length > SEARCH_RESULT_LIMIT
									? t('lab.bookSearch.board.showingLimited', {
											shown: visibleIndices.length,
											total: allMatches.length
										})
									: query
										? t('lab.bookSearch.board.showing', { count: visibleIndices.length })
										: t('lab.bookSearch.board.defaultNote')}
							</p>
						</div>

						<ol class="book-search-board" aria-label={t('lab.bookSearch.board.listLabel')}>
							{#each visibleIndices as index (index)}
								<li>
									<button
										type="button"
										class="book-search-board__row"
										class:book-search-board__row--selected={selected === index}
										aria-pressed={selected === index}
										aria-label={itemAriaLabel(index)}
										onclick={() => (selected = selected === index ? null : index)}
									>
										<span class="book-search-board__place">{placeOf(ranking, index)}</span>
										<span class="book-search-board__score"
											>{formatScore(currentMode, ranking.scores[index])}</span
										>
										<span class="book-search-board__identity">
											<BookCoverStrip bookIds={coverIdsFor(index)} />
											<span class="book-search-board__title">{population.titles[index]}</span>
											<span class="book-search-board__meta">
												{population.authors[index]}
												{#if population.seriesNames[index]}
													<span class="book-search-board__dot">·</span>
													{population.seriesNames[index]}
												{/if}
											</span>
											<ContributionBars
												features={model?.features ?? []}
												labels={Object.fromEntries(
													featureDetails.map((feature) => [feature.id, feature.label])
												)}
												values={contributionsFor(index)}
												scale={visibleScale}
											/>
										</span>
									</button>
								</li>
							{:else}
								<li class="book-search-board__empty">
									{t('lab.bookSearch.board.noMatches')}
								</li>
							{/each}
						</ol>

						<p class="book-search-page__note">
							{modeIsPolarizing
								? t('lab.bookSearch.board.polarizingNote')
								: t('lab.bookSearch.board.scoreNote')}
						</p>
					</section>

					<aside class="book-search-page__detail" aria-labelledby="book-search-selection-heading">
						<h2 class="book-search-page__detail-heading" id="book-search-selection-heading">
							{t('lab.bookSearch.detail.heading')}
						</h2>
						{#if !selection}
							<p class="book-search-page__help">{t('lab.bookSearch.detail.empty')}</p>
						{:else}
							<section class="book-search-detail">
								<h3 class="book-search-detail__title">{selection.title}</h3>
								<p class="book-search-detail__meta">
									{selection.author}
									{#if selection.seriesName}
										<span class="book-search-board__dot">·</span>
										{selection.seriesName}
									{/if}
								</p>
								<BookCoverStrip bookIds={coverIdsFor(selection.index)} />

								<dl class="book-search-detail__facts">
									<div>
										<dt>{t('lab.bookSearch.detail.score')}</dt>
										<dd>{selection.score}</dd>
									</div>
									<div>
										<dt>{t('lab.bookSearch.detail.rank')}</dt>
										<dd>
											{selection.place.toLocaleString()} of {population.count.toLocaleString()}
										</dd>
									</div>
									<div>
										<dt>{t('lab.bookSearch.detail.aheadOf')}</dt>
										<dd>{selection.aheadOf >= 99.95 ? '>99.9' : selection.aheadOf.toFixed(1)}%</dd>
									</div>
									<div>
										<dt>{t('lab.bookSearch.detail.kind')}</dt>
										<dd>
											{currentMode.endsWith('series')
												? t('lab.bookSearch.detail.series')
												: t('lab.bookSearch.detail.book')}
										</dd>
									</div>
									{#if modeIsPolarizing}
										<div>
											<dt>{t('lab.bookSearch.detail.statisticalScore')}</dt>
											<dd>{selection.statisticalScore}</dd>
										</div>
									{/if}
									{#if currentMode.endsWith('series') && selection.volumes > 0}
										<div>
											<dt>{t('lab.bookSearch.detail.volumes')}</dt>
											<dd>{selection.volumes.toLocaleString()}</dd>
										</div>
									{/if}
								</dl>

								<h4 class="book-search-detail__heading">
									{t('lab.bookSearch.detail.composition')}
								</h4>
								<ContributionBars
									features={model?.features ?? []}
									labels={Object.fromEntries(
										featureDetails.map((feature) => [feature.id, feature.label])
									)}
									values={selection.values}
									scale={visibleScale}
								/>
								<p class="book-search-detail__note">
									{modeIsPolarizing
										? t('lab.bookSearch.detail.polarizingNote')
										: t('lab.bookSearch.detail.scoreNote')}
								</p>
							</section>
						{/if}
					</aside>
				</div>
			{/if}
		</div>

		<section class="book-search-page__about">
			<h2 class="typ-h3">{t('lab.bookSearch.about.heading')}</h2>
			<p>{release.manifest.disclosure.headline}</p>
			<ul>
				{#each release.manifest.disclosure.items as item (item)}
					<li>{item}</li>
				{/each}
			</ul>
			<p class="book-search-page__provenance">
				{t('lab.bookSearch.about.provenance', {
					version: release.manifest.version,
					count: release.manifest.quality.items[currentMode].toLocaleString()
				})}
			</p>
		</section>
	{/if}
</div>

<style>
	.book-search-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		width: 100%;
		min-width: 0;
		padding-bottom: var(--space-8);
	}
	.book-search-page__header {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		align-items: center;
		text-align: center;
	}
	.book-search-page__title {
		margin: 0;
	}
	.book-search-page__lead {
		margin: 0;
		max-width: 44rem;
		color: var(--color-text-muted);
	}
	.book-search-page__headline {
		margin: 0;
		text-align: center;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-16);
		font-weight: 600;
		color: var(--color-text);
	}
	.book-search-page__panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		min-width: 0;
	}
	.book-search-page__search-row {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-width: 42rem;
	}
	.book-search-page__search-label,
	.book-search-page__detail-heading,
	.book-search-page__board-heading {
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.book-search-page__search-label {
		color: var(--color-text);
	}
	.book-search-page__search-control {
		position: relative;
		display: flex;
		align-items: center;
	}
	.book-search-page__search-control input {
		width: 100%;
		min-height: var(--min-tap);
		padding: var(--space-2) 2.75rem var(--space-2) var(--space-3);
		font: inherit;
		color: var(--color-text);
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}
	.book-search-page__search-control input:focus-visible {
		outline: none;
		border-color: var(--color-focus);
		box-shadow: var(--shadow-focus-input);
	}
	.book-search-page__clear {
		position: absolute;
		right: var(--space-1);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--min-tap);
		height: var(--min-tap);
		font-size: 1.25rem;
		line-height: 1;
		color: var(--color-text-muted);
		background: transparent;
		border: 0;
		border-radius: var(--radius-pill);
		cursor: pointer;
	}
	.book-search-page__clear:hover {
		color: var(--color-text);
		background: var(--color-interactive-hover-subtle);
	}
	.book-search-page__clear:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: -2px;
	}
	.book-search-page__layout {
		display: grid;
		gap: var(--space-5);
		align-items: start;
		grid-template-areas:
			'controls'
			'board'
			'detail';
	}
	@media (min-width: 56.25rem) {
		.book-search-page__layout {
			grid-template-columns: minmax(0, 19rem) minmax(0, 1fr);
			grid-template-areas:
				'controls board'
				'controls detail';
		}
	}
	@media (min-width: 80rem) {
		.book-search-page__layout {
			grid-template-columns: minmax(0, 19rem) minmax(0, 1fr) minmax(0, 21rem);
			grid-template-areas: 'controls board detail';
		}
	}
	.book-search-page__controls {
		grid-area: controls;
		min-width: 0;
	}
	.book-search-page__board {
		grid-area: board;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.book-search-page__detail {
		grid-area: detail;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.book-search-page__board-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.book-search-page__board-heading,
	.book-search-page__detail-heading {
		margin: 0;
	}
	.book-search-page__board-note,
	.book-search-page__help,
	.book-search-page__note,
	.book-search-page__about p,
	.book-search-page__about li,
	.book-search-page__provenance {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.6;
		color: var(--color-text-muted);
	}
	.book-search-board {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.book-search-board > li {
		margin: 0;
		padding: 0;
		border-bottom: 1px solid var(--color-border);
	}
	.book-search-board__row {
		display: grid;
		grid-template-columns: 2.25rem 4rem minmax(0, 1fr);
		gap: var(--space-3);
		align-items: start;
		width: 100%;
		padding: var(--space-3) var(--space-2);
		text-align: left;
		font: inherit;
		color: var(--color-text);
		background: transparent;
		border: 0;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.book-search-board__row:hover {
		background: var(--color-interactive-hover-subtle);
	}
	.book-search-board__row:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: -2px;
	}
	.book-search-board__row--selected {
		background: var(--color-accent-bg);
	}
	.book-search-board__place,
	.book-search-board__score {
		padding-top: 0.125rem;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}
	.book-search-board__score {
		font-weight: 600;
		color: var(--color-text);
	}
	.book-search-board__identity {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.book-search-board__title {
		font-family: var(--typ-h3-font-family);
		font-size: var(--primitive-type-size-18);
		line-height: 1.3;
		overflow-wrap: anywhere;
	}
	.book-search-board__meta,
	.book-search-detail__meta {
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.5;
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}
	.book-search-board__dot {
		padding: 0 var(--space-1);
	}
	.book-search-board__empty {
		padding: var(--space-5) var(--space-2);
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		color: var(--color-text-muted);
	}
	.book-search-page__error,
	.book-search-page__loading {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		align-items: center;
		padding: var(--space-8) 0;
		text-align: center;
	}
	.book-search-page__error {
		align-items: flex-start;
		padding: var(--space-4);
		text-align: left;
		background: var(--color-error-bg);
		border: 1px solid var(--color-error-border);
		border-radius: var(--radius);
		color: var(--color-error-text);
	}
	.book-search-page__error p,
	.book-search-page__loading p {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		color: var(--color-text-muted);
	}
	.book-search-page__error p {
		color: inherit;
	}
	.book-search-detail {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		min-width: 0;
	}
	.book-search-detail__title {
		margin: 0;
		font-family: var(--typ-h3-font-family);
		font-size: var(--primitive-type-size-20);
		letter-spacing: var(--typ-h3-letter-spacing);
		color: var(--color-text);
		overflow-wrap: anywhere;
	}
	.book-search-detail__meta {
		margin: calc(var(--space-3) * -1) 0 0;
	}
	.book-search-detail__facts {
		display: flex;
		flex-direction: column;
		margin: 0;
	}
	.book-search-detail__facts > div {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--space-3);
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--color-border);
	}
	.book-search-detail__facts dt,
	.book-search-detail__facts dd {
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
	}
	.book-search-detail__facts dt {
		color: var(--color-text-muted);
	}
	.book-search-detail__facts dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
		text-align: right;
		color: var(--color-text);
	}
	.book-search-detail__heading {
		margin: var(--space-2) 0 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.book-search-detail__note {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.6;
		color: var(--color-text-muted);
	}
	.book-search-page__about {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		max-width: 48rem;
		margin-top: var(--space-4);
		padding-top: var(--space-5);
		border-top: 1px solid var(--color-border);
	}
	.book-search-page__about h2 {
		margin: 0;
	}
	.book-search-page__about ul {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding-left: 1.25rem;
	}
	.book-search-page__provenance {
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-border);
		font-variant-numeric: tabular-nums;
	}
	@media (max-width: 30rem) {
		.book-search-board__row {
			grid-template-columns: 2rem 3.5rem minmax(0, 1fr);
			gap: var(--space-2);
			padding-inline: 0;
		}
	}
</style>
