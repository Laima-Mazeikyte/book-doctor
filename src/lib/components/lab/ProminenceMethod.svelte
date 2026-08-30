<script lang="ts">
	import { createFloatingPopover } from '$lib/components/lab/floating-popover';
	import type { ProminenceManifest } from '$lib/lab/author-prominence/types';

	interface Props {
		manifest: ProminenceManifest;
		open: boolean;
		onToggle: (open: boolean) => void;
	}

	let { manifest, open, onToggle }: Props = $props();
	let methodSummary: HTMLElement | null = $state(null);
	let methodBody: HTMLDivElement | null = $state(null);

	function handleKeydown(event: KeyboardEvent): void {
		if (open && event.key === 'Escape') {
			event.preventDefault();
			onToggle(false);
		}
	}

	$effect(() => {
		if (!open) return;
		const floating = createFloatingPopover({
			isVisible: () => open,
			getTrigger: () => methodSummary,
			getPopover: () => methodBody,
			onOutsidePointerDown: () => onToggle(false),
			onKeydown: handleKeydown
		});
		return floating.destroy;
	});
</script>

<div class="prominence-method">
	<details
		class="method-details"
		{open}
		ontoggle={(event) => onToggle((event.currentTarget as HTMLDetailsElement).open)}
	>
		<summary bind:this={methodSummary}><span>Method and limitations</span></summary>
		<div bind:this={methodBody} class="method-details__body">
			<ul>
				{#each manifest.disclosure.items as item (item)}<li>{item}</li>{/each}
			</ul>
		</div>
	</details>
</div>

<style>
	.prominence-method {
		position: relative;
		z-index: 20;
		display: flex;
		justify-content: flex-end;
		flex: 0 0 auto;
		margin: 0;
	}
	.method-details {
		position: relative;
		width: max-content;
		max-width: 100%;
		height: max-content;
	}
	.method-details summary {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		min-height: 44px;
		padding: 8px 0;
		color: #d8eeee;
		white-space: nowrap;
		cursor: pointer;
		font: 600 13px var(--font-family-interactive);
	}
	.method-details summary:focus-visible {
		outline: 2px solid #86d8bd;
		outline-offset: -2px;
	}
	.method-details__body {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		width: min(520px, calc(100vw - 32px));
		max-height: min(560px, calc(100vh - 160px));
		overflow: auto;
		pointer-events: auto;
		box-sizing: border-box;
		padding: 15px;
		border: 1px solid rgba(164, 204, 206, 0.2);
		border-radius: 8px;
		background: #102020;
		box-shadow: 0 15px 35px rgba(0, 0, 0, 0.3);
		color: rgba(207, 231, 232, 0.68);
		font: 13px/1.55 var(--font-family-interactive);
	}
	.method-details__body ul {
		margin: 0 0 13px;
		padding-left: 20px;
	}
	@media (max-width: 900px) {
		.method-details__body {
			width: min(520px, calc(100vw - 24px));
		}
	}
</style>
