<script lang="ts">
	import { t } from '$lib/copy';
</script>

<svelte:head>
	<title>{t('faq.title')} — {t('shared.header.siteName')}</title>
</svelte:head>

<div class="faq-page">
	<h1 class="typ-display2">{t('faq.title')}</h1>
	<p class="faq-page__lead typ-body">{t('faq.comingSoon')}</p>
</div>

<style>
	.faq-page {
		max-width: 36rem;
	}
	.faq-page__lead {
		margin-top: var(--space-4);
		color: var(--color-text-muted);
	}
</style>
