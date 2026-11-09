<script lang="ts">
	import { untrack } from 'svelte';
	import BookSummarySheet from '$lib/components/book-card/BookSummarySheet.svelte';
	import type { BookSummarySheetState } from '$lib/components/book-card/bookSummarySheet';
	import { coverUrlForBookIdAtSize } from '$lib/book-cover';
	import { t } from '$lib/copy';
	import { resolveBooksByIdsInOrder } from '$lib/search';
	import { getSupabase } from '$lib/supabase';
	import { withTimeout } from '$lib/requests/timeout';
	import { ratingsStore } from '$lib/stores/ratings';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import {
		toggleBookmarked,
		toggleNotInterested,
		setBookRating,
		removeBookRating
	} from '$lib/stores/libraryActions';
	import type { Book } from '$lib/types/book';

	let {
		book,
		trigger,
		restoreFocus = true,
		detailsKnown = false,
		onResolved,
		onClose,
		onSearchAuthor
	}: {
		book: Book;
		trigger: HTMLElement;
		restoreFocus?: boolean;
		detailsKnown?: boolean;
		onResolved: (book: Book) => void;
		onClose: () => void;
		onSearchAuthor: (author: string) => void | Promise<void>;
	} = $props();
	let resolvedBook = $state<Book | null>(null);
	let status = $state<'loading' | 'ready' | 'error'>('ready');
	let attempt = $state(0);
	const displayedBook = $derived({
		...(resolvedBook ?? book),
		coverUrl:
			(resolvedBook ?? book).coverUrl ?? coverUrlForBookIdAtSize(book.book_id, 720) ?? undefined
	});
	// The panel, identity, cover and actions never wait for catalog transport.
	const summaryState = $derived<BookSummarySheetState>({
		kind: 'ready',
		book: displayedBook,
		trigger
	});

	$effect(() => {
		const selected = book;
		const known = detailsKnown;
		void attempt;
		const controller = new AbortController();
		untrack(() => {
			resolvedBook = null;
			if (known || selected.summary !== undefined) {
				status = 'ready';
				return;
			}
			status = 'loading';
			void withTimeout(
				async (signal) => {
					const supabase = getSupabase();
					if (!supabase) throw new Error('Book details are unavailable.');
					const [resolved] = await resolveBooksByIdsInOrder(supabase, [selected.book_id], signal);
					if (!resolved) throw new Error('This book is no longer available.');
					return resolved;
				},
				{ signal: controller.signal }
			)
				.then((resolved) => {
					if (controller.signal.aborted) return;
					resolvedBook = resolved;
					status = 'ready';
					onResolved(resolved);
				})
				.catch(() => {
					if (!controller.signal.aborted) status = 'error';
				});
		});
		return () => controller.abort();
	});
</script>

<BookSummarySheet
	state={summaryState}
	{restoreFocus}
	currentRating={$ratingsStore.get(displayedBook.id) ?? null}
	bookmarked={$planToReadStore.has(displayedBook.id)}
	notInterested={$notInterestedStore.has(displayedBook.book_id)}
	onBookmark={toggleBookmarked}
	onNotInterested={toggleNotInterested}
	onRate={setBookRating}
	onRemoveRating={removeBookRating}
	{onClose}
	{onSearchAuthor}
	summaryStatus={status !== 'ready' ? summaryStatus : undefined}
/>

{#snippet summaryStatus()}
	{#if status === 'loading'}
		<p class="book-card__summary" role="status" aria-live="polite" aria-busy="true">
			{t('shared.bookSummary.loading')}
		</p>
	{:else if status === 'error'}
		<div role="alert">
			<p class="book-card__summary">Could not load book details. Please try again.</p>
			<button
				type="button"
				class="btn btn--tertiary btn--compact"
				onclick={() => {
					attempt++;
				}}
			>
				{t('shared.bookSummary.retry')}
			</button>
		</div>
	{/if}
{/snippet}
