<script lang="ts">
	import type { DimensionMatch } from '$lib/recommendations/dimensionMatches';
	import { onDestroy, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { fly } from 'svelte/transition';
	import { X } from 'lucide-svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import { t } from '$lib/copy';
	import type { Book, RatingValue } from '$lib/types/book';
	import BookSummarySheetBody from './BookSummarySheetBody.svelte';
	import { getBookDisplaySummary } from './summaryStub';
	import {
		bookSummaryIdentity,
		type BookSummarySheetCloseOptions,
		type BookSummarySheetState
	} from './bookSummarySheet';

	interface Props {
		state: BookSummarySheetState;
		dimensionMatches?: DimensionMatch[];
		/** Restore focus to the triggering cover or feed button after closing. */
		restoreFocus?: boolean;
		currentRating?: RatingValue | null;
		bookmarked?: boolean;
		notInterested?: boolean;
		onBookmark?: (book: Book) => void;
		onRate?: (book: Book, value: RatingValue) => void;
		onRemoveRating?: (book: Book) => void;
		onNotInterested?: (book: Book) => void;
		onAfterRate?: (book: Book) => void;
		onSearchAuthor?: (author: string) => void | Promise<void>;
		onClose: (options?: BookSummarySheetCloseOptions) => void | Promise<void>;
		onRetry?: () => void | Promise<void>;
		ratingContext?: 'rate' | 'recommendation';
		/** Hide the rating controls when the sheet is opened for a read-only related book. */
		showRatingStars?: boolean;
		/** Rate cards reserve the remove-rating slot before a rating exists. */
		reserveSummaryRemoveLayoutSlot?: boolean;
	}

	let {
		state: sheetState,
		dimensionMatches = [],
		restoreFocus = true,
		currentRating = null,
		bookmarked = false,
		notInterested = false,
		onBookmark,
		onRate,
		onRemoveRating,
		onNotInterested,
		onAfterRate,
		onSearchAuthor,
		onClose,
		onRetry,
		ratingContext = 'recommendation',
		showRatingStars = true,
		reserveSummaryRemoveLayoutSlot = false
	}: Props = $props();

	let coverImageFailed = $state(false);
	let hoverRating = $state(0);

	const visible = $derived(sheetState.kind !== 'closed');
	const readyBook = $derived(sheetState.kind === 'ready' ? sheetState.book : null);
	const identity = $derived.by(() => {
		if (sheetState.kind === 'ready') return bookSummaryIdentity(sheetState.book);
		if (sheetState.kind === 'loading' || sheetState.kind === 'error') return sheetState.identity;
		return null;
	});
	const trigger = $derived(sheetState.kind === 'closed' ? null : sheetState.trigger);
	const sheetKey = $derived(identity?.bookUlid ?? 'closed');
	const summaryPanelId = $derived(`book-summary-panel-${sheetKey}`);
	const summaryTitleId = $derived(`book-summary-title-${sheetKey}`);
	const statusTitleId = $derived(`book-summary-status-title-${sheetKey}`);
	const displaySummary = $derived(readyBook ? getBookDisplaySummary(readyBook) : '');
	const showCoverImage = $derived(Boolean(readyBook?.coverUrl) && !coverImageFailed);
	const showAuthorInSheetMeta = $derived(Boolean(readyBook?.author?.trim()));
	const displayRating = $derived(hoverRating > 0 ? hoverRating : (currentRating ?? 0));
	const ratingGroupAriaLabel = $derived(
		ratingContext === 'rate'
			? t('shared.bookCard.rateThisBook')
			: t('shared.recommendationCard.rateThisBook')
	);

	let closeButtonEl: HTMLButtonElement | null = $state(null);
	let summaryDialogPanelEl: HTMLElement | null = $state(null);
	let summaryContentEl: HTMLElement | undefined = $state(undefined);
	let flySlideX = $state(0);
	let flySlideY = $state(0);
	let summarySheetDragY = $state(0);
	let summarySheetDragging = $state(false);
	let summarySheetSkipFlyOut = $state(false);
	let wasVisible = false;
	let lastSheetKey: string | null = null;
	let lastFocusTarget: HTMLElement | null = null;

	type SummarySheetDragTrack = {
		pointerId: number;
		startY: number;
		startX: number;
		lastY: number;
		lastT: number;
	};
	let summarySheetDragTrack: SummarySheetDragTrack | null = null;

	const SUMMARY_DRAWER_DESKTOP_PX = 400;
	const SUMMARY_SHEET_SLIDE_MAX_PX = 900;
	const SUMMARY_SHEET_DISMISS_DRAG_PX = 100;
	const SUMMARY_SHEET_DISMISS_VELOCITY = 0.35;
	const SUMMARY_SHEET_DRAG_AXIS_LOCK_PX = 12;
	const FOCUSABLE_SELECTOR =
		'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

	function portal(node: HTMLElement): { destroy: () => void } {
		if (typeof document === 'undefined') return { destroy: () => undefined };
		document.body.appendChild(node);
		return {
			destroy() {
				node.parentNode?.removeChild(node);
			}
		};
	}

	function setSummaryFlyDistance(): void {
		if (typeof window === 'undefined') {
			flySlideX = -SUMMARY_DRAWER_DESKTOP_PX;
			flySlideY = 0;
			return;
		}
		if (window.matchMedia('(min-width: 768px)').matches) {
			flySlideX = -SUMMARY_DRAWER_DESKTOP_PX;
			flySlideY = 0;
		} else {
			flySlideX = 0;
			flySlideY = Math.min(window.innerHeight, SUMMARY_SHEET_SLIDE_MAX_PX);
		}
	}

	function summarySheetIsMobileViewport(): boolean {
		return browser && !window.matchMedia('(min-width: 768px)').matches;
	}

	function summarySheetDetachDragListeners(): void {
		if (typeof window === 'undefined') return;
		window.removeEventListener('pointermove', onSummarySheetDragMove);
		window.removeEventListener('pointerup', onSummarySheetDragEnd);
		window.removeEventListener('pointercancel', onSummarySheetDragEnd);
	}

	function handleSummarySheetPointerDown(event: PointerEvent): void {
		if (!summarySheetIsMobileViewport()) return;
		const content = summaryContentEl;
		if (!content || content.scrollTop > 0) return;
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		if (target.closest('button, a[href], input, textarea, select, label')) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;

		summarySheetDragTrack = {
			pointerId: event.pointerId,
			startY: event.clientY,
			startX: event.clientX,
			lastY: event.clientY,
			lastT: event.timeStamp
		};
		window.addEventListener('pointermove', onSummarySheetDragMove);
		window.addEventListener('pointerup', onSummarySheetDragEnd);
		window.addEventListener('pointercancel', onSummarySheetDragEnd);
	}

	function onSummarySheetDragMove(event: PointerEvent): void {
		const track = summarySheetDragTrack;
		if (!track || event.pointerId !== track.pointerId) return;
		const dy = event.clientY - track.startY;
		const dx = event.clientX - track.startX;
		if (!summarySheetDragging) {
			if (dy <= SUMMARY_SHEET_DRAG_AXIS_LOCK_PX || Math.abs(dx) > dy) return;
			summarySheetDragging = true;
			summaryContentEl?.setPointerCapture(event.pointerId);
		}
		// Suppress the browser's native selection/scroll gesture once the vertical drag wins
		// the axis lock. This also keeps mouse-driven browser tests deterministic.
		event.preventDefault();
		summarySheetDragY = Math.max(0, dy);
		track.lastY = event.clientY;
		track.lastT = event.timeStamp;
	}

	function onSummarySheetDragEnd(event: PointerEvent): void {
		const track = summarySheetDragTrack;
		if (!track || event.pointerId !== track.pointerId) return;
		summarySheetDetachDragListeners();
		try {
			summaryContentEl?.releasePointerCapture(event.pointerId);
		} catch {
			// The pointer may have been cancelled before capture was established.
		}
		const wasDragging = summarySheetDragging;
		summarySheetDragTrack = null;
		if (!wasDragging) return;
		summarySheetDragging = false;
		const velocity = (event.clientY - track.lastY) / Math.max(1, event.timeStamp - track.lastT);
		const passed =
			summarySheetDragY > SUMMARY_SHEET_DISMISS_DRAG_PX ||
			velocity > SUMMARY_SHEET_DISMISS_VELOCITY;
		if (passed) void completeSummarySheetDragDismiss();
		else summarySheetDragY = 0;
	}

	async function completeSummarySheetDragDismiss(): Promise<void> {
		const panel = summaryDialogPanelEl;
		const start = summarySheetDragY;
		summarySheetDragY = 0;
		if (!browser || !panel || !summarySheetIsMobileViewport()) {
			requestClose({ skipFlyOut: true });
			return;
		}
		if (start <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			requestClose({ skipFlyOut: true });
			return;
		}
		try {
			await panel.animate(
				[
					{ transform: `translateY(${start}px)` },
					{ transform: `translateY(${window.innerHeight}px)` }
				],
				{
					duration: 220,
					easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
					fill: 'forwards'
				}
			).finished;
		} catch {
			// The panel was closed while the animation was running.
		}
		requestClose({ skipFlyOut: true });
	}

	function requestClose(options?: BookSummarySheetCloseOptions): void {
		if (options?.skipFlyOut) summarySheetSkipFlyOut = true;
		void onClose(options);
	}

	function handleOverlayClick(event: MouseEvent): void {
		if (event.target === event.currentTarget) requestClose();
	}

	function handleOverlayKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			requestClose();
			return;
		}
		if (event.key !== 'Tab' || !summaryDialogPanelEl) return;
		const focusable = Array.from(
			summaryDialogPanelEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
		);
		if (focusable.length === 0) {
			event.preventDefault();
			summaryDialogPanelEl.focus({ preventScroll: true });
			return;
		}
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const active = document.activeElement;
		if (event.shiftKey && active === first) {
			event.preventDefault();
			last.focus({ preventScroll: true });
		} else if (!event.shiftKey && active === last) {
			event.preventDefault();
			first.focus({ preventScroll: true });
		}
	}

	function handleBookmarkClick(event: MouseEvent): void {
		event.stopPropagation();
		if (readyBook) onBookmark?.(readyBook);
	}

	function handleNotInterestedClick(event: MouseEvent): void {
		event.stopPropagation();
		if (readyBook) onNotInterested?.(readyBook);
	}

	async function handleAuthorPillClick(event: MouseEvent): Promise<void> {
		event.preventDefault();
		event.stopPropagation();
		if (readyBook && onSearchAuthor) await onSearchAuthor(readyBook.author);
	}

	function handleSheetRemoveRating(event: MouseEvent): void {
		event.stopPropagation();
		hoverRating = 0;
		if (readyBook) {
			onRemoveRating?.(readyBook);
			onAfterRate?.(readyBook);
		}
	}

	function handleStarMouseEnter(value: RatingValue): void {
		if (
			typeof window !== 'undefined' &&
			window.matchMedia('(hover: hover) and (pointer: fine)').matches
		)
			hoverRating = value;
	}

	function handleStarClick(value: RatingValue): void {
		hoverRating = 0;
		if (!readyBook) return;
		if (currentRating === value) onRemoveRating?.(readyBook);
		else onRate?.(readyBook, value);
		onAfterRate?.(readyBook);
	}

	function starAriaLabel(value: RatingValue): string {
		return currentRating === value
			? t(
					ratingContext === 'rate'
						? 'shared.bookCard.rateOutOf5Clear'
						: 'shared.recommendationCard.rateOutOf5Clear',
					{ value }
				)
			: t(
					ratingContext === 'rate'
						? 'shared.bookCard.rateOutOf5'
						: 'shared.recommendationCard.rateOutOf5',
					{ value }
				);
	}

	function starAriaPressed(value: RatingValue): boolean {
		return currentRating === value;
	}

	let lastVisibleBookUlid: string | null = null;
	$effect(() => {
		const bookUlid = readyBook?.book_id ?? null;
		if (bookUlid === lastVisibleBookUlid) return;
		lastVisibleBookUlid = bookUlid;
		coverImageFailed = false;
		hoverRating = 0;
	});

	$effect(() => {
		if (visible) {
			if (!wasVisible || lastSheetKey !== sheetKey) {
				setSummaryFlyDistance();
				lastFocusTarget = trigger;
				void tick().then(() => {
					if (visible) closeButtonEl?.focus({ preventScroll: true });
				});
			}
			wasVisible = true;
			lastSheetKey = sheetKey;
			return;
		}
		if (wasVisible) {
			const focusTarget = lastFocusTarget;
			wasVisible = false;
			lastSheetKey = null;
			lastFocusTarget = null;
			if (restoreFocus) void tick().then(() => focusTarget?.focus({ preventScroll: true }));
		}
	});

	$effect(() => {
		if (visible) return;
		summarySheetDetachDragListeners();
		summarySheetDragTrack = null;
		summarySheetDragging = false;
		summarySheetDragY = 0;
		if (summarySheetSkipFlyOut) void tick().then(() => (summarySheetSkipFlyOut = false));
	});

	$effect(() => {
		if (!visible || typeof document === 'undefined') return;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previousOverflow;
		};
	});

	onDestroy(() => {
		summarySheetDetachDragListeners();
		if (wasVisible && restoreFocus) lastFocusTarget?.focus({ preventScroll: true });
	});
