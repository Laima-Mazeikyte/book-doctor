<script lang="ts">
	import { t } from '$lib/copy';

	interface Props {
		authors?: string[];
	}

	let { authors = [] }: Props = $props();
</script>

{#if authors.length > 0}
	<p class="recommendation-author-relationships typ-caption">
		<span class="recommendation-author-relationships__label">
			{t('recommendations.becauseYouLikedAuthors')}:
		</span>
		<span>{authors.join(', ')}</span>
	</p>
{/if}

<style>
	.recommendation-author-relationships {
		width: 100%;
		margin: 0;
		color: var(--color-text-muted);
		text-align: center;
	}
	.recommendation-author-relationships__label {
		font-weight: var(--typ-interactive-2-font-weight);
	}
</style>
