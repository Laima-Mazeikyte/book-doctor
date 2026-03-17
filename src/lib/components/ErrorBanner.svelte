<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import { t } from '$lib/copy';

	interface Props {
		message: string;
		onDismiss?: () => void;
	}

	let { message, onDismiss }: Props = $props();
</script>

<div class="error-banner" role="alert">
	<span class="error-banner__message">{message}</span>
	{#if onDismiss}
		<Button
			variant="tertiary"
			aria-label={t('shared.errorBanner.dismiss')}
			onclick={onDismiss}
			class="error-banner__dismiss"
		>
			✕
		</Button>
	{/if}
</div>

<style>
	.error-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		margin-bottom: var(--space-4);
		background: var(--color-error-bg);
		border: 1px solid var(--color-error-border);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-sm);
		color: var(--color-error-text);
	}
	.error-banner__message {
		flex: 1;
	}
	:global(.error-banner__dismiss) {
		flex-shrink: 0;
		min-height: var(--min-tap);
		padding: var(--space-2);
		color: inherit;
		opacity: 0.8;
	}
	:global(.error-banner__dismiss:hover) {
		opacity: 1;
	}
</style>
