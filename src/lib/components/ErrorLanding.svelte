<script lang="ts">
	import LandingHero from './LandingHero.svelte';
	import Button from './Button.svelte';
	import { t } from '$lib/copy';

	let { status, quote }: { status: number; quote: string } = $props();
	const notFound = $derived(status === 404);
</script>

<svelte:head>
	<title>{status} — {t('shared.header.siteName')}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#snippet quoteTitle()}
	{#each quote.split('*') as part, index (index)}
		{#if index % 2}<em>{part}</em>{:else}{part}{/if}
	{/each}
{/snippet}

<LandingHero
	title={notFound ? quote : t('errors.unavailableTitle')}
	titleContent={notFound ? quoteTitle : undefined}
	wide={notFound}
	eyebrow={notFound ? t('errors.notFoundLabel') : t('errors.status', { status })}
	description={notFound ? undefined : t('errors.unavailableDescription')}
>
	<Button href="/" variant="primary" pill>{t('errors.backHome')}</Button>
</LandingHero>
