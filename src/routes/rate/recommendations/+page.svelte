<script lang="ts">
	import { ratingsStore } from '$lib/stores/ratings';
</script>

<div class="recommendations-page">
	<h1>Recommendations</h1>
	<p class="recommendations-page__placeholder">
		Recommendations will appear here once we connect the model.
	</p>
	<p class="recommendations-page__count">
		You rated {$ratingsStore.size} book{$ratingsStore.size === 1 ? '' : 's'}.
	</p>
	<p>
		<a href="/rate">Back to rating</a>
	</p>
</div>

<style>
	.recommendations-page h1 {
		font-size: 1.5rem;
		margin: 0 0 1rem 0;
	}
	.recommendations-page__placeholder {
		color: var(--color-text-muted);
		margin: 0 0 0.5rem 0;
	}
	.recommendations-page__count {
		font-size: 0.9375rem;
		color: var(--color-text-muted);
		margin: 0 0 1.5rem 0;
	}
</style>
