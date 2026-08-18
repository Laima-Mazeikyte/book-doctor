<script lang="ts">
	import { flip } from 'svelte/animate';
	import type { DisplayModel } from '$lib/lab/author-prominence/display';
	import {
		prominenceTimingMeasure,
		prominenceTimingMark
	} from '$lib/lab/author-prominence/performance';
	import type { RankingEntry } from '$lib/lab/author-prominence/presentation';

	interface Props {
		display: DisplayModel;
		entries: RankingEntry[];
		barScale: number;
		updating: boolean;
		showUpdating?: boolean;
		reducedMotion?: boolean;
		motionDuration?: number;
		motionIntent?: 'live' | 'commit' | 'preset' | 'restore' | 'none';
		motionRevision?: number;
		animateRows?: boolean;
		onSelect: (index: number) => void;
	}

	let {
		display,
		entries,
		barScale,
		updating,
		showUpdating = false,
		reducedMotion = false,
		motionDuration = 150,
		motionIntent = 'none',
		motionRevision = 0,
		animateRows = false,
		onSelect
	}: Props = $props();
	let rankingList: HTMLOListElement | null = $state(null);

	const shouldAnimateRows = $derived(
		animateRows &&
			motionRevision > 0 &&
			!reducedMotion &&
			motionIntent !== 'live' &&
			motionIntent !== 'none'
	);
	const rowAnimationDuration = $derived(shouldAnimateRows ? Math.max(0, motionDuration) : 0);

	$effect(() => {
		void entries;
		void motionRevision;
		if (shouldAnimateRows) {
			const rowMark = prominenceTimingMark('row-measure');
			if (rowMark) {
				rankingList?.getBoundingClientRect();
				prominenceTimingMeasure('row-measure', rowMark);
			}
			const flipMark = prominenceTimingMark('flip-setup');
			prominenceTimingMeasure('flip-setup', flipMark);
		}
	});

	function valueLabel(value: number): string {
		return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
	}

	function rowLabel(entry: RankingEntry): string {
		const features = display.features
			.map((feature, index) => `${feature.label} ${valueLabel(entry.values[index] ?? 0)}`)
			.join(', ');
		const evidence = `${entry.readers.toLocaleString()} readers, ${entry.books.toLocaleString()} books, ${entry.tier ? `${entry.awards.toLocaleString()} awards` : 'no recorded recognition'}`;
		return `${entry.name}, rank ${entry.place}, ${entry.score}. ${features}. ${evidence}.${entry.observation ? ` ${entry.observation}` : ''}`;
	}
</script>

<section
	class="prominence-ranking"
	aria-label="Author ranking"
	aria-busy={updating}
	data-row-motion-duration={rowAnimationDuration}
	data-row-motion-intent={motionIntent}
	data-row-motion-revision={motionRevision}
	data-testid="prominence-ranking-panel"
