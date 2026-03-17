<script lang="ts">
	import { t } from '$lib/copy';

	interface Props {
		title?: string;
		message?: string;
		ratedCount: number;
		backHref?: string;
		backLabel?: string;
	}

	let {
		title = t('shared.recommendationsEmpty.title'),
		message = t('shared.recommendationsEmpty.defaultMessage'),
		ratedCount,
		backHref = '/rate',
		backLabel = t('shared.recommendationsEmpty.backToRating'),
	}: Props = $props();
</script>

<div class="recommendations-empty">
	<h1 class="recommendations-empty__title">{title}</h1>
	<p class="recommendations-empty__message">{message}</p>
	<p class="recommendations-empty__count">
		{t('shared.recommendationsEmpty.youRatedCount', { count: ratedCount })}{ratedCount === 1 ? '' : t('shared.recommendationsEmpty.youRatedCountPlural')}.
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
