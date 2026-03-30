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

		<div class="landing__tips">
			<p class="landing__tips-label typ-caption">{t('home.ratingTipsTitle')}</p>
			<ul class="landing__tips-list">
				{#each t('home.ratingTips').split('\n').filter((line) => line.trim()) as tip}
					<li class="landing__tips-item typ-caption">{tip.trim()}</li>
				{/each}
			</ul>
		</div>

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

	.landing__tips {
		width: 100%;
		border: none;
		border-radius: var(--radius-md);
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.landing__tips-label {
		text-transform: uppercase;
		color: var(--color-text-muted);
		opacity: 0.55;
		margin: 0;
		text-align: center;
	}

	.landing__tips-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-2);
	}

	.landing__tips-item {
		color: var(--color-text-muted);
		background: var(--color-bg-muted);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		text-align: left;
	}

	@media (min-width: 560px) {
		.landing__tips-list {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	@media (min-width: 480px) {
		.landing {
			padding-top: var(--space-24);
		}

	}
</style>
