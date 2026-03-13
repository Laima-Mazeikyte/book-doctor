<script lang="ts">
	import { tick } from 'svelte';
	import { Book as BookIcon } from 'lucide-svelte';
	import { ratingsStore } from '$lib/stores/ratings';
	import type { Book, RatingValue } from '$lib/types/book';

	interface RatedEntry {
		book: Book;
		rating: RatingValue;
	}

	interface Props {
		ratedEntries: RatedEntry[];
	}

	let { ratedEntries }: Props = $props();

	let modalOpen = $state(false);
	let hoverEntryId = $state<string | null>(null);
	let hoverRating = $state<number>(0);
	let modalId = 'ratings-modal';
	let closeId = 'ratings-modal-close';
	let triggerId = 'ratings-trigger';

	const RATING_OPTIONS: RatingValue[] = [1, 2, 3, 4, 5];
	const STAR_FILLED = '★';
	const STAR_EMPTY = '☆';

	function openModal() {
		modalOpen = true;
	}

	function closeModal() {
		modalOpen = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') closeModal();
	}

	$effect(() => {
		if (!modalOpen) return;
		tick().then(() => {
			const focusable = document.querySelector(
				`#${modalId} [data-modal-focus]`
			) as HTMLElement | null;
			focusable?.focus();
		});
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<button
	id={triggerId}
	type="button"
	class="ratings-bar__trigger"
	aria-expanded={modalOpen}
	aria-controls={modalId}
	aria-haspopup="dialog"
	aria-label="Your ratings"
	onclick={openModal}
>
	<BookIcon class="ratings-bar__icon" size={20} aria-hidden="true" />
	<span class="ratings-bar__count" aria-hidden="true">{ratedEntries.length}</span>
</button>

{#if modalOpen}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		id={modalId}
		class="ratings-modal"
		role="dialog"
		aria-modal="true"
		aria-labelledby="ratings-modal-title"
		onclick={(e) => e.target === e.currentTarget && closeModal()}
	>
		<div class="ratings-modal__backdrop" aria-hidden="true" />
		<div class="ratings-modal__panel">
			<div class="ratings-modal__header">
				<h2 id="ratings-modal-title" class="ratings-modal__title">
					Your ratings
				</h2>
				<button
					id={closeId}
					type="button"
					class="ratings-modal__close"
					aria-label="Close"
					data-modal-focus
					onclick={closeModal}
				>
					Close
				</button>
			</div>
			<div class="ratings-modal__body">
				{#if ratedEntries.length === 0}
					<p class="ratings-modal__empty">
						No books rated yet. Rate at least 10 to get recommendations.
					</p>
				{:else}
					<ul class="ratings-modal__list">
						{#each ratedEntries as entry (entry.book.id)}
							<li class="ratings-modal__item">
								<div class="ratings-modal__item-info">
									<span class="ratings-modal__item-title">{entry.book.title}</span>
									<span class="ratings-modal__item-author">{entry.book.author}</span>
									<span class="ratings-modal__item-stars" aria-hidden="true">
										{#each RATING_OPTIONS as value}
											{entry.rating >= value ? STAR_FILLED : STAR_EMPTY}
										{/each}
									</span>
								</div>
								<div
									class="ratings-modal__item-actions"
									role="group"
									aria-label="Change or remove rating"
									onmouseleave={() => { hoverEntryId = null; hoverRating = 0; }}
								>
									{#each RATING_OPTIONS as value}
										{@const displayRating = hoverEntryId === entry.book.id && hoverRating > 0 ? hoverRating : entry.rating}
										<button
											type="button"
											class="ratings-modal__star"
											class:ratings-modal__star--active={displayRating >= value}
											aria-label="Set rating to {value} out of 5"
											aria-pressed={entry.rating === value}
											onmouseenter={() => { hoverEntryId = entry.book.id; hoverRating = value; }}
											onclick={() => ratingsStore.setRating(entry.book.id, value)}
										>
											<span aria-hidden="true">{displayRating >= value ? STAR_FILLED : STAR_EMPTY}</span>
										</button>
									{/each}
									<button
										type="button"
										class="ratings-modal__remove"
										aria-label="Remove rating for {entry.book.title}"
										onclick={() => ratingsStore.removeRating(entry.book.id)}
									>
										Remove
									</button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.ratings-bar__trigger {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: var(--min-tap);
		padding: 0.5rem 1rem;
		font-size: 0.9375rem;
		font-weight: 500;
		border: 1px solid var(--color-border);
		border-radius: 9999px;
		background: var(--color-bg-muted);
		color: var(--color-text);
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}
	.ratings-bar__trigger:hover {
		background: var(--color-bg-hover);
		border-color: var(--color-border-hover);
	}
	.ratings-bar__trigger:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.ratings-bar__icon {
		flex-shrink: 0;
		color: var(--color-text-muted);
	}
	.ratings-bar__count {
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.ratings-modal {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: stretch;
		justify-content: center;
		padding: 0;
	}
	.ratings-modal__backdrop {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
	}
	.ratings-modal__panel {
		position: relative;
		width: 100%;
		max-width: 36rem;
		height: 100%;
		height: 100dvh;
		background: var(--color-bg, #fff);
		box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.ratings-modal__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--color-border, #e5e5e5);
		flex-shrink: 0;
	}
	.ratings-modal__title {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0;
	}
	.ratings-modal__close {
		min-height: 2.5rem;
		padding: 0.5rem 1rem;
		font-size: 0.9375rem;
		font-weight: 500;
		border: 1px solid var(--color-border, #ccc);
		background: var(--color-bg, #fff);
		border-radius: var(--radius-sm, 6px);
		cursor: pointer;
		color: var(--color-text, #171717);
	}
	.ratings-modal__close:hover {
		background: var(--color-bg-hover, #f5f5f5);
	}
	.ratings-modal__close:focus-visible {
		outline: 2px solid var(--color-focus, #0066cc);
		outline-offset: 2px;
	}
	.ratings-modal__body {
		overflow-y: auto;
		padding: 1rem 1.25rem;
		flex: 1;
		min-height: 0;
	}
	.ratings-modal__empty {
		margin: 0;
		color: var(--color-text-muted, #555);
		font-size: 0.9375rem;
	}
	.ratings-modal__list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.ratings-modal__item {
		padding: 1rem 0;
		border-bottom: 1px solid var(--color-border, #e0e0e0);
	}
	.ratings-modal__item:last-child {
		border-bottom: none;
	}
	.ratings-modal__item-info {
		display: block;
		margin-bottom: 0.5rem;
	}
	.ratings-modal__item-title {
		font-weight: 600;
		display: block;
	}
	.ratings-modal__item-author {
		font-size: 0.875rem;
		color: var(--color-text-muted, #555);
	}
	.ratings-modal__item-stars {
		display: block;
		font-size: 1rem;
		color: var(--color-accent, #1976d2);
		margin-top: 0.25rem;
		letter-spacing: 0.05em;
	}
	.ratings-modal__item-actions {
		display: flex;
		flex-wrap: nowrap;
		gap: 0.25rem;
		align-items: center;
	}
	.ratings-modal__star {
		min-width: 2rem;
		min-height: 2rem;
		padding: 0.25rem;
		font-size: 1.125rem;
		line-height: 1;
		border: none;
		background: transparent;
		border-radius: var(--radius-sm, 6px);
		cursor: pointer;
		color: var(--color-text-muted, #888);
	}
	.ratings-modal__star:hover {
		background: var(--color-bg-hover, #f5f5f5);
		color: var(--color-text, #1a1a1a);
	}
	.ratings-modal__star:focus-visible {
		outline: 2px solid var(--color-focus, #0066cc);
		outline-offset: 2px;
	}
	.ratings-modal__star--active {
		background: transparent;
		color: var(--color-accent, #1976d2);
	}
	.ratings-modal__remove {
		min-height: 2.75rem;
		padding: 0.375rem 0.75rem;
		font-size: 0.875rem;
		border: 1px solid var(--color-border, #ccc);
		background: var(--color-bg, #fff);
		border-radius: 4px;
		cursor: pointer;
		margin-left: 0.25rem;
	}
	.ratings-modal__remove:hover {
		background: var(--color-bg-hover, #f5f5f5);
	}
	.ratings-modal__remove:focus-visible {
		outline: 2px solid var(--color-focus, #0066cc);
		outline-offset: 2px;
	}
</style>
