<script lang="ts">
	import { tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import { get } from 'svelte/store';
	import Button from '$lib/components/Button.svelte';
	import { authStore } from '$lib/stores/auth';
	import {
		parseGoodreadsCsv,
		GoodreadsCsvError,
		type GoodreadsCsvErrorCode
	} from '$lib/goodreads/parseGoodreadsCsv';
	import { runGoodreadsImport, type ImportMiss } from '$lib/goodreads/runImport';
	import type { GoodreadsRow } from '$lib/goodreads/types';
	import { t } from '$lib/copy';

	interface Props {
		open: boolean;
		onClose: () => void;
	}

	let { open, onClose }: Props = $props();

	type Phase = 'select' | 'preview' | 'importing' | 'done' | 'timeout';

	let phase = $state<Phase>('select');
	let rows = $state<GoodreadsRow[]>([]);
	let error = $state<string | null>(null);
	let imported = $state(0);
	let misses = $state<ImportMiss[]>([]);
	let closeButtonEl = $state<HTMLButtonElement | null>(null);

	const titleId = 'goodreads-modal-title';

	/** Pick the _one/_other copy variant by count (matches the app's existing plural pattern). */
	function plural(baseKey: string, count: number): string {
		return t(`${baseKey}_${count === 1 ? 'one' : 'other'}`, { count });
	}

	const PARSE_ERROR_COPY: Record<GoodreadsCsvErrorCode, string> = {
		not_export: 'shared.goodreadsModal.errorParse',
		file_too_large: 'shared.goodreadsModal.errorFileTooLarge',
		too_many_rows: 'shared.goodreadsModal.errorTooManyRows'
	};

	function portal(node: HTMLElement, target: HTMLElement = document.body) {
		target.appendChild(node);
		return {
			destroy() {
				node.parentNode?.removeChild(node);
			}
		};
	}

	function reset() {
		phase = 'select';
		rows = [];
		error = null;
		imported = 0;
		misses = [];
	}

	function handleOverlayClick(e: MouseEvent) {
		// Don't let an accidental backdrop click discard an in-flight import.
		if (e.target === e.currentTarget && phase !== 'importing') onClose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && phase !== 'importing') onClose();
	}

	$effect(() => {
		if (open) reset();
	});

	$effect(() => {
		if (!open) return;
		tick().then(() => closeButtonEl?.focus());
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

	async function handleFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		error = null;

		try {
			const parsed = await parseGoodreadsCsv(file);
			rows = parsed.rows;
			phase = 'preview';
		} catch (err) {
			error =
				err instanceof GoodreadsCsvError
					? t(PARSE_ERROR_COPY[err.code])
					: t('shared.goodreadsModal.errorGeneric');
		} finally {
			// Allow re-selecting the same file after an error.
			input.value = '';
		}
	}

	async function handleImport() {
		const userId = get(authStore).user?.id;
		if (!userId) {
			error = t('shared.goodreadsModal.errorGeneric');
			return;
		}

		error = null;
		phase = 'importing';
		const result = await runGoodreadsImport(userId, rows);

		if (result.kind === 'error') {
			error = t('shared.goodreadsModal.errorSubmit');
			phase = 'preview';
			return;
		}
		if (result.kind === 'timeout') {
			phase = 'timeout';
			return;
		}

		imported = result.imported;
		misses = result.misses;
		phase = 'done';
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		use:portal
		class="gr-modal-overlay"
		role="dialog"
		aria-modal="true"
		aria-labelledby={titleId}
		tabindex="-1"
		onclick={handleOverlayClick}
		onkeydown={handleKeydown}
		transition:fade={{ duration: 150 }}
	>
		<div
			class="gr-modal-panel"
			role="presentation"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<div class="gr-modal__header">
				<h2 id={titleId} class="gr-modal__title typ-h3">{t('shared.goodreadsModal.title')}</h2>
				<Button
					variant="secondary"
					compact
					type="button"
					aria-label={t('shared.goodreadsModal.close')}
					disabled={phase === 'importing'}
					ref={(el) => (closeButtonEl = el as HTMLButtonElement)}
					onclick={onClose}
				>
					{t('shared.goodreadsModal.close')}
				</Button>
			</div>

			{#if error}
				<p class="gr-modal__error" role="alert">{error}</p>
			{/if}

			{#if phase === 'select'}
				<p class="gr-modal__intro">{t('shared.goodreadsModal.intro')}</p>
				<input
					type="file"
					accept=".csv,text/csv"
					class="gr-modal__file"
					onchange={handleFileChange}
				/>
			{:else if phase === 'preview'}
				{#if rows.length === 0}
					<p class="gr-modal__intro">{t('shared.goodreadsModal.previewNone')}</p>
					<div class="gr-modal__actions">
						<Button variant="secondary" onclick={reset}
							>{t('shared.goodreadsModal.chooseAnother')}</Button
						>
					</div>
				{:else}
					<p class="gr-modal__intro">
						{plural('shared.goodreadsModal.previewSummary', rows.length)}
					</p>
					<div class="gr-modal__actions">
						<Button variant="secondary" onclick={reset}
							>{t('shared.goodreadsModal.chooseAnother')}</Button
						>
						<Button variant="primary" onclick={handleImport}
							>{t('shared.goodreadsModal.import')}</Button
						>
					</div>
				{/if}
			{:else if phase === 'importing'}
				<p class="gr-modal__intro" role="status">{t('shared.goodreadsModal.importing')}</p>
			{:else if phase === 'timeout'}
				<p class="gr-modal__intro" role="status">{t('shared.goodreadsModal.timeout')}</p>
				<div class="gr-modal__actions">
					<Button variant="primary" onclick={onClose}>{t('shared.goodreadsModal.close')}</Button>
				</div>
			{:else if phase === 'done'}
				<p class="gr-modal__intro" role="status">
					{plural('shared.goodreadsModal.doneSummary', imported)}
				</p>
				{#if misses.length > 0}
					<p class="gr-modal__misses-heading">
						{t('shared.goodreadsModal.unmatchedHeading', { count: misses.length })}
					</p>
					<ul class="gr-modal__misses">
						{#each misses as miss (miss.goodreads_id)}
							<li class="gr-modal__miss">
								<span class="gr-modal__miss-title">{miss.title}</span>
								{#if miss.author}<span class="gr-modal__miss-author"> — {miss.author}</span>{/if}
							</li>
						{/each}
					</ul>
				{/if}
				<div class="gr-modal__actions">
					<Button variant="primary" onclick={onClose}>{t('shared.goodreadsModal.done')}</Button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.gr-modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: var(--color-overlay-scrim);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
	}

	.gr-modal-panel {
		background: var(--color-card-bg);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-modal-elevated);
		width: 100%;
		max-width: 28rem;
		max-height: 85vh;
		overflow-y: auto;
		padding: var(--space-5);
	}

	.gr-modal__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-4);
	}

	.gr-modal__title {
		margin: 0;
	}

	.gr-modal__intro {
		margin: 0 0 var(--space-4);
		font-family: var(--typ-body-1-font-family);
		font-size: var(--typ-body-1-font-size);
		font-weight: var(--typ-body-1-font-weight);
		line-height: var(--typ-body-1-line-height);
		letter-spacing: var(--typ-body-1-letter-spacing);
		color: var(--color-text);
	}

	.gr-modal__error {
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

	.gr-modal__file {
		display: block;
		width: 100%;
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		color: var(--color-text);
	}

	.gr-modal__actions {
		display: flex;
		gap: var(--space-3);
		justify-content: flex-end;
		flex-wrap: wrap;
	}

	.gr-modal__misses-heading {
		margin: 0 0 var(--space-2);
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text-muted);
	}

	.gr-modal__misses {
		margin: 0 0 var(--space-4);
		padding: 0 0 0 var(--space-4);
		max-height: 14rem;
		overflow-y: auto;
	}

	.gr-modal__miss {
		font-family: var(--typ-body-1-font-family);
		font-size: var(--typ-body-1-font-size);
		line-height: var(--typ-body-1-line-height);
		color: var(--color-text);
	}

	.gr-modal__miss-author {
		color: var(--color-text-muted);
	}
</style>
