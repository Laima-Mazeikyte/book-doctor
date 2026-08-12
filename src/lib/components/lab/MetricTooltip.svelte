<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Metric {
		label: string;
		value: string;
	}

	interface Props {
		id: string;
		children: Snippet;
		metrics?: Metric[];
		message?: string | null;
		block?: boolean;
		ariaLabel?: string;
	}

	let {
		id,
		children,
		metrics = [],
		message = null,
		block = false,
		ariaLabel = undefined
	}: Props = $props();

	let trigger: HTMLButtonElement;
	let open = $state(false);
	let left = $state(0);
	let top = $state(0);
	let below = $state(false);

	const EDGE_GUTTER = 16;
	const HALF_WIDTH = 144;
	const GAP = 8;

	function position(): void {
		if (!open || !trigger) return;
		const rect = trigger.getBoundingClientRect();
		left = Math.min(
			window.innerWidth - EDGE_GUTTER - HALF_WIDTH,
			Math.max(EDGE_GUTTER + HALF_WIDTH, rect.left + rect.width / 2)
		);
		below = rect.top < 112;
		top = below ? rect.bottom + GAP : rect.top - GAP;
	}

	function show(): void {
		open = true;
		position();
	}

	function hideUnlessFocused(): void {
		if (document.activeElement !== trigger) open = false;
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		open = false;
		trigger.blur();
	}

	$effect(() => {
		if (!open) return;

		function closeOnScroll(): void {
			open = false;
		}

		window.addEventListener('scroll', closeOnScroll, true);
		window.addEventListener('resize', position);
		return () => {
			window.removeEventListener('scroll', closeOnScroll, true);
			window.removeEventListener('resize', position);
		};
	});
</script>

<span class="metric-tooltip" class:metric-tooltip--block={block}>
	<button
		bind:this={trigger}
		type="button"
		class="metric-tooltip__trigger"
		aria-label={ariaLabel}
		aria-describedby={id}
		onpointerenter={show}
		onpointerleave={hideUnlessFocused}
		onfocus={show}
		onblur={() => (open = false)}
		onclick={show}
		onkeydown={handleKeydown}
	>
		{@render children()}
	</button>
	<span
		{id}
		role="tooltip"
		class="metric-tooltip__bubble"
		class:metric-tooltip__bubble--open={open}
		class:metric-tooltip__bubble--below={below}
		style:left="{left}px"
		style:top="{top}px"
	>
		{#if message}
			<span class="metric-tooltip__message">{message}</span>
		{:else}
			{#each metrics as metric (metric.label)}
				<span class="metric-tooltip__metric">
					<span>{metric.label}</span>
					<strong>{metric.value}</strong>
				</span>
			{/each}
		{/if}
	</span>
</span>

<style>
	.metric-tooltip {
		display: inline-flex;
		min-width: 0;
	}
	.metric-tooltip--block,
	.metric-tooltip--block .metric-tooltip__trigger {
		display: block;
		width: 100%;
	}
	.metric-tooltip__trigger {
		margin: 0;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: inherit;
		cursor: help;
	}
	.metric-tooltip__trigger:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 3px;
		border-radius: var(--radius-xs);
	}
	.metric-tooltip__bubble {
		position: fixed;
		z-index: 1000;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		width: max-content;
		max-width: min(18rem, calc(100vw - 2rem));
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xs);
		background: var(--color-card-bg);
		box-shadow: var(--shadow-modal-elevated);
		color: var(--color-text);
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		font-weight: var(--primitive-font-weight-normal);
		line-height: 1.4;
		white-space: normal;
		pointer-events: none;
		opacity: 0;
		visibility: hidden;
		transform: translate(-50%, -100%);
		transition:
			opacity 120ms ease,
			visibility 120ms ease;
	}
	.metric-tooltip__bubble--below {
		transform: translate(-50%, 0);
	}
	.metric-tooltip__bubble--open {
		opacity: 1;
		visibility: visible;
	}
	.metric-tooltip__metric {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--space-3);
		align-items: baseline;
	}
	.metric-tooltip__metric > span {
		color: var(--color-text-muted);
	}
	.metric-tooltip__metric strong {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.metric-tooltip__message {
		color: var(--color-text-muted);
	}
</style>
