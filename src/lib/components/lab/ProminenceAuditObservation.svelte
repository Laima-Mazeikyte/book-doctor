<script lang="ts">
	import { createFloatingPopover } from '$lib/components/lab/floating-popover';
	import type { Badge } from '$lib/lab/author-prominence/types';

	interface Props {
		badges: Badge[];
		compact?: boolean;
		id?: string;
	}

	let { badges, compact = false, id = 'default' }: Props = $props();
	let trigger: HTMLButtonElement | null = $state(null);
	let popover: HTMLDivElement | null = $state(null);
	let popoverState = $state<'closed' | 'hover' | 'focus' | 'pinned'>('closed');
	let position = $state({ left: 8, top: 8, width: 320 });
	const VIEWPORT_MARGIN = 8;
	const MAX_WIDTH = 360;
	const popoverId = $derived(`prominence-audit-popover-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`);
	const visible = $derived(popoverState !== 'closed');

	function positionPopover(): void {
		if (!trigger || !popover) return;
		const viewportWidth = Math.max(1, window.innerWidth);
		const viewportHeight = Math.max(1, window.innerHeight);
		const width = Math.min(MAX_WIDTH, Math.max(1, viewportWidth - VIEWPORT_MARGIN * 2));
		const triggerRect = trigger.getBoundingClientRect();
		const height = popover.getBoundingClientRect().height;
		const left = Math.max(
			VIEWPORT_MARGIN,
			Math.min(triggerRect.left, viewportWidth - width - VIEWPORT_MARGIN)
		);
		const below = triggerRect.bottom + VIEWPORT_MARGIN;
		const above = triggerRect.top - height - VIEWPORT_MARGIN;
		let top = below;
		if (top + height > viewportHeight - VIEWPORT_MARGIN && above >= VIEWPORT_MARGIN) top = above;
		position = {
			left,
			top: Math.max(VIEWPORT_MARGIN, Math.min(top, viewportHeight - height - VIEWPORT_MARGIN)),
			width
		};
	}

	function open(next: 'hover' | 'focus' | 'pinned'): void {
		if (popoverState === 'pinned' && next !== 'pinned') return;
		popoverState = next;
	}

	function close(): void {
		if (popoverState !== 'pinned') popoverState = 'closed';
	}

	function toggle(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		popoverState = popoverState === 'pinned' ? 'closed' : 'pinned';
	}

	function handleBlur(event: FocusEvent): void {
		if (popoverState === 'pinned') return;
		if (event.relatedTarget instanceof Node && popover?.contains(event.relatedTarget)) return;
		close();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		popoverState = 'closed';
	}

	$effect(() => {
		if (badges.length === 0 && popoverState !== 'closed') popoverState = 'closed';
	});

	$effect(() => {
		if (!visible) return;
		const floating = createFloatingPopover({
			isVisible: () => visible,
			getTrigger: () => trigger,
			getPopover: () => popover,
			position: positionPopover,
			onOutsidePointerDown: () => (popoverState = 'closed')
		});
		return floating.destroy;
	});
</script>

{#if badges.length > 0}
	<span class:prominence-audit--compact={compact} class="prominence-audit">
		<button
			bind:this={trigger}
			type="button"
			class="prominence-audit__trigger"
			data-testid="prominence-audit-trigger"
			aria-label={`Audit observations: ${badges.map((badge) => badge.badge).join(', ')}`}
			aria-expanded={visible}
			aria-controls={popoverId}
			aria-describedby={popoverId}
			onpointerenter={() => open('hover')}
			onpointerleave={close}
			onfocus={() => open('focus')}
			onblur={handleBlur}
			onclick={toggle}
			onkeydown={handleKeydown}><span aria-hidden="true">!</span></button
		>
		<div
			bind:this={popover}
			id={popoverId}
			class="prominence-audit__popover"
			class:prominence-audit__popover--visible={visible}
			style:left={`${position.left}px`}
			style:top={`${position.top}px`}
			style:width={`${position.width}px`}
			role="tooltip"
			aria-hidden={!visible}
		>
			{#each badges as badge (badge.badge)}
				<div class="prominence-audit__item">
					<strong>{badge.badge}</strong>
					<span>{badge.explain}</span>
				</div>
			{/each}
		</div>
	</span>
{/if}

<style>
	.prominence-audit {
		display: inline-flex;
		flex: 0 0 auto;
		vertical-align: middle;
	}
	.prominence-audit__trigger {
		display: inline-grid;
		width: 18px;
		height: 18px;
		place-items: center;
		padding: 0;
		border: 1px solid rgba(243, 201, 100, 0.62);
		border-radius: 50%;
		background: rgba(91, 66, 19, 0.18);
		color: #f3c964;
		font: 700 11px/1 var(--font-family-interactive);
		cursor: pointer;
	}
	.prominence-audit__trigger:hover,
	.prominence-audit__trigger[aria-expanded='true'] {
		border-color: #f3c964;
		background: rgba(243, 201, 100, 0.14);
	}
	.prominence-audit__trigger:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.prominence-audit__popover {
		position: fixed;
		z-index: 100;
		box-sizing: border-box;
		padding: 10px 12px;
		border: 1px solid rgba(243, 201, 100, 0.32);
		border-radius: 7px;
		background: #182323;
		color: rgba(243, 201, 100, 0.82);
		font: 12px/1.45 var(--font-family-interactive);
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transform: translateY(3px);
		transition:
			opacity 140ms ease,
			transform 140ms ease,
			visibility 140ms ease;
	}
	.prominence-audit__popover--visible {
		opacity: 1;
		visibility: visible;
		pointer-events: auto;
		transform: none;
	}
	.prominence-audit__item + .prominence-audit__item {
		margin-top: 9px;
		padding-top: 9px;
		border-top: 1px solid rgba(243, 201, 100, 0.18);
	}
	.prominence-audit__item strong,
	.prominence-audit__item span {
		display: block;
	}
	.prominence-audit__item strong {
		color: #f3c964;
		font-weight: 650;
	}
	@media (prefers-reduced-motion: reduce) {
		.prominence-audit__popover {
			transition: none;
		}
	}
</style>
