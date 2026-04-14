<script lang="ts">
	import { tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import Button from '$lib/components/Button.svelte';
	import { isAnonymousOrSignedOut, signedInEmail } from '$lib/stores/auth';
	import { getDeviceInfo } from '$lib/bugs/deviceInfo';
	import { submitBug } from '$lib/bugs/api';
	import { t } from '$lib/copy';

	interface Props {
		open: boolean;
		onClose: () => void;
	}

	let { open, onClose }: Props = $props();

	let description = $state('');
	let name = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let successMessage = $state(false);
	let closeButtonEl = $state<HTMLButtonElement | null>(null);
	let firstInputEl = $state<HTMLInputElement | null>(null);

	const titleId = 'bug-modal-title';
	const author = $derived(
		(name.trim() || $signedInEmail) ?? null
	);
	const nameRequired = $derived($isAnonymousOrSignedOut);

	function portal(node: HTMLElement, target: HTMLElement = document.body) {
		target.appendChild(node);
		return {
			destroy() {
				node.parentNode?.removeChild(node);
			}
		};
	}

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	$effect(() => {
		if (open) {
			description = '';
			name = '';
			error = null;
			successMessage = false;
		}
	});

	$effect(() => {
		if (!open) return;
		tick().then(() => {
			closeButtonEl?.focus();
			firstInputEl?.focus();
		});
	});

	$effect(() => {
		if (open) {
			const prev = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = prev;
			};
		}
	});

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		const desc = description.trim();
		if (!desc) return;
		if (nameRequired && !name.trim()) return;

		loading = true;
		const id = crypto.randomUUID();
		const { viewport_width, device_info } = getDeviceInfo();

		const { error: err } = await submitBug({
			id,
			description: desc,
			author,
			viewport_width,
			device_info
		});

		loading = false;
		if (err) {
			error = t('shared.bugModal.errorSubmit');
			return;
		}

		successMessage = true;
		setTimeout(() => {
			onClose();
		}, 1800);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		use:portal
		class="bug-modal-overlay"
		role="dialog"
		aria-modal="true"
		aria-labelledby={titleId}
		tabindex="-1"
		onclick={handleOverlayClick}
		onkeydown={handleKeydown}
		transition:fade={{ duration: 150 }}
	>
		<div
			class="bug-modal-panel"
			role="presentation"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<div class="bug-modal__header">
				<h2 id={titleId} class="bug-modal__title typ-h3">
					{t('shared.bugModal.title')}
				</h2>
				<Button
					variant="secondary"
					compact
					type="button"
					aria-label={t('shared.bugModal.close')}
					ref={(el) => (closeButtonEl = el as HTMLButtonElement)}
					onclick={onClose}
				>
					{t('shared.bugModal.close')}
				</Button>
			</div>

			{#if successMessage}
				<p class="bug-modal__success" role="status">{t('shared.bugModal.successMessage')}</p>
			{:else}
				{#if error}
					<p class="bug-modal__error" role="alert">{error}</p>
				{/if}

				<form class="bug-modal__form" onsubmit={handleSubmit}>
					<label class="bug-modal__label" for="bug-description">
						{t('shared.bugModal.description')}
					</label>
					<textarea
						bind:this={firstInputEl}
						id="bug-description"
						class="bug-modal__textarea"
						placeholder={t('shared.bugModal.descriptionPlaceholder')}
						bind:value={description}
						required
						rows="4"
						disabled={loading}
					></textarea>

					<label class="bug-modal__label" for="bug-name">
						{t('shared.bugModal.name')}
					</label>
					<input
						id="bug-name"
						type="text"
						class="bug-modal__input"
						placeholder={t('shared.bugModal.namePlaceholder')}
						bind:value={name}
						required={nameRequired}
						disabled={loading}
					/>

					<Button type="submit" variant="primary" disabled={loading}>
						{loading ? t('shared.bugModal.submitting') : t('shared.bugModal.submit')}
					</Button>
				</form>
			{/if}
		</div>
	</div>
{/if}

<style>
	.bug-modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: var(--color-overlay-scrim);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
	}

	.bug-modal-panel {
		background: var(--color-card-bg);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-modal-elevated);
		width: 100%;
		max-width: 24rem;
		padding: var(--space-5);
	}

	.bug-modal__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-4);
	}

	.bug-modal__title {
		margin: 0;
	}

	.bug-modal__error {
		margin: 0 0 var(--space-4);
		padding: var(--space-3);
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--typ-caption-font-weight);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
		color: var(--color-error-text);
		background: var(--color-error-bg);
		border: 1px solid var(--color-error-border);
		border-radius: var(--radius-sm);
	}

	.bug-modal__success {
		margin: 0;
		padding: var(--space-3);
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--typ-caption-font-weight);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
		color: var(--color-text);
		background: var(--color-accent-bg);
		border-radius: var(--radius-sm);
	}

	.bug-modal__form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.bug-modal__label {
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text);
	}

	.bug-modal__textarea,
	.bug-modal__input {
		width: 100%;
		padding: var(--space-3) var(--space-4);
		font-family: var(--typ-interactive-1-font-family);
		font-size: var(--primitive-type-size-16);
		font-weight: var(--typ-interactive-1-font-weight);
		line-height: var(--typ-interactive-1-line-height);
		letter-spacing: var(--typ-interactive-1-letter-spacing);
		color: var(--color-text);
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-input);
	}
	.bug-modal__textarea::placeholder,
	.bug-modal__input::placeholder {
		color: var(--color-text-muted);
	}
	.bug-modal__textarea:hover,
	.bug-modal__input:hover {
		border-color: var(--color-border-hover);
	}
	.bug-modal__textarea:focus,
	.bug-modal__input:focus {
		outline: none;
		box-shadow: var(--shadow-focus-input);
		border-color: var(--color-focus);
	}
	.bug-modal__textarea:disabled,
	.bug-modal__input:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.bug-modal__textarea {
		resize: vertical;
		min-height: 6rem;
	}
</style>
