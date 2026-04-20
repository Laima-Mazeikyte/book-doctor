<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import { t } from '$lib/copy';
	import copyByLocale from '$lib/copy/copy.yaml';

	const adjectives: string[] = (
		(copyByLocale as Record<string, Record<string, unknown>>)?.en?.home as Record<string, unknown>
	)?.adjectives as string[] ?? ['uninspired'];

	let index = $state(Math.floor(Math.random() * adjectives.length));
	let currentAdjective = $derived(adjectives[index]);

	onMount(() => {
		const interval = setInterval(() => {
			index = (index + 1) % adjectives.length;
		}, 2500);
		return () => clearInterval(interval);
	});
</script>

<!--
	Landing typography exception (spec): Beth Ellen display + Crimson headings/body in one hero.
	Tokens: typ-h1 + typ-display1--inherit-size on the adjective; no one-off font-family outside semantic.css utilities.
-->
<div class="landing landing-typography">
	<div class="landing__hero">
		<h1 class="landing__title typ-h1">
			{t('home.titlePrefix')}<br />
			<span class="landing__adjective-clip">
				{#key currentAdjective}
					<span class="landing__adjective typ-display1 typ-display1--inherit-size">{currentAdjective}</span>
				{/key}
			</span>
			<br />
			{t('home.titleSuffix')}
		</h1>
		<p class="landing__lead typ-body">{t('home.lead')}</p>

		<Button href="/rate" variant="inverse" pill>{t('home.startRating')}</Button>
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
		width: 100%;
		max-width: 44ch;
	}

	.landing__title {
		margin: 0;
		font-size: clamp(var(--primitive-type-size-36), 5vw, var(--primitive-type-size-72));
	}

	.landing__adjective-clip {
		display: inline-block;
		overflow: hidden;
		vertical-align: bottom;
		padding: 0.2em 0.1em 0.25em;
		margin: -0.2em -0.1em -0.25em;
	}

	.landing__adjective {
		display: inline-block;
		animation: slideIn 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	@keyframes slideIn {
		from {
			transform: translateY(110%);
		}
		to {
			transform: translateY(0);
		}
	}

	.landing__lead {
		color: var(--color-text-muted);
		margin: 0;
	}

	@media (min-width: 480px) {
		.landing {
			padding-top: var(--space-24);
		}

	}
</style>
