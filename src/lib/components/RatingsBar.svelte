<script lang="ts">
	import { tick } from 'svelte';
	import { fly } from 'svelte/transition';
	import { Book as BookIcon } from 'lucide-svelte';
	import Button from '$lib/components/Button.svelte';
	import { ratingsStore } from '$lib/stores/ratings';
	import { t } from '$lib/copy';
	import type { Book, RatingValue } from '$lib/types/book';

	interface RatedEntry {
		book: Book;
		rating: RatingValue;
	}

	interface Props {
		ratedEntries: RatedEntry[];
	}

	let { ratedEntries }: Props = $props();

	let open = $state(false);
	let hoverEntryId = $state<string | null>(null);
	let hoverRating = $state<number>(0);
	let coverFailedIds = $state<Set<string>>(new Set());
	let closeButtonEl = $state<HTMLButtonElement | HTMLAnchorElement | null>(null);
	const panelId = 'ratings-drawer-panel';
	const triggerId = 'ratings-trigger';

	function setCoverFailed(bookId: string) {
		coverFailedIds = new Set(coverFailedIds).add(bookId);
	}

	const RATING_OPTIONS: RatingValue[] = [1, 2, 3, 4, 5];
	const STAR_FILLED = '★';
	const STAR_EMPTY = '☆';

	/** Portal node to body so it's not inside the bottom bar (pointer-events: none) and can receive clicks. */
	function portal(node: HTMLElement, target: HTMLElement = document.body) {
		target.appendChild(node);
		return {
			destroy() {
				node.parentNode?.removeChild(node);
			}
		};
	}

	function openDrawer() {
		open = true;
	}

	function closeDrawer() {
		open = false;
	}

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) closeDrawer();
	}

	function handleOverlayKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			closeDrawer();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') closeDrawer();
	}

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
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Fragment root so the button is a direct child of the bottom bar and receives pointer-events -->
<button
	id={triggerId}
	type="button"
	class="ratings-bar__trigger"
	aria-expanded={open}
	aria-controls={panelId}
	aria-haspopup="dialog"
	aria-label={t('shared.ratingsBar.yourRatings')}
	onclick={openDrawer}
>
	<span class="ratings-bar__icon">
		<BookIcon size={20} aria-hidden="true" />
	</span>
	<span class="ratings-bar__count" aria-hidden="true">{ratedEntries.length}</span>
</button>

