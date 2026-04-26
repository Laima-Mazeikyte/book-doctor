<script lang="ts">
	import Accordion from '$lib/components/Accordion.svelte';
	import { t } from '$lib/copy';
</script>

<svelte:head>
	<title>{t('faq.title')} — {t('shared.header.siteName')}</title>
</svelte:head>

<div class="faq-page">
	<h1 id="faq-page-heading" class="faq-page__title typ-display2 typ-display2--content">
		{t('faq.title')}
	</h1>
	<div
		class="faq-page__content"
		role="region"
		aria-labelledby="faq-page-heading"
	>
		<Accordion />
	</div>
</div>

<style>
	.faq-page {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		justify-content: flex-start;
		width: 100%;
		max-width: 600px;
		margin-inline: auto;
		padding-bottom: var(--space-8);
		box-sizing: border-box;
	}
	.faq-page__title {
		margin: 0 0 var(--space-6) 0;
		text-align: center;
	}
	.faq-page__content {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
	}
</style>
