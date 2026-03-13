<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		lead?: string;
		children?: Snippet;
	}

	let { title, lead, children }: Props = $props();
</script>

<div class="hero">
	<h1 class="hero__title">{title}</h1>
	{#if lead}
		<p class="hero__lead">{lead}</p>
	{/if}
	{#if children}
		<div class="hero__actions">
			{@render children()}
		</div>
	{/if}
</div>

<style>
	.hero__title {
		font-size: var(--font-size-3xl);
		font-weight: var(--font-weight-semibold);
		letter-spacing: -0.02em;
		margin: 0 0 var(--space-3) 0;
	}
	.hero__lead {
		margin: 0 0 var(--space-6) 0;
		color: var(--color-text-muted);
		font-size: var(--font-size-base);
		line-height: var(--line-height-relaxed);
		max-width: 36ch;
	}
	.hero__actions {
		margin-top: var(--space-4);
	}
</style>
