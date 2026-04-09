<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { fly } from 'svelte/transition';
	import { Book as BookIcon, X } from 'lucide-svelte';
	import Button from '$lib/components/Button.svelte';
	import BookRatingStarsRow from '$lib/components/book-card/BookRatingStarsRow.svelte';
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
	/** Book ids in list order when the drawer was opened; cleared on close so the next open uses store order (most recent first). */
	let drawerOrderIds = $state<string[] | null>(null);
	let hoverEntryId = $state<string | null>(null);
	let hoverRating = $state<number>(0);
	let coverFailedIds = $state<Set<string>>(new Set());
	/** Book ids scheduled for removal after `PENDING_REMOVE_MS`; store still holds rating until the timer fires or user undoes. */
	let pendingRemoveIds = $state<Set<string>>(new Set());
	/** `Date.now()` when each pending removal will commit (for progress UI). */
	let pendingRemoveEndByBookId = $state(new Map<string, number>());
	let removalUiClock = $state(Date.now());
	let closeButtonEl = $state<HTMLButtonElement | null>(null);
	const ratingsSyncMeta = ratingsStore.syncMeta;
	const panelId = 'ratings-drawer-panel';
	const triggerId = 'ratings-trigger';
	const PENDING_REMOVE_MS = 3000;
	const pendingRemoveTimers = new Map<string, ReturnType<typeof setTimeout>>();
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

	let drawerSyncState: 'pending' | 'failed' | null = $derived.by(() => {
		if ($ratingsSyncMeta.queuedCount === 0) return null;
		if ($ratingsSyncMeta.isFlushing || $ratingsSyncMeta.failedCount === 0) return 'pending';
		return 'failed';
	});

	let drawerSyncText = $derived.by(() => {
		if (drawerSyncState === 'failed') return t('shared.ratingsBar.retryNeeded');
		if (drawerSyncState === 'pending') return t('shared.ratingsBar.syncing');
		return '';
	});

	let triggerAriaLabel = $derived(
		`${t('shared.ratingsBar.yourRatings')} (${ratedEntries.length})`
	);

	/** Portal node to body so it's not inside the bottom bar (pointer-events: none) and can receive clicks. */
	function portal(node: HTMLElement, target: HTMLElement = document.body) {
		target.appendChild(node);
		return {
			destroy() {
				node.parentNode?.removeChild(node);
			}
		};
	}

	/** While the drawer is open, keep row order stable even when the store moves the latest rating to the front. */
	let drawerRatedEntries = $derived.by(() => {
		if (!open || drawerOrderIds === null) return ratedEntries;
		const byId = new Map(ratedEntries.map((e) => [e.book.id, e]));
		const ordered: RatedEntry[] = [];
		const seen = new Set<string>();
		for (const id of drawerOrderIds) {
			const e = byId.get(id);
			if (e) {
				ordered.push(e);
				seen.add(id);
			}
		}
		for (const e of ratedEntries) {
			if (!seen.has(e.book.id)) {
				ordered.push(e);
				seen.add(e.book.id);
			}
		}
		return ordered;
	});

	function openDrawer() {
		flyX = drawerSlidePx();
		drawerOrderIds = ratedEntries.map((e) => e.book.id);
		open = true;
	}

	function clearPendingRemove(bookId: string) {
		const tid = pendingRemoveTimers.get(bookId);
		if (tid != null) {
			clearTimeout(tid);
			pendingRemoveTimers.delete(bookId);
		}
		if (pendingRemoveIds.has(bookId)) {
			pendingRemoveIds = new Set([...pendingRemoveIds].filter((id) => id !== bookId));
		}
		if (pendingRemoveEndByBookId.has(bookId)) {
			const next = new Map(pendingRemoveEndByBookId);
			next.delete(bookId);
			pendingRemoveEndByBookId = next;
		}
	}

	function clearAllPendingRemovals() {
		for (const tid of pendingRemoveTimers.values()) clearTimeout(tid);
		pendingRemoveTimers.clear();
		pendingRemoveIds = new Set();
		pendingRemoveEndByBookId = new Map();
	}

	function schedulePendingRemove(bookId: string, bookIdNum: number | undefined) {
		clearPendingRemove(bookId);
		pendingRemoveIds = new Set(pendingRemoveIds).add(bookId);
		const endsAt = Date.now() + PENDING_REMOVE_MS;
		pendingRemoveEndByBookId = new Map(pendingRemoveEndByBookId).set(bookId, endsAt);
		const tid = setTimeout(() => {
			pendingRemoveTimers.delete(bookId);
			pendingRemoveIds = new Set([...pendingRemoveIds].filter((id) => id !== bookId));
			const nextEnds = new Map(pendingRemoveEndByBookId);
			nextEnds.delete(bookId);
			pendingRemoveEndByBookId = nextEnds;
			ratingsStore.removeRating(bookId, bookIdNum);
		}, PENDING_REMOVE_MS);
		pendingRemoveTimers.set(bookId, tid);
	}

	$effect(() => {
		if (pendingRemoveIds.size === 0) return;
		const id = setInterval(() => {
			removalUiClock = Date.now();
		}, 80);
		return () => clearInterval(id);
	});

	function pendingRemoveFillRatio(bookId: string): number {
		const end = pendingRemoveEndByBookId.get(bookId);
		const msLeft = end != null ? Math.max(0, end - removalUiClock) : 0;
		return Math.max(0, Math.min(1, msLeft / PENDING_REMOVE_MS));
	}

	function closeDrawer() {
		open = false;
		drawerOrderIds = null;
	}

	onDestroy(() => {
		clearAllPendingRemovals();
	});

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

	function retryPendingRatings() {
		void ratingsStore.retryPending();
	}

	function starHoverPreviewSupported(): boolean {
		if (typeof window === 'undefined') return false;
		return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
	}

	function drawerStarMouseEnter(bookId: string, value: RatingValue) {
		if (!starHoverPreviewSupported()) return;
		hoverEntryId = bookId;
		hoverRating = value;
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

{#snippet ratingsBarTriggerIcon()}
	<BookIcon size={14} aria-hidden="true" />
{/snippet}

<svelte:window onkeydown={handleKeydown} />

<!-- Direct child of bottom bar (pointer-events); same Button variant as recommendations CTA -->
<Button
	variant="primary"
	pill
	class="ratings-bar__trigger"
	id={triggerId}
	type="button"
	aria-expanded={open}
	aria-controls={panelId}
	aria-haspopup="dialog"
	aria-label={triggerAriaLabel}
	icon={ratingsBarTriggerIcon}
	onclick={openDrawer}
>
	<span class="ratings-bar__count" aria-hidden="true">{ratedEntries.length}</span>
</Button>

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
				<button
					bind:this={closeButtonEl}
					type="button"
					class="ratings-drawer__close"
					aria-label={t('shared.ratingsBar.close')}
					onclick={closeDrawer}
				>
					<X size={18} aria-hidden="true" />
				</button>
				<div class="ratings-drawer__header">
					<h2 id="ratings-drawer-title" class="ratings-drawer__title typ-h3">
						{t('shared.ratingsBar.yourRatings')}
					</h2>
					{#if drawerSyncState}
						<div
							class="ratings-drawer__header-sync"
							class:ratings-drawer__header-sync--failed={drawerSyncState === 'failed'}
						>
							<div class="ratings-drawer__sync-status">
								<span
									class="ratings-drawer__sync-indicator"
									class:ratings-drawer__sync-indicator--pending={drawerSyncState === 'pending'}
									class:ratings-drawer__sync-indicator--failed={drawerSyncState === 'failed'}
									aria-hidden="true"
								>
									{#if drawerSyncState === 'failed'}!{/if}
								</span>
								<span class="ratings-drawer__sync-text">{drawerSyncText}</span>
							</div>
							{#if drawerSyncState === 'failed'}
								<Button variant="tertiary" compact type="button" onclick={retryPendingRatings}>
									{t('shared.ratingsBar.syncRatings')}
								</Button>
							{/if}
						</div>
					{/if}
				</div>
				<div class="ratings-drawer__body">
					{#if drawerRatedEntries.length === 0}
						<p class="ratings-drawer__empty">
							{t('shared.ratingsBar.empty')}
						</p>
					{:else}
						<ul class="ratings-drawer__list">
							{#each drawerRatedEntries as entry (entry.book.id)}
								<li
									class="ratings-drawer__item"
									class:ratings-drawer__item--pending-remove={pendingRemoveIds.has(entry.book.id)}
								>
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
												onmouseleave={() => {
													hoverEntryId = null;
													hoverRating = 0;
												}}
											>
												<BookRatingStarsRow
													ratingWrapWidth="auto"
													displayRating={pendingRemoveIds.has(entry.book.id)
														? hoverEntryId === entry.book.id && hoverRating > 0
															? hoverRating
															: 0
														: hoverEntryId === entry.book.id && hoverRating > 0
															? hoverRating
															: entry.rating}
													ariaGroupLabel={t('shared.bookCard.rateThisBook')}
													starAriaLabel={(value) =>
														entry.rating === value
															? t('shared.bookCard.rateOutOf5Clear', { value })
															: t('shared.bookCard.rateOutOf5', { value })}
													starAriaPressed={(value) =>
														pendingRemoveIds.has(entry.book.id) ? false : entry.rating === value}
													onmouseleave={() => {
														hoverEntryId = null;
														hoverRating = 0;
													}}
													onstarEnter={(value) => drawerStarMouseEnter(entry.book.id, value)}
													onstarClick={(value) => {
														hoverEntryId = null;
														hoverRating = 0;
														const bookId = entry.book.id;
														const bookIdNum = entry.book.book_id;
														if (pendingRemoveIds.has(bookId)) {
															if (value === entry.rating) {
																clearPendingRemove(bookId);
																return;
															}
															clearPendingRemove(bookId);
															ratingsStore.setRating(bookId, value, bookIdNum, entry.book);
															return;
														}
														if (entry.rating === value) {
															schedulePendingRemove(bookId, bookIdNum);
															return;
														}
														ratingsStore.setRating(bookId, value, bookIdNum, entry.book);
													}}
												/>
												{#if pendingRemoveIds.has(entry.book.id)}
													<Button
														variant="tertiary"
														compact
														type="button"
														aria-label={`${t('shared.ratingsBar.undoRemoveRatingFor', { title: entry.book.title })}. ${t('shared.ratingsBar.removePendingHint')}`}
														onclick={() => clearPendingRemove(entry.book.id)}
													>
														{t('shared.ratingsBar.undo')}
													</Button>
												{:else}
													<Button
														variant="tertiary"
														compact
														type="button"
														aria-label={t('shared.ratingsBar.removeRatingFor', { title: entry.book.title })}
														onclick={() =>
															schedulePendingRemove(entry.book.id, entry.book.book_id)}
													>
														{t('shared.ratingsBar.remove')}
													</Button>
												{/if}
											</div>
										</div>
									</div>
									{#if pendingRemoveIds.has(entry.book.id)}
										{@const fillRatio = pendingRemoveFillRatio(entry.book.id)}
										{@const removeProgressPct = Math.round((1 - fillRatio) * 100)}
										<div class="ratings-drawer__pending-remove-meter">
											<div
												class="ratings-drawer__pending-remove-meter__track"
												role="progressbar"
												aria-valuemin={0}
												aria-valuemax={100}
												aria-valuenow={removeProgressPct}
												aria-label={t('shared.ratingsBar.removeProgressBarLabel')}
											>
												<div
													class="ratings-drawer__pending-remove-meter__fill"
													style="width: {fillRatio * 100}%"
												></div>
											</div>
										</div>
									{/if}
								</li>
							{/each}
						</ul>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/* Layout + label row; colors from Button (primary pill, same as rate page CTA) */
	:global(.ratings-bar__trigger.btn) {
		flex: 0 0 auto;
		pointer-events: auto;
		gap: var(--space-1);
	}
	:global(.ratings-bar__trigger .btn__label) {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}
	.ratings-bar__count {
		line-height: 1;
		font-variant-numeric: tabular-nums;
		color: inherit;
	}
	@keyframes ratings-bar-sync-pulse {
		0%, 100% {
			opacity: 0.55;
			transform: scale(0.92);
		}
		50% {
			opacity: 1;
			transform: scale(1);
		}
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
		background: var(--color-card-bg);
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

	.ratings-drawer__close {
		position: absolute;
		top: calc(var(--space-2) + env(safe-area-inset-top, 0px));
		right: calc(var(--space-2) + env(safe-area-inset-right, 0px));
		z-index: 11;
		width: var(--min-tap);
		height: var(--min-tap);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: none;
		background: var(--color-floating-control-bg);
		border-radius: var(--radius-pill);
		cursor: pointer;
		color: var(--color-text);
		transition: background var(--duration-fast) var(--ease-default);
	}
	.ratings-drawer__close:hover {
		background: var(--color-floating-control-bg-hover);
	}
	.ratings-drawer__close:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.ratings-drawer__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-5);
		padding-right: calc(var(--space-2) + var(--min-tap) + var(--space-3));
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}
	.ratings-drawer__title {
		margin: 0;
		min-width: 0;
		flex: 1 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ratings-drawer__header-sync {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		flex: 0 1 auto;
		max-width: min(20rem, 68%);
		box-sizing: border-box;
		min-width: 0;
	}
	.ratings-drawer__header-sync .ratings-drawer__sync-status {
		flex: 1 1 auto;
		min-width: 0;
	}
	.ratings-drawer__header-sync .ratings-drawer__sync-text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
	.ratings-drawer__sync-status {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}
	.ratings-drawer__sync-indicator {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 999px;
	}
	.ratings-drawer__sync-indicator--pending {
		background: color-mix(in srgb, var(--color-book-rating-star) 72%, var(--color-bg));
		animation: ratings-bar-sync-pulse 1.4s ease-in-out infinite;
	}
	.ratings-drawer__sync-indicator--failed {
		background: var(--color-danger-tonal-bg);
		border: 1px solid var(--color-danger-tonal-border);
		color: var(--color-danger-tonal-text);
		font-family: var(--typ-caption-font-family);
		font-size: 0.625rem;
		font-weight: var(--font-weight-semibold);
		line-height: 1;
	}
	.ratings-drawer__sync-text {
		font-family: var(--typ-interactive-2-font-family);
		font-size: var(--typ-interactive-2-font-size);
		font-weight: var(--typ-interactive-2-font-weight);
		line-height: var(--typ-interactive-2-line-height);
		letter-spacing: var(--typ-interactive-2-letter-spacing);
		color: var(--color-text);
	}
	.ratings-drawer__header-sync--failed .ratings-drawer__sync-text {
		color: var(--color-danger-tonal-text);
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
	.ratings-drawer__item--pending-remove {
		position: relative;
		opacity: 0.88;
	}
	/* Progress line sits on the row’s bottom edge; no extra vertical space in normal flow. */
	.ratings-drawer__pending-remove-meter {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 3px;
		margin: 0;
		padding: 0;
		pointer-events: none;
	}
	.ratings-drawer__pending-remove-meter__track {
		width: 100%;
		height: 100%;
		border-radius: var(--radius-pill);
		background: var(--color-border);
		overflow: hidden;
	}
	.ratings-drawer__pending-remove-meter__fill {
		height: 100%;
		border-radius: inherit;
		background: color-mix(in srgb, var(--color-text-muted) 85%, var(--color-text));
		transition: width 80ms linear;
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
	/* Button is a child component — :global so compact height aligns with book-card star row */
	.ratings-drawer__item-actions :global(.btn.btn--compact) {
		box-sizing: border-box;
		min-height: var(--book-card-star-min, 2.25rem);
		height: var(--book-card-star-min, 2.25rem);
		padding-block: 0;
		padding-inline: var(--space-4);
	}
	@media (max-width: 479px) {
		.ratings-drawer__item-actions :global(.btn.btn--compact) {
			min-height: var(--book-card-star-min-sm, 1.75rem);
			height: var(--book-card-star-min-sm, 1.75rem);
		}
	}
	.ratings-drawer__header-sync :global(.btn.btn--compact) {
		box-sizing: border-box;
		flex-shrink: 0;
		min-height: 32px;
		height: 32px;
		padding-block: 0;
		padding-inline: var(--space-3);
	}
</style>
