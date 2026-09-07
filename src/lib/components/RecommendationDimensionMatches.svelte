<script lang="ts">
	import { t } from '$lib/copy';
	import {
		dimensionMatchCopyKey,
		normalizeDimensionMatches,
		type DimensionMatch
	} from '$lib/recommendations/dimensionMatches';
	let { matches = [] }: { matches?: DimensionMatch[] } = $props();
	const validMatches = $derived(normalizeDimensionMatches(matches).slice(0, 3));
</script>

{#if validMatches.length > 0}
	<ul class="recommendation-dimension-matches typ-caption">
		{#each validMatches as match (match.dimension_key)}
			<li>
				{t('recommendations.dimensionMatches.preference', {
					phrase: t(dimensionMatchCopyKey(match))
				})}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.recommendation-dimension-matches {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		width: 100%;
		margin: 0;
		padding: 0;
		list-style: none;
		color: var(--color-text-muted);
	}
</style>
