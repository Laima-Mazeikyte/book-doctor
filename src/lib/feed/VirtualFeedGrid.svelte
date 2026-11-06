<script lang="ts">
	import { tick, untrack, onDestroy, type Snippet } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { virtualFeedRows } from './virtualFeedRows';
	import {
		coverPriorityFor,
		estimateGridColumns,
		type CoverPriority
	} from '$lib/components/book-card/coverPriority';
	import type { Book } from '$lib/types/book';

	let {
		books,
		ownerId,
		children,
		tail,
		pinnedBookUlid = null,
		element = $bindable<HTMLUListElement>(),
		onColumnsChange,
		onLayout,
		onAnchorChange
	}: {
		books: Book[];
		ownerId: string | null;
		children: Snippet<[Book, CoverPriority, boolean]>;
		tail?: Snippet;
		pinnedBookUlid?: string | null;
		element?: HTMLUListElement;
		onColumnsChange: (columns: number) => void;
		onLayout: () => void;
		onAnchorChange?: (top: number) => void;
	} = $props();

	let columns = $state(estimateGridColumns());
	let rowHeight = $state(350);
	let gap = $state(8);
	let viewportTop = $state(0);
	let viewportHeight = $state(typeof window === 'undefined' ? 900 : window.innerHeight);
	let focusedKey = $state<string | null>(null);
	let keyboardIndex = $state(-1);
	let focusFrame = 0;
	let restoreFrame = 0;
	let sheetAnchor: { ulid: string; offset: number; owner: string | null; resized: boolean } | null =
		null;
	let disposed = false;
	onDestroy(() => {
		disposed = true;
		cancelAnimationFrame(focusFrame);
		cancelAnimationFrame(restoreFrame);
	});
	const failedCovers = new SvelteSet<string>();
	$effect(() => {
		const ulid = pinnedBookUlid;
		untrack(() => {
			if (ulid) {
				const index = books.findIndex((book) => book.book_id === ulid);
				const cell = element?.querySelector(`[data-feed-index="${index}"]`);
				sheetAnchor = {
					ulid,
					owner: ownerId,
					offset: cell?.getBoundingClientRect().top ?? 0,
					resized: false
				};
			} else {
				const anchor = sheetAnchor;
				sheetAnchor = null;
				if (!anchor?.resized) return;
				// Shallow Back restores old pixel coordinates. After a reflow, return to the same book.
				void tick().then(() => {
					if (disposed) return;
					restoreFrame = requestAnimationFrame(() => {
						if (disposed || ownerId !== anchor.owner || !element) return;
						const index = books.findIndex((book) => book.book_id === anchor.ulid);
						if (index < 0) return;
						const top =
							window.scrollY +
							element.getBoundingClientRect().top +
							Math.floor(index / columns) * (rowHeight + gap) -
							anchor.offset;
						viewportTop = top - window.scrollY - element.getBoundingClientRect().top;
						window.scrollTo({ top, behavior: 'instant' });
						onAnchorChange?.(top);
					});
				});
			}
		});
	});
	$effect(() => {
		void ownerId;
		untrack(() => {
			focusedKey = null;
			keyboardIndex = -1;
			failedCovers.clear();
		});
	});
	const count = $derived(books.length + (tail ? 1 : 0));
	// Small initial batches retain their existing DOM and avoid unnecessary spacer work.
	const virtual = $derived(books.length > 100);
	$effect(() => {
		if (!virtual) return;
		// A footer outside the grid can otherwise anchor the viewport to the new list end.
		const style = document.documentElement.style;
		const previousAnchor = style.overflowAnchor;
		style.overflowAnchor = 'none';
		return () => {
			style.overflowAnchor = previousAnchor;
		};
	});
	const pinned = $derived([
		books.findIndex((book) => book.book_id === pinnedBookUlid),
		focusedKey === 'tail' ? books.length : books.findIndex((book) => book.book_id === focusedKey),
		keyboardIndex
	]);
	const cells = $derived(
		virtualFeedRows({
			count,
			columns,
			rowHeight,
			gap,
			top: viewportTop,
			viewportHeight,
			pinned,
			virtual
		})
	);
	const renderedIndices = $derived(
		cells
			.filter((cell) => cell.kind === 'item')
			.map((cell) => cell.index)
			.join(',')
	);
	$effect(() => {
		void renderedIndices;
		untrack(() => {
			void tick().then(() => {
				if (!disposed) onLayout();
			});
		});
	});
	const focusable =
		'button:not(:disabled):not([tabindex="-1"]), a[href]:not([tabindex="-1"]), input:not(:disabled), [tabindex="0"]';

	function focusChanged() {
		const cell = document.activeElement?.closest<HTMLElement>('[data-feed-index]');
		const index = cell && element?.contains(cell) ? Number(cell.dataset.feedIndex) : -1;
		focusedKey = index === books.length ? 'tail' : (books[index]?.book_id ?? null);
	}

	function focusLeft() {
		cancelAnimationFrame(focusFrame);
		// Native Tab may move focus after a microtask; retain its source row until it finishes.
		focusFrame = requestAnimationFrame(focusChanged);
	}

	async function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
		const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-feed-index]');
		if (!cell) return;
		const controls = [...cell.querySelectorAll<HTMLElement>(focusable)];
		if (event.target !== controls[event.shiftKey ? 0 : controls.length - 1]) return;
		const next = Number(cell.dataset.feedIndex) + (event.shiftKey ? -1 : 1);
		if (next < 0 || next >= count || element?.querySelector(`[data-feed-index="${next}"]`)) return;
		event.preventDefault();
		keyboardIndex = next;
		await tick();
		const targets = element
			?.querySelector(`[data-feed-index="${next}"]`)
			?.querySelectorAll<HTMLElement>(focusable);
		targets?.[event.shiftKey ? targets.length - 1 : 0]?.focus();
		keyboardIndex = -1;
	}

	function observeGrid(node: HTMLUListElement, initialCount: number) {
		let lastCount = initialCount;
		let frame = 0;
		let disposed = false;
		let previous: { columns: number; height: number; gap: number; listTop: number } | undefined;
		function measure() {
			frame = 0;
			if (disposed) return;
			const style = getComputedStyle(node);
			const nextColumns = style.gridTemplateColumns.split(/\s+/).filter(Boolean).length || columns;
			const nextGap = parseFloat(style.rowGap) || 0;
			const sample = node.querySelector<HTMLElement>('[data-feed-book]');
			const nextHeight = sample?.getBoundingClientRect().height || rowHeight;
			const listTop = node.getBoundingClientRect().top + window.scrollY;
			let top = window.scrollY;
			let adjusted = false;
			if (
				previous &&
				virtual &&
				top >= previous.listTop &&
				(nextColumns !== previous.columns || Math.abs(nextHeight - previous.height) > 0.5)
			) {
				const oldRow = Math.floor((top - previous.listTop) / (previous.height + previous.gap));
				const anchor = Math.min(books.length - 1, oldRow * previous.columns);
				const offset = top - previous.listTop - oldRow * (previous.height + previous.gap);
				top = listTop + Math.floor(anchor / nextColumns) * (nextHeight + nextGap) + offset;
				adjusted = true;
				if (sheetAnchor) sheetAnchor.resized = true;
			}
			previous = { columns: nextColumns, height: nextHeight, gap: nextGap, listTop };
			columns = nextColumns;
			rowHeight = nextHeight;
			gap = nextGap;
			viewportTop = top - listTop;
			viewportHeight = window.innerHeight;
			onColumnsChange(columns);
			void tick().then(() => {
				if (disposed) return;
				if (adjusted) {
					window.scrollTo({ top, behavior: 'instant' });
					onAnchorChange?.(top);
				}
			});
		}
		function schedule() {
			if (!frame) frame = requestAnimationFrame(measure);
		}
		function imageFailed(event: Event) {
			if (!(event.target instanceof HTMLImageElement)) return;
			const cell = event.target.closest<HTMLElement>('[data-feed-index]');
			const url = cell ? books[Number(cell.dataset.feedIndex)]?.coverUrl : undefined;
			if (url) failedCovers.add(url);
			if (failedCovers.size > 200) failedCovers.delete([...failedCovers][0]);
		}
		const observer = new ResizeObserver(schedule);
		observer.observe(node);
		window.addEventListener('scroll', schedule, { passive: true });
		window.addEventListener('resize', schedule);
		window.visualViewport?.addEventListener('resize', schedule);
		node.addEventListener('error', imageFailed, true);
		measure();
		return {
			update(nextCount: number) {
				if (nextCount !== lastCount) {
					lastCount = nextCount;
					schedule();
				}
			},
			destroy() {
				disposed = true;
				cancelAnimationFrame(frame);
				observer.disconnect();
				window.removeEventListener('scroll', schedule);
				window.removeEventListener('resize', schedule);
				window.visualViewport?.removeEventListener('resize', schedule);
				node.removeEventListener('error', imageFailed, true);
			}
		};
	}
