<script lang="ts">
	import { flip } from 'svelte/animate';
	import ProminenceAuditObservation from '$lib/components/lab/ProminenceAuditObservation.svelte';
	import {
		prominenceTimingMeasure,
		prominenceTimingMark
	} from '$lib/lab/author-prominence/performance';
	import type { RankingEntry } from '$lib/lab/author-prominence/presentation';

	interface Props {
		entries: RankingEntry[];
		hoveredIndex: number | null;
		updating: boolean;
		showUpdating?: boolean;
		reducedMotion?: boolean;
		motionDuration?: number;
		motionIntent?: 'live' | 'commit' | 'preset' | 'restore' | 'none';
		motionRevision?: number;
		animateRows?: boolean;
		onSelect: (index: number) => void;
		onHover: (index: number | null) => void;
	}

	let {
		entries,
		hoveredIndex,
		updating,
		showUpdating = false,
		reducedMotion = false,
		motionDuration = 150,
		motionIntent = 'none',
		motionRevision = 0,
		animateRows = false,
		onSelect,
		onHover
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

	function rowLabel(entry: RankingEntry): string {
		return `${entry.name}, rank ${entry.place}, score ${entry.score}, ${entry.books.toLocaleString()} books, ${entry.recognitions.toLocaleString()} recorded recognitions`;
	}

	function handleRowPointerUp(event: PointerEvent, index: number): void {
		if (event.button !== 0) return;
		if (
			event.target instanceof Element &&
			event.target.closest('.ranking-row__select, .prominence-audit')
		)
			return;
		onSelect(index);
	}

	function handleFocusIn(entry: RankingEntry, event: FocusEvent): void {
		if (event.target instanceof Element && event.target.matches('.ranking-row__select'))
			onHover(entry.index);
	}

	function handleFocusOut(event: FocusEvent): void {
		const row = event.currentTarget as HTMLElement;
		if (!(event.relatedTarget instanceof Node && row.contains(event.relatedTarget))) onHover(null);
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
		aria-label={`Current top ${entries.length} authors`}
	>
		{#each entries as entry (entry.index)}
			<li
				animate:flip={{ duration: rowAnimationDuration }}
				class:ranking-row--highlight={hoveredIndex === entry.index}
				data-author-index={entry.index}
				onpointerenter={() => onHover(entry.index)}
				onpointerleave={() => onHover(null)}
				onfocusin={(event) => handleFocusIn(entry, event)}
				onfocusout={handleFocusOut}
			>
				<div
					class="ranking-row"
					role="presentation"
					onpointerup={(event) => handleRowPointerUp(event, entry.index)}
				>
					<span class="ranking-row__place">{String(entry.place).padStart(2, '0')}</span>
					<div class="ranking-row__main">
						<div class="ranking-row__topline">
							<button
								type="button"
								class="ranking-row__select"
								data-testid="prominence-ranking-row"
								data-author-index={entry.index}
								aria-label={rowLabel(entry)}
								onclick={() => onSelect(entry.index)}
							>
								<strong>{entry.name}</strong>
							</button>
							{#if entry.badges.length > 0}
								<ProminenceAuditObservation
									id={`ranking-${entry.index}`}
									badges={entry.badges}
									compact
								/>
							{/if}
							<b class="ranking-row__score"
								><span class="screen-reader-only">Score </span>{entry.score}</b
							>
						</div>
						<span class="ranking-row__meta"
							>{entry.books.toLocaleString()} books · {entry.recognitions.toLocaleString()} recognitions</span
						>
					</div>
				</div>
			</li>
		{/each}
	</ol>
</section>

<style>
	.prominence-ranking {
		padding-bottom: 12px;
	}
	.prominence-ranking__updating {
		margin: -2px 0 6px;
		color: #f3c964;
		font: 11px var(--font-family-interactive);
	}
	.prominence-ranking__list {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.prominence-ranking__list > li {
		position: relative;
		border-bottom: 1px solid rgba(164, 204, 206, 0.12);
	}
	.prominence-ranking__list > li:first-child {
		border-top: 1px solid rgba(164, 204, 206, 0.12);
	}
	.ranking-row {
		display: grid;
		grid-template-columns: 26px minmax(0, 1fr);
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 46px;
		padding: 4px 6px;
		box-sizing: border-box;
		background: transparent;
		color: #cfe7e8;
		cursor: pointer;
	}
	.ranking-row--highlight .ranking-row {
		background: rgba(32, 56, 54, 0.48);
	}
	.ranking-row__main {
		min-width: 0;
	}
	.ranking-row__topline {
		display: flex;
		align-items: center;
		min-width: 0;
		gap: 6px;
	}
	.ranking-row__place {
		color: rgba(207, 231, 232, 0.5);
		font: 12px var(--font-family-interactive);
		font-variant-numeric: tabular-nums;
	}
	.ranking-row__select {
		min-width: 0;
		max-width: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		color: #efffff;
		text-align: left;
		cursor: pointer;
	}
	.ranking-row__select strong {
		display: block;
		max-width: 100%;
		overflow: hidden;
		font: 600 13px/1.15 var(--font-family-interactive);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ranking-row__select:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 3px;
		border-radius: 3px;
	}
	.ranking-row__score {
		margin-left: auto;
		color: #bce8d8;
		font: 600 12px/1.1 var(--font-family-interactive);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.ranking-row__meta {
		display: block;
		margin-top: 2px;
		color: rgba(207, 231, 232, 0.54);
		font: 11px/1.15 var(--font-family-interactive);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.screen-reader-only {
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
	@media (prefers-reduced-motion: reduce) {
		.ranking-row {
			transition: none;
		}
	}
</style>
