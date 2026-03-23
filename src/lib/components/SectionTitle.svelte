<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();
</script>

<h2 class="section-title typ-h3">
	{#if children}
		{@render children()}
	{/if}
</h2>

<style>
	.section-title {
		margin: 0 0 var(--space-3) 0;
		color: var(--color-text-muted);
	}
</style>