</script>

{#if visible}
	<div
		use:portal
		class="book-card__summary-dialog-overlay"
		data-testid="book-summary-sheet"
		data-book-ulid={identity?.bookUlid}
		role="dialog"
		aria-modal="true"
		aria-labelledby={sheetState.kind === 'ready' ? summaryTitleId : statusTitleId}
		tabindex="-1"
		onclick={handleOverlayClick}
		onkeydown={handleOverlayKeydown}
	>
		<div
			bind:this={summaryDialogPanelEl}
			id={summaryPanelId}
			class="book-card__summary-dialog-panel"
			class:book-card__summary-dialog-panel--dragging={summarySheetDragging}
			style:transform={summarySheetDragY > 0 ? `translateY(${summarySheetDragY}px)` : undefined}
			tabindex="-1"
			in:fly={{ x: flySlideX, y: flySlideY, duration: 200 }}
			out:fly={summarySheetSkipFlyOut
				? { duration: 0, x: 0, y: 0 }
				: { x: flySlideX, y: flySlideY, duration: 150 }}
		>
			<button
				bind:this={closeButtonEl}
				type="button"
				class="book-card__summary-close"
				aria-label={t('shared.recommendationCard.closeSummary')}
				onclick={() => requestClose()}
			>
				<X size={18} aria-hidden="true" />
			</button>

			{#if sheetState.kind === 'ready'}
				<BookSummarySheetBody
					{dimensionMatches}
					bind:summaryContentEl
					onSummaryPointerDown={handleSummarySheetPointerDown}
					book={sheetState.book}
					{summaryTitleId}
					{displaySummary}
					{showCoverImage}
					onCoverImageError={() => (coverImageFailed = true)}
					{showAuthorInSheetMeta}
					showSearchAuthorInOverlay={Boolean(sheetState.book.author?.trim())}
					onAuthorPillClick={onSearchAuthor ? handleAuthorPillClick : undefined}
					{notInterested}
					{showRatingStars}
					{ratingGroupAriaLabel}
					{displayRating}
					{starAriaLabel}
					{starAriaPressed}
					onStarMouseEnter={handleStarMouseEnter}
					onStarClick={handleStarClick}
					onRatingGroupMouseLeave={() => (hoverRating = 0)}
					canRemoveRatingInSheet={currentRating != null && onRemoveRating != null}
					{reserveSummaryRemoveLayoutSlot}
					onRemoveRatingClick={handleSheetRemoveRating}
					showBookmarkAction={Boolean(onBookmark)}
					showNotInterestedAction={Boolean(onNotInterested)}
					{bookmarked}
					onBookmarkClick={handleBookmarkClick}
					onNotInterestedClick={handleNotInterestedClick}
				/>
			{:else if sheetState.kind === 'loading'}
				<div class="book-summary-sheet__status" role="status" aria-live="polite" aria-busy="true">
					<h2 id={statusTitleId}>{sheetState.identity.title}</h2>
					<Spinner />
					<p>{t('shared.bookSummary.loading')}</p>
				</div>
			{:else if sheetState.kind === 'error'}
				<div class="book-summary-sheet__status" role="alert">
					<h2 id={statusTitleId}>{sheetState.identity.title}</h2>
					<p>{sheetState.message}</p>
					<div class="book-summary-sheet__status-actions">
						{#if onRetry}
							<button type="button" class="btn btn--primary" onclick={() => void onRetry()}
								>{t('shared.bookSummary.retry')}</button
							>
						{/if}
						<button type="button" class="btn btn--tertiary" onclick={() => requestClose()}>
							{t('shared.recommendationCard.closeSummary')}
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.book-card__summary-dialog-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: transparent;
	}
	.book-card__summary-dialog-panel {
		position: absolute;
		inset: 0;
		z-index: 1;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-height: 100dvh;
		max-width: none;
		max-height: none;
		background: var(--color-card-bg);
		box-shadow: none;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: 0;
		padding-bottom: env(safe-area-inset-bottom, 0px);
		transition: transform 0.28s cubic-bezier(0.32, 0.72, 0, 1);
	}
	.book-card__summary-dialog-panel--dragging {
		transition: none;
	}
	@media (min-width: 768px) {
		.book-card__summary-dialog-overlay {
			display: flex;
			align-items: stretch;
			justify-content: flex-start;
			background: var(--color-overlay-scrim-soft);
		}
		.book-card__summary-dialog-panel {
			position: relative;
			inset: auto;
			width: min(400px, 85vw);
			min-width: 320px;
			max-width: 400px;
			height: auto;
			align-self: stretch;
			min-height: 0;
			max-height: none;
			box-shadow: var(--shadow-drawer);
			padding-bottom: 0;
			transition: none;
		}
	}
	.book-card__summary-close {
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
		background: transparent;
		border-radius: var(--radius-pill);
		cursor: pointer;
		color: var(--color-text);
		transition: background var(--duration-fast) var(--ease-default);
	}
	.book-card__summary-close:hover {
		background: var(--color-floating-control-bg-hover);
	}
	.book-card__summary-close:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.book-summary-sheet__status {
		display: flex;
		flex: 1;
		min-height: 0;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-4);
		padding: var(--space-8);
		text-align: center;
	}
	.book-summary-sheet__status h2 {
		max-width: 28rem;
		margin: 0;
		color: var(--color-book-title);
		font: var(--typ-h3-font);
	}
	.book-summary-sheet__status p {
		max-width: 28rem;
		margin: 0;
		color: var(--color-text-muted);
	}
	.book-summary-sheet__status-actions {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
</style>
