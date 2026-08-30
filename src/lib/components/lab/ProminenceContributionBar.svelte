<script lang="ts">
	import { createFloatingPopover } from '$lib/components/lab/floating-popover';
	import { t } from '$lib/copy';
	import { formatContribution } from '$lib/lab/author-prominence/score';
	import {
		calculateContributionComposition,
		type ContributionComposition
	} from '$lib/lab/author-prominence/contribution-bar';
	import type { ContributionSegment } from '$lib/lab/author-prominence/presentation';

	interface Props {
		segments: ContributionSegment[];
		score: string;
		scoreAriaLabel: string;
	}

	let { segments, score, scoreAriaLabel }: Props = $props();
	let button: HTMLButtonElement | null = $state(null);
	let popover: HTMLDivElement | null = $state(null);
	let popoverOpen = $state(false);
	let pointerType = '';
	let position = $state({ left: 8, top: 8, width: 260 });
	const composition = $derived.by(
		(): ContributionComposition => calculateContributionComposition(segments)
	);
	const allValuesLabel = $derived(
		segments.map((segment) => `${segment.label} ${formatContribution(segment.value)}`).join(', ')
	);
	const triggerLabel = $derived(
		`${scoreAriaLabel}. ${allValuesLabel}. ${t('lab.authorProminence.detail.scoreComposition')}`
	);

	function positionPopover(): void {
		if (!button || !popover) return;
		const viewportWidth = Math.max(1, window.innerWidth);
		const viewportHeight = Math.max(1, window.innerHeight);
		const width = Math.min(300, Math.max(1, viewportWidth - 16));
		const triggerRect = button.getBoundingClientRect();
		const height = popover.getBoundingClientRect().height;
		const left = Math.max(8, Math.min(triggerRect.left, viewportWidth - width - 8));
		const below = triggerRect.bottom + 8;
		const above = triggerRect.top - height - 8;
		const top = below + height <= viewportHeight - 8 || above < 8 ? below : above;
		position = {
			left,
			top: Math.max(8, Math.min(top, viewportHeight - height - 8)),
			width
		};
	}

	function openPopover(): void {
		popoverOpen = true;
	}

	function closePopover(): void {
		popoverOpen = false;
	}

	function togglePopover(): void {
		if (popoverOpen) closePopover();
		else openPopover();
	}

	function handlePointerDown(event: PointerEvent): void {
		pointerType = event.pointerType;
	}

	function handlePointerEnter(event: PointerEvent): void {
		pointerType = event.pointerType;
		if (event.pointerType !== 'touch') openPopover();
	}

	function handlePointerLeave(): void {
		if (document.activeElement !== button) closePopover();
	}

	function handleBlur(event: FocusEvent): void {
		if (event.relatedTarget instanceof Node && popover?.contains(event.relatedTarget)) return;
		closePopover();
	}

	function handleClick(event: MouseEvent): void {
		if (pointerType === 'touch' || event.detail === 0) {
			event.preventDefault();
			togglePopover();
		}
		pointerType = '';
	}

	function handleFocus(): void {
		if (pointerType !== 'touch') openPopover();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		closePopover();
	}

	$effect(() => {
		if (!popoverOpen) return;
		const floating = createFloatingPopover({
			isVisible: () => popoverOpen,
			getTrigger: () => button,
			getPopover: () => popover,
			position: positionPopover,
			onOutsidePointerDown: closePopover
		});
		return floating.destroy;
	});
</script>

