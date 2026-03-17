<script lang="ts">
	import Hero from '$lib/components/Hero.svelte';
	import Button from '$lib/components/Button.svelte';
	import { t } from '$lib/copy';
</script>

<Hero
	title={t('home.title')}
	lead={t('home.lead')}
>
	<Button href="/rate">{t('home.startRating')}</Button>
</Hero>