</script>

<!-- Delegate Tab at a virtual row boundary to the next logical card. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<ul
	bind:this={element}
	class="rate-page__list book-card-grid virtual-feed"
	use:observeGrid={count}
	onfocusin={focusChanged}
	onfocusout={focusLeft}
	onkeydown={handleKeydown}
>
	{#each cells as cell (cell.kind === 'spacer' ? `spacer:${cell.row}` : cell.index === books.length ? 'tail' : `book:${books[cell.index].book_id}`)}
		{#if cell.kind === 'spacer'}
			<li
				class="virtual-feed__spacer"
				style:height={`${cell.height}px`}
				role="presentation"
				aria-hidden="true"
			></li>
		{:else}
			<li
				data-feed-index={cell.index}
				data-feed-book={cell.index < books.length ? '' : undefined}
				aria-posinset={cell.index + 1}
				aria-setsize={count}
				class:virtual-feed__tail={cell.index === books.length}
				style:height={cell.index === books.length && virtual ? `${rowHeight}px` : undefined}
			>
				{#if cell.index < books.length}
					{@const book = books[cell.index]}
					{@const rowTop = Math.floor(cell.index / columns) * (rowHeight + gap)}
					{@const inViewport =
						rowTop + rowHeight > viewportTop && rowTop < viewportTop + viewportHeight}
					{@render children(
						book,
						cell.index < columns * 2
							? coverPriorityFor(cell.index, columns)
							: inViewport
								? 'eager'
								: 'lazy',
						failedCovers.has(book.coverUrl ?? '')
					)}
				{:else if tail}
					{@render tail()}
				{/if}
			</li>
		{/if}
	{/each}
</ul>

<style>
	.virtual-feed__spacer {
		grid-column: 1 / -1;
		pointer-events: none;
	}
	.virtual-feed__tail {
		display: flex;
	}
</style>
