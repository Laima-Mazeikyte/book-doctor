<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/copy';
	import Spinner from '$lib/components/Spinner.svelte';
	import ContributionBars from '$lib/components/lab/ContributionBars.svelte';
	import ProminenceDetail from '$lib/components/lab/ProminenceDetail.svelte';
	import WeightControls from '$lib/components/lab/WeightControls.svelte';
	import { loadRelease, type Release } from '$lib/lab/author-prominence/release';
	import {
		auditBadges,
		barScale,
		contributions,
		formatScore,
		handlePositions,
		isCalibrated,
		normaliseWeights,
		rank
	} from '$lib/lab/author-prominence/score';
	import { ProminenceFormatError } from '$lib/lab/author-prominence/types';

	let release = $state<Release | null>(null);
	let loadError = $state<string | null>(null);

	/** Slider positions, 0–100, in `model.features` order. Seeded from the settled preset. */
	let raw = $state<number[]>([]);
	let activePreset = $state<string | null>(null);
	/**
	 * The preset's own weight vector, held while it is active.
	 *
	 * Handle positions are rounded integers, so deriving the weights back out of them would
	 * drift the settled preset by a fraction of a percent — and that vector is the one the
	 * release was audited at. Reading it directly keeps the presets exact; the first drag
	 * clears it and the handles take over.
	 */
	let presetWeights = $state<number[] | null>(null);
	/** Population index of the author whose composition is on show. */
	let selected = $state<number | null>(null);

	const weights = $derived.by(() => {
		const current = release;
		if (!current) return [];
		return presetWeights ?? normaliseWeights(raw, current.manifest.model.default_weights);
	});

	const ranking = $derived.by(() => {
		const current = release;
		if (!current || raw.length === 0) return null;
		return rank(current.population, weights, current.manifest.model.sigma_z);
	});

	const topIndices = $derived.by(() => {
		const current = release;
		const current_ranking = ranking;
		if (!current || !current_ranking) return [];
		return Array.from(current_ranking.order.slice(0, current.manifest.display.top_n));
	});

	/**
	 * One bar scale for everything on screen, so a contribution of the same size draws the
	 * same width whichever author it belongs to. The selection is included because it may
	 * have dropped out of the top N at the current weights.
	 */
	const scale = $derived.by(() => {
		const current = release;
		const current_ranking = ranking;
		if (!current || !current_ranking) return 1;
		const visible = selected === null ? topIndices : [...topIndices, selected];
		return barScale(current.population, visible, weights, current_ranking.denominator);
	});

	const entries = $derived.by(() => {
		const current = release;
		const current_ranking = ranking;
		if (!current || !current_ranking) return [];
		const { population, manifest } = current;

		return topIndices.map((index, position) => {
			const values = contributions(population, index, weights, current_ranking.denominator);
			return {
				index,
				place: position + 1,
				name: population.names[index],
				score: formatScore(manifest, current_ranking.scores[index]),
				values,
				badges: auditBadges(population, index, values, manifest),
				readers: population.nReaders[index],
				books: population.nBooks[index],
				tier: population.bestTier[index],
				awards: population.nAwards[index]
			};
		});
	});

	function describeError(error: unknown): string {
		if (error instanceof ProminenceFormatError) return t('lab.authorProminence.errors.format');
		return t('lab.authorProminence.errors.load');
	}

	function start(): void {
		loadError = null;
		void loadRelease()
			.then((loaded) => {
				release = loaded;
				raw = handlePositions(loaded.settledPreset.weights);
				presetWeights = loaded.settledPreset.weights;
				activePreset = loaded.settledPreset.name;
			})
			.catch((error) => {
				loadError = describeError(error);
			});
	}

	onMount(start);
</script>

<svelte:head>
	<title>{t('lab.authorProminence.title')} — {t('shared.header.siteName')}</title>
	<meta name="description" content={t('lab.authorProminence.metaDescription')} />
</svelte:head>

