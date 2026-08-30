<script lang="ts">
	import { t } from '$lib/copy';
	import ProminenceAuthorCovers from '$lib/components/lab/ProminenceAuthorCovers.svelte';
	import ProminenceAuditObservation from '$lib/components/lab/ProminenceAuditObservation.svelte';
	import ProminenceContributionBar from '$lib/components/lab/ProminenceContributionBar.svelte';
	import ProminenceDimensionStandings from '$lib/components/lab/ProminenceDimensionStandings.svelte';
	import ProminencePeakRank from '$lib/components/lab/ProminencePeakRank.svelte';
	import ProminenceRecognitionReceipts from '$lib/components/lab/ProminenceRecognitionReceipts.svelte';
	import ProminenceSimilarProfiles, {
		type SimilarProfileRow
	} from '$lib/components/lab/ProminenceSimilarProfiles.svelte';
	import type { DisplayFeature } from '$lib/lab/author-prominence/display';
	import type { DimensionStandings } from '$lib/lab/author-prominence/standings';
	import type {
		AuthorBook,
		NormalizedAuthorDetail,
		ProminenceManifest
	} from '$lib/lab/author-prominence/types';
	import type {
		ContributionSegment,
		SelectedAuthorSnapshot
	} from '$lib/lab/author-prominence/presentation';

	const COVER_SKELETONS = [0, 1, 2, 3] as const;

	type DetailStatus = 'loading' | 'ready' | 'error';

	interface Props {
		selected: SelectedAuthorSnapshot | null;
		segments: ContributionSegment[];
		manifest: ProminenceManifest;
		features: DisplayFeature[];
		currentWeights: ArrayLike<number>;
		detail: NormalizedAuthorDetail | null;
		detailStatus: DetailStatus;
		standings: DimensionStandings | null;
		similarProfiles: SimilarProfileRow[];
		onClear: () => void;
		onRetry: () => void;
		onUseBestMix: () => void;
		onSelectSimilar: (index: number) => void;
		onHoverSimilar: (index: number | null) => void;
		onOpenBook: (book: AuthorBook, trigger: HTMLButtonElement) => void;
	}

	let {
		selected,
		segments,
		manifest,
		features,
		currentWeights,
		detail,
		detailStatus,
		standings,
		similarProfiles,
		onClear,
		onRetry,
		onUseBestMix,
		onSelectSimilar,
		onHoverSimilar,
		onOpenBook
	}: Props = $props();

	function catalogueYears(years: [number, number] | null): string {
		if (!years) return '';
		const present = t('lab.authorProminence.detail.present');
		const minimum = years[0] >= 2025 ? present : String(years[0]);
		const maximum = years[1] >= 2025 ? present : String(years[1]);
		return minimum === maximum ? minimum : `${minimum}–${maximum}`;
	}
</script>