{#if open}
		<div
			use:portal
			id={panelId}
			class="ratings-drawer-overlay"
			role="dialog"
			aria-modal="true"
			aria-labelledby="ratings-drawer-title"
			tabindex="-1"
			onclick={handleOverlayClick}
			onkeydown={handleOverlayKeydown}
		>
			<div
				class="ratings-drawer-panel"
				in:fly={{ x: -320, duration: 200 }}
				out:fly={{ x: -320, duration: 150 }}
			>
				<div class="ratings-drawer__header">
					<h2 id="ratings-drawer-title" class="ratings-drawer__title">
						{t('shared.ratingsBar.yourRatings')}
					</h2>
					<Button
						variant="secondary"
						pill
						compact
						type="button"
						aria-label={t('shared.ratingsBar.close')}
						ref={(el) => (closeButtonEl = el)}
						onclick={closeDrawer}
					>
						{t('shared.ratingsBar.close')}
					</Button>
				</div>
				<div class="ratings-drawer__body">
					{#if ratedEntries.length === 0}
						<p class="ratings-drawer__empty">
							{t('shared.ratingsBar.empty')}
						</p>
					{:else}
						<ul class="ratings-drawer__list">
							{#each ratedEntries as entry (entry.book.id)}
								<li class="ratings-drawer__item">
									<div class="ratings-drawer__item-main">
										<div class="ratings-drawer__item-cover">
											{#if entry.book.coverUrl && !coverFailedIds.has(entry.book.id)}
												<img
													src={entry.book.coverUrl}
													alt=""
													class="ratings-drawer__cover-img"
													onerror={() => setCoverFailed(entry.book.id)}
												/>
											{:else}
												<div class="ratings-drawer__cover-placeholder">
													<span class="ratings-drawer__cover-text">{entry.book.title}</span>
												</div>
											{/if}
										</div>
										<div class="ratings-drawer__item-info">
											<span class="ratings-drawer__item-title">{entry.book.title}</span>
											<span class="ratings-drawer__item-author">{entry.book.author}</span>
											<div
												class="ratings-drawer__item-actions"
												role="group"
												aria-label={t('shared.ratingsBar.changeOrRemoveRating')}
												onmouseleave={() => { hoverEntryId = null; hoverRating = 0; }}
											>
												{#each RATING_OPTIONS as value}
													{@const displayRating = hoverEntryId === entry.book.id && hoverRating > 0 ? hoverRating : entry.rating}
													<button
														type="button"
														class="ratings-drawer__star"
														class:ratings-drawer__star--active={displayRating >= value}
														aria-label={entry.rating === value ? t('shared.ratingsBar.rateOutOf5Clear', { value }) : t('shared.ratingsBar.setRatingTo', { value })}
														aria-pressed={entry.rating === value}
														onmouseenter={() => { hoverEntryId = entry.book.id; hoverRating = value; }}
														onclick={() => {
															if (entry.rating === value) {
																ratingsStore.removeRating(entry.book.id, entry.book.book_id);
															} else {
																ratingsStore.setRating(entry.book.id, value, entry.book.book_id, entry.book);
															}
														}}
													>
														<span aria-hidden="true">{displayRating >= value ? STAR_FILLED : STAR_EMPTY}</span>
													</button>
												{/each}
												<Button
													variant="secondary"
													pill
													compact
													type="button"
													aria-label={t('shared.ratingsBar.removeRatingFor', { title: entry.book.title })}
													onclick={() => ratingsStore.removeRating(entry.book.id, entry.book.book_id)}
												>
													{t('shared.ratingsBar.remove')}
												</Button>
											</div>
										</div>
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
		gap: var(--space-1);
		min-height: var(--min-tap);
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-size-md);
		font-weight: var(--font-weight-medium);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-bg-muted);
		color: var(--color-text);
		cursor: pointer;
		pointer-events: auto;
		transition: background var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
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
		display: inline-flex;
		flex-shrink: 0;
		color: var(--color-text-muted);
	}
	.ratings-bar__count {
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.ratings-drawer-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: transparent;
		display: flex;
		align-items: stretch;
		justify-content: flex-start;
	}

	.ratings-drawer-panel {
		position: relative;
		width: min(400px, 85vw);
		min-width: 320px;
		max-width: 400px;
		height: 100%;
		background: var(--color-bg);
		box-shadow: var(--shadow-drawer);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.ratings-drawer__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}
	.ratings-drawer__title {
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-semibold);
		margin: 0;
	}

	.ratings-drawer__body {
		overflow-y: auto;
		padding: var(--space-4) var(--space-5);
		flex: 1;
		min-height: 0;
	}
	.ratings-drawer__empty {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--font-size-md);
	}
	.ratings-drawer__list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.ratings-drawer__item {
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--color-border);
	}
	.ratings-drawer__item:last-child {
		border-bottom: none;
	}
	.ratings-drawer__item-main {
		display: flex;
		gap: var(--space-3);
		align-items: flex-start;
	}
	.ratings-drawer__item-cover {
		flex-shrink: 0;
		width: 3.5rem;
		aspect-ratio: 2 / 3;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--color-card-placeholder-bg);
	}
	.ratings-drawer__cover-img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.ratings-drawer__cover-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-1);
		text-align: center;
	}
	.ratings-drawer__cover-text {
		font-size: var(--font-size-xs);
		line-height: 1.2;
		color: var(--color-text-muted);
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
	}
	.ratings-drawer__item-info {
		flex: 1;
		min-width: 0;
	}
	.ratings-drawer__item-title {
		font-weight: var(--font-weight-semibold);
		font-size: var(--font-size-md);
		display: block;
		line-height: 1.3;
	}
	.ratings-drawer__item-author {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		display: block;
		margin-top: var(--space-1);
	}
	.ratings-drawer__item-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		align-items: center;
		margin-top: var(--space-2);
	}
	.ratings-drawer__star {
		min-width: 1.75rem;
		min-height: 1.75rem;
		padding: var(--space-1);
		font-size: var(--font-size-base);
		line-height: 1;
		border: none;
		background: transparent;
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--color-text-muted);
	}
	.ratings-drawer__star:hover {
		background: var(--color-bg-hover);
		color: var(--color-text);
	}
	.ratings-drawer__star:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.ratings-drawer__star--active {
		background: transparent;
		color: var(--color-text);
	}
	.ratings-drawer__item-actions .btn {
		margin-left: var(--space-1);
	}
</style>
