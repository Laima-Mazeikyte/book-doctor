<script lang="ts">
	import { t } from '$lib/copy';

	interface Props {
		position: number;
		total: number;
	}

	let { position, total }: Props = $props();
</script>

<div
	class="shortlist-position"
	role="group"
	aria-live="polite"
	aria-atomic="true"
	aria-label={t('recommendations.shortlist.positionAriaLabel', { position, total })}
>
	{#each { length: total } as _, index (index)}
		<span
			class="shortlist-position__dot"
			class:shortlist-position__dot--active={index + 1 === position}
			aria-hidden="true"
		></span>
	{/each}
</div>

<style>
	.shortlist-position {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		margin: 0;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-pill);
		background: var(--color-floating-control-bg);
		user-select: none;
		box-shadow: 0 1px 3px color-mix(in srgb, var(--color-text) 8%, transparent);
	}

	.shortlist-position__dot {
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 50%;
		background: color-mix(in srgb, var(--color-text) 24%, transparent);
		transition: background var(--duration-fast) var(--ease-default);
	}

	.shortlist-position__dot--active {
		background: var(--color-text);
		transform: scale(1.15);
	}
</style>
