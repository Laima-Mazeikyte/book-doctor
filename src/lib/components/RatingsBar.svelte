<script lang="ts">
	import { tick } from 'svelte';
	import { fly } from 'svelte/transition';
	import { Book as BookIcon, Star } from 'lucide-svelte';
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
	/** Slide distance in px; negative x → panel flies in from the left (desktop and mobile). */
	const DRAWER_SLIDE_PX_DESKTOP = 420;

	function drawerSlidePx(): number {
		if (typeof window === 'undefined') return -DRAWER_SLIDE_PX_DESKTOP;
		return window.matchMedia('(min-width: 768px)').matches
			? -DRAWER_SLIDE_PX_DESKTOP
			: -window.innerWidth;
	}

	let flyX = $state(-DRAWER_SLIDE_PX_DESKTOP);

	function setCoverFailed(bookId: string) {
		coverFailedIds = new Set(coverFailedIds).add(bookId);
	}

	const RATING_OPTIONS: RatingValue[] = [1, 2, 3, 4, 5];

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
		flyX = drawerSlidePx();
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

{#snippet ratingsDrawerStarGlyph(filled: boolean)}
	<span class="ratings-drawer__star-icon" aria-hidden="true">
		<Star fill={filled ? 'currentColor' : 'none'} aria-hidden="true" />
	</span>
{/snippet}

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
		<BookIcon size={14} aria-hidden="true" />
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
				in:fly={{ x: flyX, duration: 200 }}
				out:fly={{ x: flyX, duration: 150 }}
			>
				<div class="ratings-drawer__header">
					<h2 id="ratings-drawer-title" class="ratings-drawer__title typ-h3">
						{t('shared.ratingsBar.yourRatings')}
					</h2>
					<Button
						variant="tertiary"
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
												<div class="ratings-drawer__stars">
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
																hoverEntryId = null;
																hoverRating = 0; // reset hover so mobile (no mouseleave) shows correct state after tap
																if (entry.rating === value) {
																	ratingsStore.removeRating(entry.book.id, entry.book.book_id);
																} else {
																	ratingsStore.setRating(entry.book.id, value, entry.book.book_id, entry.book);
																}
															}}
														>
															{@render ratingsDrawerStarGlyph(displayRating >= value)}
														</button>
													{/each}
												</div>
												<Button
													variant="tertiary"
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
		justify-content: center;
		flex: 0 0 auto;
		box-sizing: border-box;
		width: max-content;
		max-width: 100%;
		min-width: var(--book-card-action-height, 2.25rem);
		height: var(--book-card-action-height, 2.25rem);
		padding-block: 0;
		padding-inline-start: var(--space-2);
		padding-inline-end: var(--space-3);
		gap: var(--space-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-bg-muted);
		color: var(--color-text);
		cursor: pointer;
		pointer-events: auto;
		transition: background var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}
	.ratings-bar__trigger:hover {
		background: var(--color-book-card-action-hover-bg);
	}
	.ratings-bar__trigger:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.ratings-bar__icon {
		display: inline-flex;
		flex-shrink: 0;
		color: inherit;
	}
	.ratings-bar__icon :global(svg) {
		flex-shrink: 0;
	}
	.ratings-bar__count {
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: 1;
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		font-variant-numeric: tabular-nums;
		color: inherit;
	}

	.ratings-drawer-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: var(--color-overlay-scrim-soft);
		display: flex;
		align-items: stretch;
		justify-content: flex-start;
	}

	.ratings-drawer-panel {
		position: relative;
		z-index: 1;
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

	@media (max-width: 767px) {
		.ratings-drawer-overlay {
			background: var(--color-bg);
		}
		.ratings-drawer-panel {
			width: 100%;
			max-width: none;
			min-width: 0;
			min-height: 100dvh;
			height: 100dvh;
			box-shadow: none;
		}
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
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--typ-caption-font-weight);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
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
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--typ-caption-font-weight);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
		color: var(--color-book-title);
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
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--font-weight-semibold);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
		color: var(--color-book-title);
		display: block;
	}
	.ratings-drawer__item-author {
		font-family: var(--typ-caption-font-family);
		font-size: var(--typ-caption-font-size);
		font-weight: var(--typ-caption-font-weight);
		line-height: var(--typ-caption-line-height);
		letter-spacing: var(--typ-caption-letter-spacing);
		color: var(--color-text-muted);
		display: block;
		margin-top: var(--space-1);
	}
	.ratings-drawer__item-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
		margin-top: var(--space-2);
	}
	.ratings-drawer__stars {
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		gap: 0;
	}
	.ratings-drawer__star {
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		min-width: 32px;
		min-height: 32px;
		padding: 0;
		font-family: var(--typ-interactive-1-font-family);
		font-weight: var(--typ-interactive-1-font-weight);
		line-height: 1;
		letter-spacing: 0;
		border: none;
		background: transparent;
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--color-book-rating-star-muted);
	}
	/* Match BookCard star icon size. */
	.ratings-drawer__star-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 20px;
		height: 20px;
	}
	.ratings-drawer__star-icon :global(svg) {
		width: 100%;
		height: 100%;
	}
	.ratings-drawer__star:hover {
		background: var(--color-bg-hover);
		color: var(--color-book-rating-star);
	}
	.ratings-drawer__star:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.ratings-drawer__star--active {
		background: transparent;
		color: var(--color-book-rating-star);
	}
	/* Button is a child component — :global so compact height applies to Remove */
	.ratings-drawer__item-actions :global(.btn.btn--compact) {
		box-sizing: border-box;
		min-height: 32px;
		height: 32px;
		padding-block: 0;
		padding-inline: var(--space-4);
	}
</style>
