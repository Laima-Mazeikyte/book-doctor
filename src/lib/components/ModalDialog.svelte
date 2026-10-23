<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade } from 'svelte/transition';

	let {
		open,
		onClose,
		labelledby,
		closeDisabled = false,
		initialFocus,
		restoreFocusTarget = null,
		children
	}: {
		open: boolean;
		onClose: () => void;
		labelledby: string;
		closeDisabled?: boolean;
		initialFocus?: string;
		restoreFocusTarget?: HTMLElement | null;
		children: Snippet;
	} = $props();

	function focusable(node: HTMLDialogElement): HTMLElement[] {
		return Array.from(
			node.querySelectorAll<HTMLElement>(
				'button, input, select, textarea, a[href], [tabindex], [contenteditable="true"]'
			)
		).filter(
			(element) =>
				element.tabIndex >= 0 &&
				!element.matches(':disabled') &&
				!element.closest('[hidden], [inert], [aria-hidden="true"]') &&
				element.getClientRects().length > 0 &&
				getComputedStyle(element).visibility !== 'hidden'
		);
	}

	function showModal(node: HTMLDialogElement) {
		const opener =
			restoreFocusTarget ??
			(document.activeElement instanceof HTMLElement ? document.activeElement : null);
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		node.showModal();
		if (initialFocus) node.querySelector<HTMLElement>(initialFocus)?.focus();

		// Import stages can remove or disable the focused control, including every button.
		const observer = new MutationObserver(() => {
			if (!node.open) return;
			const active = document.activeElement;
			if (
				active === node ||
				!node.contains(active) ||
				(active instanceof HTMLElement && active.matches(':disabled'))
			) {
				(focusable(node)[0] ?? node).focus({ preventScroll: true });
			}
		});
		observer.observe(node, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ['disabled', 'hidden', 'tabindex']
		});
		return {
			destroy() {
				observer.disconnect();
				node.close();
				document.body.style.overflow = previousOverflow;
				if (opener?.isConnected) opener.focus({ preventScroll: true });
			}
		};
	}

	function requestClose() {
		if (open && !closeDisabled) onClose();
	}

	function handleKeydown(event: KeyboardEvent) {
		// Keep application-wide shortcuts from acting on the page behind this modal.
		event.stopPropagation();
		if (event.key !== 'Tab') return;
		const node = event.currentTarget as HTMLDialogElement;
		const elements = focusable(node);
		const index = elements.indexOf(document.activeElement as HTMLElement);
		if (index < 0 || (event.shiftKey ? index === 0 : index === elements.length - 1)) {
			event.preventDefault();
			(event.shiftKey ? (elements.at(-1) ?? node) : (elements[0] ?? node)).focus();
		}
	}
</script>

{#if open}
	<dialog
		use:showModal
		class="modal-dialog"
		aria-labelledby={labelledby}
		oncancel={(event) => {
			event.preventDefault();
			requestClose();
		}}
		onclick={(event) => {
			if (event.target === event.currentTarget) requestClose();
		}}
		onkeydown={handleKeydown}
		transition:fade={{ duration: 150 }}
	>
		{@render children()}
	</dialog>
{/if}

<style>
	.modal-dialog {
		position: fixed;
		inset: 0;
		margin: 0;
		border: 0;
		width: 100%;
		height: 100%;
		max-width: none;
		max-height: none;
		padding: var(--space-4);
		color: inherit;
		background: var(--color-overlay-scrim);
		align-items: center;
		justify-content: center;
	}
	.modal-dialog[open] {
		display: flex;
	}
	.modal-dialog::backdrop {
		background: transparent;
	}
</style>
