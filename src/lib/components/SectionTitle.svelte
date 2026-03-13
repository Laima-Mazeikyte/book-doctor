<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();
</script>

<h2 class="section-title">
	{#if children}
		{@render children()}
	{/if}
</h2>

<style>
	.section-title {
		font-size: var(--font-size-lg);
		font-weight: var(--font-weight-semibold);
		margin: 0 0 var(--space-3) 0;
		color: var(--color-text-muted);
	}
</style>
