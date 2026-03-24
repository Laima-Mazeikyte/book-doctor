<script lang="ts">
	import { t } from '$lib/copy';

	interface Props {
		title?: string;
		message?: string;
		ratedCount: number;
	}

	let {
		title = t('shared.recommendationsEmpty.title'),
		message = t('shared.recommendationsEmpty.defaultMessage'),
		ratedCount,
	}: Props = $props();
</script>

<div class="recommendations-empty">
	<h1 class="recommendations-empty__title typ-display2">{title}</h1>
	<p class="recommendations-empty__message typ-body">{message}</p>
	<p class="recommendations-empty__count typ-caption">
		{t('shared.recommendationsEmpty.youRatedCount', { count: ratedCount })}{ratedCount === 1 ? '' : t('shared.recommendationsEmpty.youRatedCountPlural')}.
	</p>
</div>

<style>
	.recommendations-empty {
		text-align: center;
	}
	.recommendations-empty__title {
		margin: 0 0 var(--space-4) 0;
	}
	.recommendations-empty__message {
		color: var(--color-text-muted);
		margin: 0 0 var(--space-2) 0;
	}
	.recommendations-empty__count {
		color: var(--color-text-muted);
		margin: 0 0 var(--space-6) 0;
	}
</style>
