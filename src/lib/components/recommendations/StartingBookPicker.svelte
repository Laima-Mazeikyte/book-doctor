<script lang="ts">
	import { tick, untrack } from 'svelte';
	import SearchBar from '$lib/components/SearchBar.svelte';
	import { coverUrlForBookIdAtSize } from '$lib/book-cover';
	import { searchBooks } from '$lib/search';
	import { isStartingBookId } from '$lib/recommendations/filteredRecommendations';
	import { loadStartingBooks, type StartingBook } from '$lib/recommendations/startingBooks';

	let {
		bookId,
		resolvedBook = null,
		onChange,
		onResolve,
		onAvailabilityChange
	}: {
		bookId: string;
		resolvedBook?: StartingBook | null;
		onChange: (book: StartingBook | null) => void;
		onResolve: (book: StartingBook) => void;
		onAvailabilityChange: (bookId: string, available: boolean) => void;
	} = $props();
	let selected = $state<StartingBook | null>(null);
	let query = $state('');
	let suggestions = $state<StartingBook[]>([]);
	let loading = $state(false);
	let error = $state('');
	let retry = $state(0);
	let queryError = $state('');
	let searching = $state(false);
	let dismissedQuery = $state('');
	let activeIndex = $state(-1);
	let removeButton = $state<HTMLButtonElement>();
	const expanded = $derived(suggestions.length > 0 && query.trim() !== dismissedQuery);
	const activeDescendant = $derived(
		expanded && activeIndex >= 0 ? `starting-book-option-${activeIndex}` : undefined
	);
	$effect(() => {
		if (activeDescendant)
			document.getElementById(activeDescendant)?.scrollIntoView({ block: 'nearest' });
	});

	$effect(() => {
		const id = bookId;
		const supplied = resolvedBook?.book_id === id ? resolvedBook : null;
		void retry;
		selected = supplied ?? untrack(() => (selected?.book_id === id ? selected : null));
		error = '';
		loading = false;
		if (!id) return;
		if (untrack(() => selected !== null)) {
			onAvailabilityChange(id, true);
			return;
		}
		if (!isStartingBookId(id)) {
			error = 'This starting book is unavailable. Remove it and choose another.';
			return;
		}
		const controller = new AbortController();
		loading = true;
		void loadStartingBooks([id], controller.signal)
			.then((books) => {
				if (controller.signal.aborted) return;
				selected = books[0] ?? null;
				onAvailabilityChange(id, !!selected);
				if (selected) onResolve(selected);
				else error = 'This starting book is unavailable. Remove it and choose another.';
			})
			.catch(() => {
				if (!controller.signal.aborted) error = 'Could not load the starting book.';
			})
			.finally(() => {
				if (!controller.signal.aborted) loading = false;
			});
		return () => controller.abort();
	});

	$effect(() => {
		const value = query.trim();
		const hasBook = !!bookId;
		suggestions = [];
		activeIndex = -1;
		dismissedQuery = '';
		queryError = '';
		searching = false;
		if (hasBook || value.length < 3) return;
		let active = true;
		searching = true;
		const timer = setTimeout(() => {
			void searchBooks(value, 0, 6)
				.then((result) => {
					if (active) suggestions = result.books;
				})
				.catch(() => {
					if (active) queryError = 'Book search is unavailable. Try again.';
				})
				.finally(() => {
					if (active) searching = false;
				});
		}, 250);
		return () => {
			active = false;
			clearTimeout(timer);
		};
	});

	function choose(book: StartingBook) {
		selected = book;
		query = '';
		onResolve(book);
		onChange(book);
		void tick().then(() => removeButton?.focus({ preventScroll: true }));
	}

	function handleKeydown(event: KeyboardEvent) {
		if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.length) {
			event.preventDefault();
			dismissedQuery = '';
			activeIndex =
				event.key === 'ArrowDown'
					? (activeIndex + 1) % suggestions.length
					: activeIndex < 0
						? suggestions.length - 1
						: (activeIndex - 1 + suggestions.length) % suggestions.length;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const book = expanded ? suggestions[activeIndex < 0 ? 0 : activeIndex] : null;
			if (book) choose(book);
		} else if (
			event.key === 'Escape' &&
			(expanded || (searching && query.trim() !== dismissedQuery))
		) {
			event.preventDefault();
			event.stopPropagation();
			dismissedQuery = query.trim();
		}
	}
</script>

<div class="starting-book">
	<label class="recommendation-filter-label" for="starting-book-search"
		>Starting book <span>(optional)</span></label
	>
	{#if bookId}
		<div class="selected-book">
			{#if selected}
				<img
					src={coverUrlForBookIdAtSize(selected.book_id, 200)}
					alt=""
					width="40"
					height="60"
					decoding="async"
					onerror={(event) =>
						((event.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
				/>
				<span class="book-label"
					><strong>{selected.title}</strong><span>{selected.author}</span></span
				>
			{:else if loading}<span role="status">Loading starting book…</span>
			{:else}<span role="alert">{error}</span>{/if}
			<button bind:this={removeButton} type="button" class="remove" onclick={() => onChange(null)}
				>Remove</button
			>
		</div>
		{#if error === 'Could not load the starting book.'}<button
				type="button"
				class="retry"
				onclick={() => retry++}>Try again</button
			>{/if}
	{:else}
		<SearchBar
			id="starting-book-search"
			ariaLabel="Starting book (optional)"
			placeholder="Search by title or author"
			bind:value={query}
			listboxId="starting-book-suggestions"
			{expanded}
			{activeDescendant}
			onkeydown={handleKeydown}
		/>
		{#if searching && query.trim() !== dismissedQuery}<p role="status">Searching books…</p>
		{:else if queryError && query.trim() !== dismissedQuery}<p role="alert">{queryError}</p>
		{:else if expanded}
			<ul id="starting-book-suggestions" role="listbox" aria-label="Starting book suggestions">
				{#each suggestions as book, index (book.book_id)}
					<li role="presentation">
						<button
							type="button"
							role="option"
							id={`starting-book-option-${index}`}
							aria-selected={activeIndex === index}
							tabindex="-1"
							onclick={() => choose(book)}
							onkeydown={handleKeydown}
							><strong>{book.title}</strong><span>{book.author}</span></button
						>
					</li>
				{/each}
			</ul>
		{:else if query.trim().length >= 3 && query.trim() !== dismissedQuery}<p>
				No matching books.
			</p>{/if}
	{/if}
</div>

<style>
	.starting-book {
		display: grid;
		gap: var(--space-2);
		min-width: 0;
	}

	.book-label span,
	p,
	li span {
		color: var(--color-text-muted);
		font-weight: 400;
		font-size: var(--typ-caption-font-size);
	}
	li button {
		width: 100%;
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		min-height: var(--min-tap);
	}
	.selected-book {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	img {
		object-fit: cover;
		flex-shrink: 0;
		border-radius: var(--radius-sm);
	}
	.book-label {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	strong,
	.book-label span,
	li span {
		display: block;
	}
	.remove,
	.retry {
		background: none;
		border: 0;
		color: var(--color-text);
		cursor: pointer;
		text-decoration: underline;
		padding: var(--space-2);
		min-height: var(--min-tap);
	}
	.remove {
		margin-left: auto;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: var(--space-1);
	}
	li button {
		cursor: pointer;
		text-align: left;
	}
	button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	li button[aria-selected='true'] {
		background: var(--color-accent-bg);
		border-color: var(--color-focus);
	}
</style>
