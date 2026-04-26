<script lang="ts">
	import homeLogo from '$lib/assets/unread-logo.svg';
	import Button from '$lib/components/Button.svelte';
	import { t } from '$lib/copy';
</script>

<div class="landing landing-typography">
	<div class="landing__hero">
		<img
			class="landing__logo"
			src={homeLogo}
			alt={t('shared.header.logoAlt')}
			width="55"
			height="36"
			decoding="async"
		/>
		<h1 class="landing__title typ-h1">{t('home.title')}</h1>
		<p class="landing__lead typ-body">{t('home.lead')}</p>

		<Button href="/rate" variant="primary" pill>{t('home.startRating')}</Button>
	</div>
</div>

<style>
	.landing {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding-top: var(--space-12);
		width: 100%;
	}

	.landing__hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-5);
		width: fit-content;
		max-width: 52ch;
	}

	.landing__logo {
		display: block;
		width: auto;
		height: clamp(6.5rem, 22vw, 10.5rem);
		flex-shrink: 0;
	}

	.landing__title {
		color: var(--color-accent-brand);
		margin: 0;
		width: fit-content;
		font-size: clamp(var(--primitive-type-size-36), 5vw, var(--primitive-type-size-72));
	}

	.landing__lead {
		color: var(--color-text-muted);
		margin: 0;
		font-size: var(--primitive-type-size-16);
		line-height: 150%;
	}

	@media (min-width: 480px) {
		.landing {
			padding-top: var(--space-24);
		}

	}
</style>
