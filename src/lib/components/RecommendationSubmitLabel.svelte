<script lang="ts">
	import Spinner from './Spinner.svelte';
	import { t } from '$lib/copy';
	let { label, busy = false }: { label: string; busy?: boolean } = $props();
</script>

<!-- Both labels occupy the grid so starting a request does not resize the button. -->
<span class="submit-label">
	<span class="measure" aria-hidden="true">{label}</span>
	<span class="measure starting" aria-hidden="true">
		<Spinner size="sm" />{t('recommendations.submission.starting')}
	</span>
	<span class="visible">
		{#if busy}<Spinner size="sm" />{/if}
		{busy ? t('recommendations.submission.starting') : label}
	</span>
</span>

<style>
	.submit-label {
		display: inline-grid;
		max-width: 100%;
	}
	.submit-label > span {
		grid-area: 1 / 1;
	}
	.measure {
		visibility: hidden;
	}
	.starting,
	.visible {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
	}
</style>