{#if selected}
	<section
		class="prominence-inspector"
		aria-labelledby="inspector-heading"
		data-testid="prominence-inspector"
	>
		<button type="button" class="prominence-inspector__back" onclick={onClear}>← Ranking</button>
		<div class="prominence-inspector__title">
			<h2 id="inspector-heading" tabindex="-1">{selected.name}</h2>
			<ProminenceAuditObservation id={`inspector-${selected.index}`} badges={selected.badges} />
		</div>

		<div class="prominence-inspector__current" aria-label="Current prominence">
			<div class="prominence-inspector__metric">
				<span>Current rank</span>
				<strong aria-label={`Current rank ${selected.place}`}
					>#{selected.place.toLocaleString()}</strong
				>
			</div>
			<span class="prominence-inspector__separator" aria-hidden="true">&middot;</span>
			<div class="prominence-inspector__metric prominence-inspector__metric--score">
				<span>Current score</span>
				<ProminenceContributionBar
					{segments}
					score={selected.score}
					scoreAriaLabel={`Current score ${selected.score}`}
				/>
			</div>
		</div>
		{#if detailStatus === 'ready' && detail && (detail.catalogueYears || detail.genres.length > 0)}
			<section class="prominence-catalogue" data-testid="prominence-catalogue">
				{#if detail.catalogueYears}
					<span>{catalogueYears(detail.catalogueYears)}</span>
				{/if}
				{#each detail.genres as genre (genre)}<span class="prominence-catalogue__genre"
						>{genre}</span
					>{/each}
			</section>
		{/if}
		<div
			class="prominence-inspector__enrichment"
			aria-busy={detailStatus === 'loading'}
			data-testid="prominence-enrichment"
		>
			{#if detailStatus === 'loading'}
				<span class="prominence-sr-only" role="status" aria-live="polite"
					>Loading author details</span
				>
				<div class="prominence-skeleton__covers" aria-hidden="true">
					{#each COVER_SKELETONS as slot (slot)}
						<span></span>
					{/each}
				</div>
				<div class="prominence-skeleton__facts" aria-hidden="true">
					<span></span><span></span><span></span>
				</div>
			{:else if detailStatus === 'error'}
				<div class="prominence-inspector__error" role="status">
					<span>{t('lab.authorProminence.detail.unavailable')}</span>
					<button type="button" onclick={onRetry}>{t('lab.authorProminence.detail.retry')}</button>
				</div>
			{:else if detail}
				<ProminenceAuthorCovers books={detail.books} {onOpenBook} />
				<ProminenceDimensionStandings
					{features}
					{standings}
					authorIndex={selected.index}
					populationCount={manifest.details.author_count}
				/>
				<ProminencePeakRank {detail} {features} {currentWeights} {onUseBestMix} />
				<ProminenceRecognitionReceipts receipts={detail.recognition} />
				<ProminenceSimilarProfiles
					profiles={similarProfiles}
					onSelect={onSelectSimilar}
					onHover={onHoverSimilar}
				/>
			{/if}
		</div>
	</section>
{/if}

<style>
	.prominence-inspector {
		padding: 4px 0 20px;
	}
	.prominence-inspector__back {
		min-height: 44px;
		margin: 0 0 9px;
		padding: 3px 0;
		border: 0;
		background: transparent;
		color: rgba(207, 231, 232, 0.7);
		font: 600 12px var(--font-family-interactive);
		cursor: pointer;
	}
	.prominence-inspector__back:hover {
		color: #efffff;
	}
	.prominence-inspector__back:focus-visible,
	.prominence-inspector__error button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 3px;
		border-radius: 3px;
	}
	.prominence-inspector__title {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.prominence-inspector h2 {
		min-width: 0;
		margin: 0;
		overflow: hidden;
		color: #efffff;
		font: 500 26px/1.05 var(--font-family-content);
		letter-spacing: -0.02em;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.prominence-inspector__current {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px 10px;
		margin: 10px 0 8px;
	}
	.prominence-inspector__current > div {
		display: inline-flex;
		align-items: center;
		min-width: 0;
		gap: 5px;
	}
	.prominence-inspector__separator {
		color: rgba(207, 231, 232, 0.4);
		font: 14px/1 var(--font-family-interactive);
	}
	.prominence-inspector__current > div > span:first-child {
		color: rgba(207, 231, 232, 0.58);
		font: 10px var(--font-family-interactive);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.prominence-inspector__current > div > strong {
		color: #efffff;
		font: 650 20px var(--font-family-interactive);
		font-variant-numeric: tabular-nums;
	}
	.prominence-inspector__metric--score > :global(.prominence-contribution) {
		flex: 0 0 auto;
	}
	.prominence-inspector__enrichment {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0;
		margin-top: 15px;
	}
	.prominence-inspector__error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		min-height: 44px;
		padding: 8px 10px;
		box-sizing: border-box;
		border: 1px solid rgba(224, 165, 47, 0.3);
		border-radius: 5px;
		background: rgba(224, 165, 47, 0.07);
		color: rgba(243, 201, 100, 0.9);
		font: 11px var(--font-family-interactive);
	}
	.prominence-inspector__error button {
		min-height: 36px;
		padding: 5px 9px;
		border: 1px solid rgba(243, 201, 100, 0.45);
		border-radius: 4px;
		background: transparent;
		color: #f3c964;
		cursor: pointer;
		font: 600 11px var(--font-family-interactive);
	}
	.prominence-catalogue {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		padding-top: 16px;
		border-top: 1px solid rgba(164, 204, 206, 0.14);
		color: rgba(207, 231, 232, 0.68);
		font: 11px/1.25 var(--font-family-interactive);
	}
	.prominence-catalogue__genre {
		padding: 4px 6px;
		border: 1px solid rgba(164, 204, 206, 0.2);
		border-radius: 999px;
		color: rgba(207, 231, 232, 0.76);
	}
	.prominence-skeleton__covers {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 7px;
	}
	.prominence-skeleton__covers span {
		display: block;
		aspect-ratio: 2 / 3;
		border-radius: 4px;
		background: rgba(207, 231, 232, 0.1);
	}
	.prominence-skeleton__facts {
		display: grid;
		gap: 8px;
		margin-top: 15px;
	}
	.prominence-skeleton__facts span {
		display: block;
		width: 62%;
		height: 12px;
		border-radius: 3px;
		background: rgba(207, 231, 232, 0.1);
	}
	.prominence-skeleton__facts span:nth-child(2) {
		width: 44%;
	}
	.prominence-skeleton__facts span:nth-child(3) {
		width: 76%;
	}
	.prominence-sr-only {
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
	@media (max-width: 430px) {
		.prominence-inspector h2 {
			font-size: 23px;
		}
	}
</style>
