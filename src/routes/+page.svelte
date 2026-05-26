<script lang="ts">
	import homeLogo from '$lib/assets/unread-logo.svg';
	import homeLogoVideo from '$lib/assets/Unread-animated.mp4';
	import Button from '$lib/components/Button.svelte';
	import { t } from '$lib/copy';
</script>

<svelte:head>
	<title>{t('home.title')} — {t('shared.header.siteName')}</title>
	<meta name="description" content={t('home.metaDescription')} />
</svelte:head>

<div class="landing landing-typography">
	<div class="landing__hero">
		<div class="landing__logo-clip landing__logo-clip--video">
			<video
				class="landing__logo landing__logo--video"
				src={homeLogoVideo}
				autoplay
				loop
				muted
				playsinline
				aria-hidden="true"
			></video>
		</div>
		<img
			class="landing__logo landing__logo--static"
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
		flex: 1;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
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

	.landing__logo-clip {
		height: clamp(6.5rem, 22vw, 10.5rem);
		flex-shrink: 0;
		overflow: hidden;
	}

	.landing__logo {
		display: block;
		width: auto;
		mix-blend-mode: screen;
	}

	.landing__logo--video {
		height: calc(100% + 110px);
		margin-top: -55px;
	}

	.landing__logo--static {
		height: clamp(6.5rem, 22vw, 10.5rem);
		flex-shrink: 0;
		display: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.landing__logo-clip--video {
			display: none;
		}

		.landing__logo--static {
			display: block;
		}
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

</style>
