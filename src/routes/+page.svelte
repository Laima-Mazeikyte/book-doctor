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

<div class="landing">
	<div class="landing__hero">
		<h1 class="landing__title">
			{t('home.titlePrefix')}<br />
			<span class="landing__adjective-clip">
				{#key currentAdjective}
					<span class="landing__adjective">{currentAdjective}</span>
				{/key}
			</span>
			{t('home.titleSuffix')}
		</h1>
		<p class="landing__lead">{t('home.lead')}</p>

		<div class="landing__tips">
			<p class="landing__tips-label">{t('home.ratingTipsTitle')}</p>
			<ul class="landing__tips-list">
				{#each t('home.ratingTips').split('\n').filter((line) => line.trim()) as tip}
					<li class="landing__tips-item">{tip.trim()}</li>
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
		font-size: var(--font-size-3xl);
		font-weight: var(--font-weight-semibold);
		letter-spacing: -0.02em;
		line-height: var(--line-height-tight);
		margin: 0;
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
		font-family: 'Beth Ellen', cursive;
		font-weight: normal;
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
		font-size: var(--font-size-base);
		color: var(--color-text-muted);
		line-height: var(--line-height-relaxed);
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
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		text-transform: uppercase;
		letter-spacing: 0.08em;
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
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		line-height: var(--line-height-relaxed);
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

		.landing__title {
			font-size: clamp(var(--font-size-3xl), 5vw, 2.5rem);
		}
	}
</style>
