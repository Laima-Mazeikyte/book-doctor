<script lang="ts">
	import { t } from '$lib/copy';
	import { isVisibleQualityBand } from '$lib/qualityEvidence';
	import type { Book } from '$lib/types/book';

	interface Props {
		book: Book;
	}

	let { book }: Props = $props();

	const visibleBand = $derived(isVisibleQualityBand(book.qualityBand) ? book.qualityBand : null);
	const bandLabel = $derived(visibleBand ? t(`shared.qualityEvidence.bands.${visibleBand}`) : '');
</script>

{#if visibleBand}
	<p
		class="book-quality-evidence typ-caption"
		data-testid="book-quality-evidence"
		data-quality-band={visibleBand}
	>
		<span class="book-quality-evidence__label">{t('shared.qualityEvidence.label')}:</span>
		<span class="book-quality-evidence__value">{bandLabel}</span>
	</p>
{/if}

<style>
	.book-quality-evidence {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		width: 100%;
		margin: 0;
		color: var(--color-text-muted);
	}
	.book-quality-evidence__label {
		font-weight: var(--font-weight-medium);
	}
	.book-quality-evidence__value {
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-bg-muted);
		color: var(--color-text);
		white-space: nowrap;
	}
</style>
