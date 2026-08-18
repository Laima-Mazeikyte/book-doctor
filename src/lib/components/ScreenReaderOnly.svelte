<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
		id?: string;
		'aria-live'?: 'polite' | 'assertive' | 'off';
		'aria-atomic'?: boolean | 'true' | 'false';
	}

	let { children, ...rest }: Props = $props();
</script>

<span class="screen-reader-only" {...rest}>{@render children?.()}</span>

<style>
	.screen-reader-only {
		position: absolute !important;
		width: 1px !important;
		height: 1px !important;
		padding: 0 !important;
		margin: -1px !important;
		overflow: hidden !important;
		clip: rect(0, 0, 0, 0) !important;
		white-space: nowrap !important;
		border: 0 !important;
	}
</style>
