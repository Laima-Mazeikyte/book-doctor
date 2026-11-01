<script lang="ts">
	import LandingHero from '$lib/components/LandingHero.svelte';
	import Button from '$lib/components/Button.svelte';
	import MaintenanceCountdown from '$lib/components/MaintenanceCountdown.svelte';
	import LandingFeedPreparation from '$lib/feed/LandingFeedPreparation.svelte';
	import { MAINTENANCE_ON, MAINTENANCE_UNTIL } from '$lib/maintenance';
	import { t } from '$lib/copy';
</script>

<LandingFeedPreparation />

<svelte:head>
	<title>{t('home.title')} — {t('shared.header.siteName')}</title>
	<meta name="description" content={t('home.metaDescription')} />
</svelte:head>

<LandingHero
	title={t('home.title')}
	description={t(MAINTENANCE_ON ? 'maintenance.body' : 'home.lead')}
>
	{#if MAINTENANCE_ON}
		<MaintenanceCountdown until={MAINTENANCE_UNTIL} />
	{:else}
		<Button href="/rate" variant="primary" pill>{t('home.startRating')}</Button>
	{/if}
</LandingHero>
