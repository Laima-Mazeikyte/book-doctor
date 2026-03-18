<script lang="ts">
	import Hero from '$lib/components/Hero.svelte';
	import Button from '$lib/components/Button.svelte';
	import { t } from '$lib/copy';
</script>

<Hero
	title={t('home.title')}
	lead={t('home.lead')}
/>

<section class="rating-tips" aria-labelledby="rating-tips-heading">
	<h2 id="rating-tips-heading" class="rating-tips__title">{t('home.ratingTipsTitle')}</h2>
	<ul class="rating-tips__list">
		{#each t('home.ratingTips').split('\n').filter((line) => line.trim()) as tip}
			<li class="rating-tips__item">{tip.trim()}</li>
		{/each}
	</ul>
</section>

<div class="start-rating-wrap">
	<Button href="/rate">{t('home.startRating')}</Button>
</div>

<style>
	.start-rating-wrap {
		margin-top: var(--space-6);
	}
	.rating-tips {
		margin-top: var(--space-8);
		padding: var(--space-5) var(--space-5) var(--space-5) var(--space-6);
		background: var(--color-bg-muted);
		border-radius: var(--radius-md);
		border-left: 4px solid var(--color-accent);
		max-width: 42ch;
	}
	.rating-tips__title {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-semibold);
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin: 0 0 var(--space-3) 0;
	}
	.rating-tips__list {
		margin: 0;
		padding-left: var(--space-5);
		list-style: disc;
	}
	.rating-tips__item {
		font-size: var(--font-size-sm);
		line-height: var(--line-height-relaxed);
		color: var(--color-text);
		margin-bottom: var(--space-2);
	}
	.rating-tips__item:last-child {
		margin-bottom: 0;
	}
</style>