<div class="ap-page">
	<header class="ap-page__header">
		<h1 class="ap-page__title typ-display2 typ-display2--content">
			{t('lab.authorProminence.title')}
		</h1>
		<p class="ap-page__lead typ-body">{t('lab.authorProminence.lead')}</p>
	</header>

	{#if loadError}
		<div class="ap-page__error" role="alert">
			<p>{loadError}</p>
			<button type="button" class="btn btn--secondary btn--compact" onclick={start}>
				{t('lab.authorProminence.errors.retry')}
			</button>
		</div>
	{:else if !release || !ranking}
		<div class="ap-page__loading">
			<Spinner />
			<p>{t('lab.authorProminence.loading')}</p>
		</div>
	{:else}
		<p class="ap-page__headline">{release.manifest.disclosure.headline}</p>

		<div class="ap-page__layout">
			<div class="ap-page__controls">
				<WeightControls
					manifest={release.manifest}
					{raw}
					shares={weights}
					{activePreset}
					onSlide={(next) => {
						raw = next;
						// Any manual move leaves the preset behind — it is no longer what is on screen.
						presetWeights = null;
						activePreset = null;
					}}
					onPreset={(name, vector) => {
						raw = handlePositions(vector);
						presetWeights = vector;
						activePreset = name;
					}}
				/>
			</div>

			<div class="ap-page__board">
				<h2 class="ap-page__board-heading">
					{t('lab.authorProminence.board.heading', {
						count: release.manifest.display.top_n,
						total: release.population.count.toLocaleString()
					})}
				</h2>

				<ol class="ap-board">
					{#each entries as entry (entry.index)}
						<li>
							<button
								type="button"
								class="ap-board__row"
								class:ap-board__row--selected={selected === entry.index}
								aria-pressed={selected === entry.index}
								onclick={() => (selected = selected === entry.index ? null : entry.index)}
							>
								<span class="ap-board__place">{entry.place}</span>
								<span class="ap-board__score">{entry.score}</span>
								<span class="ap-board__who">
									<span class="ap-board__name">{entry.name}</span>
									<span class="ap-board__meta">
										{t('lab.authorProminence.board.readers', {
											count: entry.readers.toLocaleString()
										})}
										·
										{t('lab.authorProminence.board.books', {
											count: entry.books.toLocaleString()
										})}
										·
										{entry.tier > 0
											? t('lab.authorProminence.board.awards', {
													count: entry.awards.toLocaleString(),
													tier: entry.tier
												})
											: t('lab.authorProminence.board.noAwards')}
									</span>
									<ContributionBars
										features={release.manifest.model.features}
										labels={release.manifest.model.feature_labels}
										values={entry.values}
										{scale}
									/>
									{#if entry.badges.length > 0}
										<span class="ap-board__badges">
											{#each entry.badges as badge (badge.badge)}
												<span class="ap-board__badge">{badge.badge}</span>
											{/each}
										</span>
									{/if}
								</span>
							</button>
						</li>
					{/each}
				</ol>

				<p class="ap-page__note">
					{isCalibrated(release.manifest)
						? t('lab.authorProminence.board.scaleNoteCalibrated')
						: t('lab.authorProminence.board.scaleNote')}
				</p>
			</div>

			<div class="ap-page__detail">
				<h2 class="ap-page__detail-heading">{t('lab.authorProminence.detail.heading')}</h2>
				{#if selected === null}
					<p class="ap-page__help">{t('lab.authorProminence.detail.empty')}</p>
				{:else}
					<ProminenceDetail
						manifest={release.manifest}
						population={release.population}
						{ranking}
						authorIndex={selected}
						{weights}
						{scale}
					/>
				{/if}
			</div>
		</div>

		<section class="ap-page__about">
			<h2 class="typ-h3">{t('lab.authorProminence.about.heading')}</h2>
			<ul class="ap-page__disclosure">
				{#each release.manifest.disclosure.items as item (item)}
					<li>{item}</li>
				{/each}
			</ul>
			<p class="ap-page__note">
				{t('lab.authorProminence.about.provenance', {
					eligible: release.manifest.quality.eligible_authors.toLocaleString(),
					source: release.manifest.quality.authors_in_source.toLocaleString(),
					books: release.manifest.model.gate.min_books
				})}
			</p>
		</section>
	{/if}
</div>

<style>
	.ap-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		width: 100%;
		min-width: 0;
		padding-bottom: var(--space-8);
	}
	.ap-page__header {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		align-items: center;
		text-align: center;
	}
	.ap-page__title {
		margin: 0;
	}
	.ap-page__lead {
		margin: 0;
		max-width: 44rem;
		color: var(--color-text-muted);
	}
	.ap-page__headline {
		margin: 0;
		text-align: center;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-16);
		font-weight: 600;
		color: var(--color-text);
	}
	.ap-page__loading,
	.ap-page__error {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		align-items: center;
		padding: var(--space-8) 0;
		text-align: center;
	}
	.ap-page__loading p,
	.ap-page__error p {
		margin: 0;
		font-family: var(--font-family-interactive);
		color: var(--color-text-muted);
	}

	.ap-page__layout {
		display: grid;
		gap: var(--space-5);
		align-items: start;
		grid-template-areas:
			'controls'
			'board'
			'detail';
	}
	@media (min-width: 900px) {
		.ap-page__layout {
			grid-template-columns: minmax(0, 19rem) minmax(0, 1fr);
			grid-template-areas:
				'controls board'
				'controls detail';
		}
	}
	@media (min-width: 1280px) {
		.ap-page__layout {
			grid-template-columns: minmax(0, 19rem) minmax(0, 1fr) minmax(0, 21rem);
			grid-template-areas: 'controls board detail';
		}
	}
	.ap-page__controls {
		grid-area: controls;
		min-width: 0;
	}
	.ap-page__board {
		grid-area: board;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.ap-page__detail {
		grid-area: detail;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.ap-page__board-heading,
	.ap-page__detail-heading {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.ap-board {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.ap-board__row {
		display: grid;
		grid-template-columns: 1.75rem 3.5rem minmax(0, 1fr);
		gap: var(--space-3);
		align-items: start;
		width: 100%;
		padding: var(--space-3);
		text-align: left;
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		color: var(--color-text);
		cursor: pointer;
		font: inherit;
		transition:
			border-color var(--duration-fast) var(--ease-default),
			background var(--duration-fast) var(--ease-default);
	}
	.ap-board__row:hover {
		border-color: var(--color-border-hover);
		background: var(--color-bg-hover);
	}
	.ap-board__row:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.ap-board__row--selected {
		border-color: var(--color-accent);
	}
	.ap-board__place {
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}
	.ap-board__score {
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-16);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--color-text);
	}
	.ap-board__who {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.ap-board__name {
		font-family: var(--typ-h3-font-family);
		font-size: var(--primitive-type-size-16);
		color: var(--color-text);
		overflow-wrap: anywhere;
	}
	.ap-board__meta {
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.5;
		color: var(--color-text-muted);
	}
	.ap-board__badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.ap-board__badge {
		padding: 2px var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		color: var(--color-text-muted);
	}

	.ap-page__help,
	.ap-page__note {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.6;
		color: var(--color-text-muted);
	}
	.ap-page__about {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.ap-page__disclosure {
		margin: 0;
		padding-left: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.6;
		color: var(--color-text-muted);
	}
</style>