<div class="prominence-contribution">
	<button
		bind:this={button}
		type="button"
		class="prominence-contribution__button"
		data-testid="prominence-contribution-bar"
		aria-label={triggerLabel}
		aria-expanded={popoverOpen}
		aria-haspopup="dialog"
		onpointerdown={handlePointerDown}
		onpointerenter={handlePointerEnter}
		onpointerleave={handlePointerLeave}
		onfocus={handleFocus}
		onblur={handleBlur}
		onclick={handleClick}
		onkeydown={handleKeydown}
	>
		<strong class="prominence-contribution__score">{score}</strong>
	</button>
	{#if popoverOpen}
		<div
			bind:this={popover}
			class="prominence-contribution__popover prominence-contribution__popover--all"
			style:left={`${position.left}px`}
			style:top={`${position.top}px`}
			style:width={`${position.width}px`}
			role="dialog"
			aria-label={t('lab.authorProminence.detail.scoreComposition')}
		>
			<strong class="prominence-contribution__popover-heading"
				>{t('lab.authorProminence.detail.scoreComposition')}</strong
			>
			<span class="prominence-contribution__track" aria-hidden="true">
				{#if !composition.allZero}
					{#each composition.segments as segment (segment.feature)}
						<span
							class="prominence-contribution__segment"
							class:prominence-contribution__segment--negative={segment.sign === 'negative'}
							class:prominence-contribution__segment--zero={segment.sign === 'zero'}
							style:flex-basis={`${segment.width}%`}
							style:--segment-colour={segment.colour}
						></span>
					{/each}
				{/if}
				{#if composition.hasNegative && composition.hasPositive && composition.zeroBoundary !== null}
					<span class="prominence-contribution__zero" style:left={`${composition.zeroBoundary}%`}
					></span>
				{/if}
			</span>
			<div class="prominence-contribution__values">
				{#each segments as segment (segment.feature)}
					<span class="prominence-contribution__value">
						<span
							class="prominence-contribution__dot"
							style:background={segment.colour}
							aria-hidden="true"
						></span>
						<span>{segment.label}</span>
						<strong>{formatContribution(segment.value)}</strong>
					</span>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.prominence-contribution {
		position: relative;
		width: auto;
	}
	.prominence-contribution__button {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		gap: 7px;
		min-width: 72px;
		min-height: 44px;
		padding: 0 0 0 6px;
		border: 0;
		background: transparent;
		color: #bce8d8;
		cursor: pointer;
		font: inherit;
	}
	.prominence-contribution__button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 3px;
		border-radius: 4px;
	}
	.prominence-contribution__score {
		color: #bce8d8;
		font: 650 20px var(--font-family-interactive);
		font-variant-numeric: tabular-nums;
	}
	.prominence-contribution__track {
		position: relative;
		display: flex;
		width: 100%;
		height: 11px;
		overflow: hidden;
		border-radius: 3px;
		background: rgba(207, 231, 232, 0.13);
	}
	.prominence-contribution__segment {
		display: block;
		min-width: 0;
		flex: 0 0 auto;
		background: var(--segment-colour);
	}
	.prominence-contribution__segment--negative {
		background-color: var(--segment-colour);
		background-image: repeating-linear-gradient(
			-45deg,
			rgba(8, 16, 16, 0.52) 0,
			rgba(8, 16, 16, 0.52) 2px,
			transparent 2px,
			transparent 5px
		);
	}
	.prominence-contribution__segment--zero {
		flex-basis: 0 !important;
	}
	.prominence-contribution__zero {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: rgba(239, 255, 255, 0.78);
		transform: translateX(-0.5px);
	}
	.prominence-contribution__popover {
		position: fixed;
		z-index: 100;
		box-sizing: border-box;
		padding: 8px 10px;
		border: 1px solid rgba(164, 204, 206, 0.3);
		border-radius: 6px;
		background: #182323;
		color: #efffff;
		font: 12px/1.35 var(--font-family-interactive);
		font-variant-numeric: tabular-nums;
		pointer-events: none;
	}
	.prominence-contribution__popover--all {
		display: grid;
		gap: 4px;
	}
	.prominence-contribution__popover-heading {
		color: rgba(207, 231, 232, 0.72);
		font: 600 10px/1.2 var(--font-family-interactive);
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.prominence-contribution__values {
		display: grid;
		gap: 5px;
		margin-top: 2px;
	}
	.prominence-contribution__value {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 6px;
		color: rgba(207, 231, 232, 0.72);
		font: 11px/1.25 var(--font-family-interactive);
	}
	.prominence-contribution__value strong {
		color: #efffff;
		font: 650 11px var(--font-family-interactive);
		font-variant-numeric: tabular-nums;
	}
	.prominence-contribution__dot {
		display: block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}
	@media (prefers-reduced-motion: reduce) {
		.prominence-contribution__button {
			transition: none;
		}
	}
</style>