>
	{#if showUpdating}<p class="prominence-ranking__updating" role="status">
			Updating the ranking…
		</p>{/if}
	<ol
		bind:this={rankingList}
		class="prominence-ranking__list"
		aria-label={`Current top ${display.topN} authors`}
	>
		{#snippet rowContents(entry: RankingEntry)}
			<button
				type="button"
				class="ranking-row"
				data-testid="prominence-ranking-row"
				title={entry.badges[0]?.badge}
				aria-label={rowLabel(entry)}
				onclick={() => onSelect(entry.index)}
			>
				<span class="ranking-row__place">{String(entry.place).padStart(2, '0')}</span>
				<span class="ranking-row__main">
					<span class="ranking-row__topline">
						<strong>{entry.name}</strong>
						{#if entry.badges.length}<span
								class="audit-marker"
								title={entry.badges[0].badge}
								aria-label={`Observation: ${entry.badges[0].badge}`}>!</span
							>{/if}
						<b>{entry.score}</b>
					</span>
					<span class="ranking-row__meta"
						>{entry.readers.toLocaleString()} readers · {entry.books.toLocaleString()} books · {entry.tier
							? `${entry.awards.toLocaleString()} awards`
							: 'no recorded recognition'}</span
					>
					<span
						class="ranking-row__contributions"
						aria-label={display.features
							.map((feature, index) => `${feature.label} ${valueLabel(entry.values[index] ?? 0)}`)
							.join(', ')}
					>
						{#each entry.values as value, index (display.features[index]?.key ?? index)}
							<span class="contribution-lane" aria-hidden="true"
								><i
									class:negative={value < 0}
									style:--bar-colour={display.features[index]?.colour}
									style:width={`${Math.min(Math.abs(value) / barScale, 1) * 50}%`}
								></i></span
							>
						{/each}
					</span>
				</span>
			</button>
		{/snippet}
		{#each entries as entry (entry.index)}
			<li animate:flip={{ duration: rowAnimationDuration }} data-author-index={entry.index}>
				{@render rowContents(entry)}
			</li>
		{/each}
	</ol>
</section>

<style>
	.prominence-ranking {
		padding-bottom: 16px;
	}
	.prominence-ranking__updating {
		margin: -2px 0 8px;
		color: #f3c964;
		font: 11px var(--font-family-interactive);
	}
	.prominence-ranking__list {
		display: grid;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.ranking-row {
		display: grid;
		grid-template-columns: 26px minmax(0, 1fr);
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 58px;
		padding: 5px 8px;
		border: 1px solid transparent;
		border-radius: 7px;
		background: rgba(15, 29, 29, 0.54);
		color: #cfe7e8;
		text-align: left;
		cursor: pointer;
	}
	.ranking-row:hover,
	.ranking-row:focus-visible {
		border-color: rgba(164, 204, 206, 0.25);
		background: rgba(32, 56, 54, 0.62);
	}
	.ranking-row__place {
		color: rgba(207, 231, 232, 0.5);
		font: 12px var(--font-family-interactive);
		font-variant-numeric: tabular-nums;
	}
	.ranking-row__main {
		min-width: 0;
	}
	.ranking-row__topline {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.ranking-row__topline strong {
		min-width: 0;
		overflow: hidden;
		color: #efffff;
		font: 600 13px/1.1 var(--font-family-interactive);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ranking-row__topline b {
		margin-left: auto;
		color: #bce8d8;
		font: 600 12px/1.1 var(--font-family-interactive);
		font-variant-numeric: tabular-nums;
	}
	.ranking-row__meta {
		display: block;
		margin-top: 3px;
		overflow: hidden;
		color: rgba(207, 231, 232, 0.54);
		font: 11px/1.15 var(--font-family-interactive);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.audit-marker {
		display: inline-grid;
		width: 18px;
		height: 18px;
		place-items: center;
		border: 1px solid rgba(243, 201, 100, 0.5);
		border-radius: 50%;
		color: #f3c964;
		font: 700 10px var(--font-family-interactive);
	}
	.ranking-row__contributions {
		display: grid;
		grid-template-columns: repeat(3, minmax(20px, 1fr));
		gap: 3px;
		margin-top: 5px;
	}
	.contribution-lane {
		position: relative;
		display: block;
		height: 7px;
		overflow: hidden;
		border-radius: 3px;
		background: linear-gradient(
			90deg,
			rgba(207, 231, 232, 0.12) 49%,
			rgba(207, 231, 232, 0.34) 50%,
			rgba(207, 231, 232, 0.12) 51%
		);
	}
	.contribution-lane i {
		position: absolute;
		top: 1px;
		left: 50%;
		display: block;
		height: 5px;
		border-radius: 3px;
		background: var(--bar-colour);
	}
	.contribution-lane i.negative {
		right: 50%;
		left: auto;
	}
	.negative {
		color: #efaa94;
	}
	@media (prefers-reduced-motion: reduce) {
		.ranking-row {
			transition: none;
		}
	}
</style>
