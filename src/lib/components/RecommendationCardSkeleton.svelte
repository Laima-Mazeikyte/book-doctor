<script lang="ts">
	// Skeleton placeholder matching RecommendationCard dimensions (same base as BookCard).
</script>

<article class="recommendation-card-skeleton" aria-hidden="true">
	<div class="recommendation-card-skeleton__media">
		<div class="recommendation-card-skeleton__media-inner">
			<div class="recommendation-card-skeleton__cover"></div>
		</div>
	</div>
	<div class="recommendation-card-skeleton__body"></div>
</article>

<style>
	.recommendation-card-skeleton {
		display: flex;
		flex-direction: column;
		height: 100%;
		width: 100%;
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		box-shadow: var(--shadow-card);
	}
	.recommendation-card-skeleton__media {
		flex: 0 0 auto;
		aspect-ratio: 2 / 3;
		width: 100%;
		min-height: 0;
		padding: 0 var(--space-2);
		padding-top: var(--space-2);
	}
	.recommendation-card-skeleton__media-inner {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		border-radius: var(--radius-sm);
	}
	.recommendation-card-skeleton__cover {
		width: 100%;
		height: 100%;
		background: var(--color-card-placeholder-bg);
		border-radius: var(--radius-sm);
	}
	.recommendation-card-skeleton__body {
		flex: 0 0 auto;
		min-height: 3.75rem;
		padding: 8px;
	}
</style>
