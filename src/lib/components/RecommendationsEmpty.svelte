<script lang="ts">
	interface Props {
		title?: string;
		message?: string;
		ratedCount: number;
		backHref?: string;
		backLabel?: string;
	}

	let {
		title = 'Recommendations',
		message = 'Recommendations will appear here once we connect the model.',
		ratedCount,
		backHref = '/rate',
		backLabel = 'Back to rating',
	}: Props = $props();
</script>

<div class="recommendations-empty">
	<h1 class="recommendations-empty__title">{title}</h1>
	<p class="recommendations-empty__message">{message}</p>
	<p class="recommendations-empty__count">
		You rated {ratedCount} book{ratedCount === 1 ? '' : 's'}.
	</p>
	<p>
		<a href={backHref} class="recommendations-empty__back">{backLabel}</a>
	</p>
</div>

<style>
	.recommendations-empty__title {
		font-size: var(--font-size-2xl);
		margin: 0 0 var(--space-4) 0;
	}
	.recommendations-empty__message {
		color: var(--color-text-muted);
		margin: 0 0 var(--space-2) 0;
	}
	.recommendations-empty__count {
		font-size: var(--font-size-md);
		color: var(--color-text-muted);
		margin: 0 0 var(--space-6) 0;
	}
	.recommendations-empty__back {
		/* Uses global link styles */
	}
</style>
