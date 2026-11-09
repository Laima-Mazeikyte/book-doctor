<script lang="ts">
	import type { Snippet } from 'svelte';
	import homeLogo from '$lib/assets/unread-logo.svg';
	import homeLogoVideo from '$lib/assets/Unread-animated.mp4';
	import { t } from '$lib/copy';

	let {
		title,
		titleContent,
		wide = false,
		eyebrow,
		description,
		descriptionContent,
		children
	}: {
		title: string;
		titleContent?: Snippet;
		wide?: boolean;
		eyebrow?: string;
		description?: string;
		descriptionContent?: Snippet;
		children?: Snippet;
	} = $props();
</script>

<div class="landing landing-typography">
	<div class="landing__hero" class:landing__hero--wide={wide}>
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
		{#if eyebrow}<p class="landing__eyebrow typ-caption">{eyebrow}</p>{/if}
		<h1 class="landing__title typ-h1">
			{#if titleContent}{@render titleContent()}{:else}{title}{/if}
		</h1>
		{#if descriptionContent || description}
			<p class="landing__lead typ-body">
				{#if descriptionContent}{@render descriptionContent()}{:else}{description}{/if}
			</p>
		{/if}
		{#if children}{@render children()}{/if}
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
		max-width: min(100%, 52ch);
	}

	.landing__hero--wide {
		max-width: 100%;
	}

	.landing__logo-clip {
		height: clamp(6.5rem, 22vw, 10.5rem);
		flex-shrink: 0;
		overflow: hidden;
		/* Keep screen blending against the page color during ancestor opacity fades. */
		background: var(--color-bg);
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

	.landing__eyebrow {
		color: var(--color-text-muted);
		margin: 0;
	}

	.landing__title {
		color: var(--color-accent-brand);
		margin: 0;
		width: fit-content;
		font-size: clamp(var(--primitive-type-size-36), 5vw, var(--primitive-type-size-72));
		overflow-wrap: anywhere;
	}

	.landing__lead {
		color: var(--color-text-muted);
		margin: 0;
		font-size: var(--primitive-type-size-16);
		line-height: 150%;
		text-wrap: pretty;
	}
</style>
