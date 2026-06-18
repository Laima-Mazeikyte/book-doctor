<script lang="ts">
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Button from '$lib/components/Button.svelte';
	import { authModalRequestStore } from '$lib/stores/authModalRequest';
	import { shortlistSavePromptStore } from '$lib/stores/shortlistSavePrompt';
	import { t } from '$lib/copy';
	import { X } from 'lucide-svelte';

	interface Props {
		open: boolean;
	}

	let { open }: Props = $props();

	const titleId = 'save-account-prompt-title';

	function dismiss() {
		shortlistSavePromptStore.dismiss();
	}

	function handleCreateAccount() {
		shortlistSavePromptStore.dismiss();
		authModalRequestStore.open('signup');
	}
</script>

{#if open}
	<div
		class="save-account-prompt"
		role="dialog"
		aria-labelledby={titleId}
		aria-modal="false"
		transition:fly={{ y: 16, duration: 220, easing: cubicOut }}
	>
		<button
			type="button"
			class="save-account-prompt__dismiss"
			aria-label={t('recommendations.saveAccountPrompt.dismiss')}
			onclick={dismiss}
		>
			<X size={18} aria-hidden="true" />
		</button>

		<div class="save-account-prompt__body">
			<h2 id={titleId} class="save-account-prompt__title typ-h3">
				{t('recommendations.saveAccountPrompt.title')}
			</h2>
			<p class="save-account-prompt__message typ-body">
				{t('recommendations.saveAccountPrompt.message')}
			</p>
			<div class="save-account-prompt__actions">
				<Button variant="primary" compact pill onclick={handleCreateAccount}>
					{t('shared.authModal.createAccount')}
				</Button>
			</div>
		</div>
	</div>
{/if}

<style>
	.save-account-prompt {
		position: fixed;
		left: 50%;
		bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
		z-index: 150;
		width: min(calc(100vw - 2 * var(--space-4)), 28rem);
		padding: var(--space-4);
		transform: translateX(-50%);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
	}
	.save-account-prompt__dismiss {
		position: absolute;
		top: var(--space-2);
		right: var(--space-2);
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--min-tap);
		height: var(--min-tap);
		padding: 0;
		border: none;
		border-radius: var(--radius-pill);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition:
			background var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
	}
	.save-account-prompt__dismiss:hover {
		background: var(--color-floating-control-bg);
		color: var(--color-text);
	}
	.save-account-prompt__dismiss:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.save-account-prompt__body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-right: calc(var(--min-tap) - var(--space-2));
	}
	.save-account-prompt__title {
		margin: 0;
		padding-right: var(--space-2);
		color: var(--color-text);
	}
	.save-account-prompt__message {
		margin: 0;
		color: var(--color-text-muted);
	}
	.save-account-prompt__actions {
		display: flex;
		margin-top: var(--space-1);
	}
</style>
