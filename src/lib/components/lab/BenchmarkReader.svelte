<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { get } from 'svelte/store';
	import { browser } from '$app/environment';
	import { goto, pushState, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { t } from '$lib/copy';
	import BookSummarySheet from '$lib/components/book-card/BookSummarySheet.svelte';
	import type {
		BookSummaryIdentity,
		BookSummarySheetCloseOptions,
		BookSummarySheetState
	} from '$lib/components/book-card/bookSummarySheet';
	import BenchmarkCover from '$lib/components/lab/BenchmarkCover.svelte';
	import { createAuthorProminenceCatalogLoader } from '$lib/lab/author-prominence/catalog-loader';
	import { formatRating } from '$lib/lab/recommendation-benchmark/format';
	import type { Reader, ReaderHistory, SystemId } from '$lib/lab/recommendation-benchmark/types';
	import {
		markRateAuthorSearch,
		markRateSearchOpenedFromOtherRoute
	} from '$lib/rateSearchExternalNav';
	import {
		bookSummarySheetHistory,
		clearBookSummarySheetHistory,
		consumeBookSummaryHistoryEntry,
		createBookSummarySheetOwnerId,
		ownsBookSummarySheet
	} from '$lib/stores/bookSummarySheetHistory';
	import {
		removeBookRating,
		setBookRating,
		toggleBookmarked,
		toggleNotInterested
	} from '$lib/stores/libraryActions';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { ratingsStore } from '$lib/stores/ratings';
	import type { Book, RatingValue } from '$lib/types/book';

	interface Props {
		/** The showcase readers, in the order the explorer steps through them. */
		readers: Reader[];
		loadHistory: (readerId: string) => Promise<ReaderHistory>;
	}

	let { readers, loadHistory }: Props = $props();

	const COPY = 'lab.recommendationBenchmark.';
	/** Same order as the charts above: Unread, then ChatGPT, then Hardcover. */
	const ORDER: readonly SystemId[] = ['ours', 'chatgpt', 'hardcover'];
	const PICKS_PER_ROW = 5;
	const CLUES_PER_ROW = 6;
	/** Position of the reader on show in the showcase. */
	let position = $state(0);
	let revealed = $state(false);
	let historyOpen = $state(false);
	let history = $state.raw<ReaderHistory | null>(null);
	let historyError = $state(false);
	let historyRequest = 0;
	/** The list shown on narrow screens, where the three lists become a switcher. */
	let activeList = $state<SystemId>('ours');
	/** The cover whose title card is open: on mouse hover, keyboard focus, or a tap. */
	let activePick = $state<string | null>(null);

	function found(candidate: Reader, system: SystemId): boolean {
		return candidate.hit_rank[system] != null;
	}

	const reader = $derived(readers[position]);
	const sortedHistory = $derived(
		history ? [...history.rows].sort((a, b) => b[3] - a[3] || a[1].localeCompare(b[1])) : []
	);

	function systemName(system: SystemId): string {
		return t(COPY + 'systems.' + system);
	}

	function step(delta: number): void {
		position = (position + delta + readers.length) % readers.length;
	}

	function result(system: SystemId): string {
		const rank = reader.hit_rank[system];
		return rank == null ? t(COPY + 'readers.missed') : t(COPY + 'readers.foundAt', { rank });
	}

	/** Title cards open toward the inside at the ends of a row, so they never leave the card. */
	function align(index: number, perRow: number): 'start' | 'center' | 'end' {
		const column = index % perRow;
		return column === 0 ? 'start' : column === perRow - 1 ? 'end' : 'center';
	}

	/*
	 * Book details: the same summary sheet the feed opens from a cover, with the same shallow
	 * history entry, so Back closes it. The benchmark only carries ids, titles and authors, so
	 * the full book is fetched from the catalog when a cover is opened (and cached after that).
	 */
	const sheetOwnerId = createBookSummarySheetOwnerId();
	const catalog = createAuthorProminenceCatalogLoader();
	let sheetState = $state<BookSummarySheetState>({ kind: 'closed' });
	let sheetRestoreFocus = $state(true);
	let sheetRequest = 0;
	const sheetBook = $derived(sheetState.kind === 'ready' ? sheetState.book : null);
	const sheetRating = $derived(sheetBook ? ($ratingsStore.get(sheetBook.id) ?? null) : null);
	const sheetBookmarked = $derived(sheetBook ? $planToReadStore.has(sheetBook.id) : false);
	const sheetNotInterested = $derived(
		sheetBook ? $notInterestedStore.has(sheetBook.book_id) : false
	);

	function currentPageUrl(): string {
		if (browser) return `${window.location.pathname}${window.location.search}`;
		const current = get(page).url;
		return `${current.pathname}${current.search}`;
	}

	function loadSheetBook(
		identity: BookSummaryIdentity,
		trigger: HTMLElement,
		request: number
	): void {
		const current = () =>
			request === sheetRequest &&
			sheetState.kind === 'loading' &&
			sheetState.identity.bookUlid === identity.bookUlid;
		void catalog
			.load(identity.bookUlid)
			.then((book) => {
				if (current()) sheetState = { kind: 'ready', book, trigger };
			})
			.catch(() => {
				if (current()) {
					sheetState = {
						kind: 'error',
						identity,
						message: t('shared.bookSummary.unavailable'),
						trigger
					};
				}
			});
	}

	function openBook(id: string, title: string, trigger: HTMLElement): void {
		if (!browser || sheetState.kind !== 'closed') return;
		activePick = null;
		sheetRestoreFocus = true;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- retain the current route and query for a shallow sheet entry
		pushState(currentPageUrl(), {
			...(get(page).state as App.PageState),
			bookSummarySheet: { ownerId: sheetOwnerId, bookUlid: id }
		});
		bookSummarySheetHistory.set({
			ownerId: sheetOwnerId,
			bookUlid: id,
			applyClose: () => {
				void closeSheet({ skipFlyOut: true, fromHistoryApply: true });
			}
		});
		const identity = { bookUlid: id, title };
		const request = ++sheetRequest;
		sheetState = { kind: 'loading', identity, trigger };
		loadSheetBook(identity, trigger, request);
	}

	function retrySheet(): void {
		if (sheetState.kind !== 'error') return;
		const { identity, trigger } = sheetState;
		const request = ++sheetRequest;
		sheetState = { kind: 'loading', identity, trigger };
		loadSheetBook(identity, trigger, request);
	}

	async function closeSheet(options?: BookSummarySheetCloseOptions): Promise<void> {
		if (sheetState.kind === 'closed') return;
		const marker = browser ? (get(page).state as App.PageState).bookSummarySheet : undefined;
		const ownsHistoryMarker = ownsBookSummarySheet(marker, sheetOwnerId);
		const ownsHistoryEntry =
			ownsHistoryMarker && ownsBookSummarySheet(get(bookSummarySheetHistory), sheetOwnerId);
		sheetRequest += 1;
		sheetState = { kind: 'closed' };

		if (options?.fromHistoryApply || !ownsHistoryEntry) {
			if (!options?.fromHistoryApply && ownsHistoryMarker && !ownsHistoryEntry) {
				stripSheetMarker();
			}
			clearBookSummarySheetHistory(sheetOwnerId);
		} else if (browser) {
			// The shallow sheet entry is consumed by Back; its popstate handler closes the sheet without navigating again.
			await consumeBookSummaryHistoryEntry(sheetOwnerId);
		}
	}

	function stripSheetMarker(): void {
		if (!browser) return;
		const currentState = get(page).state as App.PageState;
		if (!ownsBookSummarySheet(currentState.bookSummarySheet, sheetOwnerId)) return;
		const nextState = { ...currentState };
		delete nextState.bookSummarySheet;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- remove this explorer's marker during teardown
		replaceState(currentPageUrl(), nextState);
	}

	function handleBrowserPopstate(): void {
		if (sheetState.kind === 'closed' || !browser) return;
		const marker = (get(page).state as App.PageState).bookSummarySheet;
		if (!ownsBookSummarySheet(marker, sheetOwnerId)) {
			void closeSheet({ skipFlyOut: true, fromHistoryApply: true });
		}
	}

	$effect(() => {
		if (sheetState.kind === 'closed' || !browser) return;
		window.addEventListener('popstate', handleBrowserPopstate);
		return () => window.removeEventListener('popstate', handleBrowserPopstate);
	});

	/** As on the feed: the author pill closes the sheet and searches that author on /rate. */
	async function searchAuthor(author: string): Promise<void> {
		sheetRestoreFocus = false;
		try {
			await closeSheet();
			await tick();
			markRateSearchOpenedFromOtherRoute();
			markRateAuthorSearch(author.trim());
			await goto(resolve(`/rate?q=${encodeURIComponent(author.trim())}`));
		} finally {
			sheetRestoreFocus = true;
		}
	}

	onDestroy(() => {
		stripSheetMarker();
		clearBookSummarySheetHistory(sheetOwnerId);
		catalog.destroy();
	});

	// A new reader starts with the favorite hidden again, the history closed and no card open.
	$effect(() => {
		void reader.id;
		revealed = false;
		historyOpen = false;
		activePick = null;
	});

	$effect(() => {
		const id = reader.id;
		if (!historyOpen) return;
		const request = ++historyRequest;
		if (untrack(() => history?.id) === id) return;
		history = null;
		historyError = false;
		loadHistory(id)
			.then((loaded) => {
				if (request === historyRequest) history = loaded;
			})
			.catch(() => {
				if (request === historyRequest) historyError = true;
			});
	});
</script>

{#snippet pick(
	key: string,
	book: { id: string | null; title: string; author: string },
	meta: string,
	side: 'start' | 'center' | 'end',
	rank: number | null,
	hit: boolean
)}
	<span
		class="benchmark-pick"
		class:benchmark-pick--hit={hit}
		class:benchmark-pick--dim={revealed && rank != null && !hit}
		class:benchmark-pick--active={activePick === key}
	>
		<button
			type="button"
			class="benchmark-pick__button"
			aria-label={t(COPY + 'readers.pickLabel', { title: book.title, author: book.author }) +
				', ' +
				meta +
				(hit ? ', ' + t(COPY + 'readers.theFavorite') : '')}
			aria-haspopup={book.id ? 'dialog' : undefined}
			onpointerenter={(event) => {
				if (event.pointerType === 'mouse') activePick = key;
			}}
			onpointerleave={(event) => {
				if (event.pointerType === 'mouse' && activePick === key) activePick = null;
			}}
			onfocus={(event) => {
				// Keyboard focus only: focus returning from a closed sheet after a click shows no card.
				if (event.currentTarget.matches(':focus-visible')) activePick = key;
			}}
			onblur={() => {
				if (activePick === key) activePick = null;
			}}
			onclick={(event) => {
				// A book the catalog doesn't carry has no details to open; its title card shows instead.
				if (book.id) openBook(book.id, book.title, event.currentTarget);
				else activePick = key;
			}}
		>
			<BenchmarkCover bookId={book.id} title={book.title} />
			{#if rank != null}<span class="benchmark-pick__rank" aria-hidden="true">{rank}</span>{/if}
		</button>
		<span class={'benchmark-pick__tip benchmark-pick__tip--' + side} aria-hidden="true">
			<strong>{book.title}</strong>
			<span>{book.author}</span>
			<span class="benchmark-pick__meta">{meta}</span>
		</span>
	</span>
{/snippet}

<div class="benchmark-explorer">
	<div class="benchmark-explorer__bar">
		<div class="benchmark-explorer__nav">
			<button
				type="button"
				class="benchmark-button benchmark-button--secondary"
				onclick={() => step(-1)}>{t(COPY + 'readers.previous')}</button
			>
			<span class="benchmark-explorer__position"
				>{t(COPY + 'readers.position', { index: position + 1, total: readers.length })}</span
			>
			<button
				type="button"
				class="benchmark-button benchmark-button--secondary"
				onclick={() => step(1)}>{t(COPY + 'readers.next')}</button
			>
		</div>
	</div>

	<div class="benchmark-explorer__top">
		<section class="benchmark-explorer__card" aria-labelledby="benchmark-clues-heading">
			<h3 class="benchmark-explorer__title" id="benchmark-clues-heading">
				{t(COPY + 'readers.cluesHeading')}
			</h3>
			<ul class="benchmark-covers benchmark-covers--clues">
				{#each reader.top_rated as book, index (book.id)}
					<li>
						{@render pick(
							'clue-' + index,
							book,
							t(COPY + 'readers.stars', { rating: formatRating(book.rating) }),
							align(index, CLUES_PER_ROW),
							null,
							false
						)}
					</li>
				{/each}
			</ul>
			<button
				type="button"
				class="benchmark-explorer__link"
				aria-expanded={historyOpen}
				aria-controls="benchmark-reader-history"
				onclick={() => (historyOpen = !historyOpen)}
				>{historyOpen
					? t(COPY + 'readers.hideHistory')
					: t(COPY + 'readers.showHistory', { count: reader.shown_count.toLocaleString() })}</button
			>
		</section>

		<section
			class="benchmark-explorer__card benchmark-explorer__hidden"
			class:benchmark-explorer__hidden--revealed={revealed}
			aria-labelledby="benchmark-hidden-heading"
			aria-live="polite"
		>
			<h3 class="benchmark-explorer__title" id="benchmark-hidden-heading">
				{t(COPY + 'readers.hiddenHeading')}
			</h3>
			<!--
				Both states share one grid cell, and the answer is laid out (unseen) from the start, so the
				card is already as tall as the revealed book needs and nothing moves when it appears.
			-->
			<div class="benchmark-explorer__stage">
				<div
					class="benchmark-explorer__answer benchmark-explorer__layer"
					class:benchmark-explorer__layer--off={!revealed}
					aria-hidden={!revealed}
					inert={!revealed}
				>
					<button
						type="button"
						class="benchmark-explorer__answer-cover"
						aria-label={t(COPY + 'readers.pickLabel', {
							title: reader.target.title,
							author: reader.target.author
						})}
						aria-haspopup="dialog"
						onclick={(event) =>
							openBook(reader.target.id, reader.target.title, event.currentTarget)}
						><BenchmarkCover bookId={reader.target.id} title={reader.target.title} large /></button
					>
					<div class="benchmark-explorer__answer-text">
						<strong>{reader.target.title}</strong>
						<span>{reader.target.author}</span>
						<ul class="benchmark-explorer__results">
							{#each ORDER as system (system)}
								<li
									style={'--system-color: var(--benchmark-' + system + ')'}
									class:benchmark-explorer__result--hit={found(reader, system)}
								>
									<span class="benchmark-system-name"
										><i aria-hidden="true" class={'benchmark-key benchmark-key--' + system}
										></i>{systemName(system)}</span
									>
									<span>{result(system)}</span>
								</li>
							{/each}
						</ul>
					</div>
				</div>
				{#if !revealed}
					<div class="benchmark-explorer__answer benchmark-explorer__layer">
						<span class="benchmark-explorer__mystery" aria-hidden="true">?</span>
						<button type="button" class="benchmark-button" onclick={() => (revealed = true)}
							>{t(COPY + 'readers.reveal')}</button
						>
					</div>
				{/if}
			</div>
		</section>
	</div>

	<!-- The full rating history opens full width below both cards, so neither card stretches. -->
	{#if historyOpen}
		<div class="benchmark-explorer__card benchmark-explorer__history" id="benchmark-reader-history">
			{#if historyError}
				<p class="benchmark-note" role="alert">{t(COPY + 'readers.historyError')}</p>
			{:else if !history}
				<p class="benchmark-note" aria-live="polite">{t(COPY + 'readers.loadingHistory')}</p>
			{:else}
				<div class="benchmark-explorer__history-scroll">
					<table class="benchmark-history">
						<thead>
							<tr>
								<th scope="col">{t(COPY + 'readers.historyColumns.title')}</th>
								<th scope="col">{t(COPY + 'readers.historyColumns.author')}</th>
								<th scope="col">{t(COPY + 'readers.historyColumns.rating')}</th>
							</tr>
						</thead>
						<tbody>
							{#each sortedHistory as row (row[0])}
								<tr>
									<td>
										<button
											type="button"
											class="benchmark-explorer__book-link"
											aria-haspopup="dialog"
											onclick={(event) => openBook(row[0], row[1], event.currentTarget)}
											>{row[1]}</button
										>
									</td>
									<td>{row[2]}</td>
									<td>{formatRating(row[3])}★</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="benchmark-note">{t(COPY + 'readers.historyNote')}</p>
			{/if}
		</div>
	{/if}

	<!-- Narrow screens show one list at a time; wider screens show all three side by side. -->
	<div class="benchmark-explorer__switch" role="group" aria-label={t(COPY + 'readers.listsLabel')}>
		{#each ORDER as system (system)}
			<button
				type="button"
				aria-pressed={activeList === system}
				style={'--system-color: var(--benchmark-' + system + ')'}
				onclick={() => (activeList = system)}
				><i aria-hidden="true" class={'benchmark-key benchmark-key--' + system}></i>{systemName(
					system
				)}</button
			>
		{/each}
	</div>

	<div class="benchmark-explorer__lists">
		{#each ORDER as system (system)}
			{@const list = reader.lists[system]}
			{@const rank = reader.hit_rank[system]}
			<section
				class="benchmark-explorer__list"
				class:benchmark-explorer__list--active={activeList === system}
				style={'--system-color: var(--benchmark-' + system + ')'}
				aria-label={t(COPY + 'readers.listLabel', { system: systemName(system) })}
			>
				<h3 class="benchmark-explorer__list-head">
					<span class="benchmark-system-name"
						><i aria-hidden="true" class={'benchmark-key benchmark-key--' + system}></i>{systemName(
							system
						)}</span
					>
					{#if revealed}
						<span
							class="benchmark-chip"
							class:benchmark-chip--strong={rank != null}
							style={rank != null ? '--chip-color: var(--benchmark-' + system + ')' : ''}
							>{result(system)}</span
						>
					{/if}
				</h3>
				<ol class="benchmark-covers benchmark-covers--picks">
					{#each list as book, index (index)}
						<li>
							{@render pick(
								system + '-' + index,
								book,
								t(COPY + 'readers.pickRank', { rank: index + 1 }),
								align(index, PICKS_PER_ROW),
								index + 1,
								revealed && rank === index + 1
							)}
						</li>
					{/each}
				</ol>
			</section>
		{/each}
	</div>
</div>

<BookSummarySheet
	state={sheetState}
	restoreFocus={sheetRestoreFocus}
	currentRating={sheetRating}
	bookmarked={sheetBookmarked}
	notInterested={sheetNotInterested}
	onBookmark={(book: Book) => toggleBookmarked(book)}
	onRate={(book: Book, value: RatingValue) => setBookRating(book, value)}
	onRemoveRating={(book: Book) => removeBookRating(book)}
	onNotInterested={(book: Book) => toggleNotInterested(book)}
	onSearchAuthor={searchAuthor}
	onClose={closeSheet}
	onRetry={retrySheet}
/>

<style>
	.benchmark-explorer {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}

	/* Navigation */
	.benchmark-explorer__bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2) var(--space-4);
	}
	.benchmark-explorer__link {
		margin: 0;
		padding: 0;
		border: 0;
		font: inherit;
		color: var(--color-text);
		text-decoration: underline;
		text-underline-offset: 2px;
		background: none;
		cursor: pointer;
	}
	.benchmark-explorer__nav {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	/*
	 * Both labels stay on one line. On a phone the counter drops its reserved width, and on the
	 * narrowest phones it moves above the buttons.
	 */
	.benchmark-explorer__nav .benchmark-button,
	.benchmark-explorer__nav .benchmark-explorer__position {
		white-space: nowrap;
	}
	@media (max-width: 400px) {
		.benchmark-explorer__nav .benchmark-explorer__position {
			min-width: 0;
		}
	}
	@media (max-width: 374px) {
		.benchmark-explorer__nav {
			flex-wrap: wrap;
		}
		.benchmark-explorer__nav .benchmark-explorer__position {
			flex-basis: 100%;
			order: -1;
			text-align: left;
		}
	}
	.benchmark-explorer__position {
		min-width: 4.5rem;
		font-family: var(--font-family-interactive);
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
		text-align: center;
		color: var(--color-text-muted);
	}

	/* Clues and the hidden favorite */
	.benchmark-explorer__top {
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
		gap: var(--space-4);
		align-items: stretch;
	}
	.benchmark-explorer__card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-3);
		min-width: 0;
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-card-bg);
	}
	.benchmark-explorer__title {
		margin: 0;
		font-family: var(--font-family-content);
		font-size: 1.25rem;
		font-weight: 400;
		line-height: 1.2;
		color: var(--color-text);
	}
	.benchmark-explorer__hidden--revealed {
		border-color: color-mix(in srgb, var(--color-accent-brand) 45%, var(--color-border));
	}
	.benchmark-explorer__answer {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
	}
	.benchmark-explorer__stage {
		display: grid;
		width: 100%;
	}
	.benchmark-explorer__layer {
		grid-area: 1 / 1;
		align-self: start;
	}
	.benchmark-explorer__layer--off {
		visibility: hidden;
	}
	.benchmark-explorer__answer-cover,
	.benchmark-explorer__mystery {
		flex: 0 0 5.5rem;
		width: 5.5rem;
	}
	.benchmark-explorer__answer-cover {
		display: block;
		margin: 0;
		padding: 0;
		border: 0;
		border-radius: var(--radius-xs);
		background: none;
		cursor: pointer;
	}
	.benchmark-explorer__answer-cover:focus-visible,
	.benchmark-explorer__book-link:focus-visible {
		outline: 2px solid var(--color-text-muted);
		outline-offset: 2px;
	}
	.benchmark-explorer__book-link {
		margin: 0;
		padding: 0;
		border: 0;
		font: inherit;
		text-align: left;
		color: inherit;
		background: none;
		cursor: pointer;
	}
	.benchmark-explorer__book-link:hover {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.benchmark-explorer__mystery {
		display: grid;
		place-items: center;
		aspect-ratio: 2 / 3;
		border: 1px dashed var(--color-border-hover, var(--color-border));
		border-radius: var(--radius-xs);
		font-family: var(--font-family-content);
		font-size: 2rem;
		color: var(--color-text-muted);
		background: var(--color-bg-muted);
	}
	.benchmark-explorer__answer-text {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
		flex: 1;
	}
	.benchmark-explorer__answer-text strong {
		font-family: var(--font-family-content);
		font-size: 1.0625rem;
		font-weight: 400;
		line-height: 1.25;
		color: var(--color-text);
	}
	.benchmark-explorer__answer-text > span {
		font-family: var(--font-family-interactive);
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
	.benchmark-explorer__results {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: var(--space-2) 0 0;
		padding: 0;
		list-style: none;
		font-family: var(--font-family-interactive);
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
	.benchmark-explorer__results li {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.benchmark-explorer__result--hit {
		font-weight: 600;
		color: var(--color-text);
	}

	/* The three lists */
	/* The list switcher only exists on narrow screens, where one list shows at a time. */
	.benchmark-explorer__switch {
		display: none;
		flex-wrap: wrap;
		gap: 2px;
		align-self: flex-start;
		padding: 2px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-muted);
	}
	.benchmark-explorer__switch button {
		min-height: 2.25rem;
		padding: 0.375rem 0.75rem;
		border: 0;
		border-radius: calc(var(--radius-sm) - 2px);
		font-family: var(--font-family-interactive);
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-muted);
		background: transparent;
		cursor: pointer;
	}
	.benchmark-explorer__switch button:hover,
	.benchmark-explorer__switch button[aria-pressed='true'] {
		color: var(--color-text);
	}
	.benchmark-explorer__switch button[aria-pressed='true'] {
		background: var(--color-card-bg);
		box-shadow: var(--shadow-card);
	}
	.benchmark-explorer__switch :global(.benchmark-key) {
		margin-right: 0.375rem;
	}
	.benchmark-explorer__lists {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-4);
	}
	.benchmark-explorer__list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-top: 3px solid var(--system-color);
		border-radius: var(--radius-md);
		background: var(--color-card-bg);
	}
	.benchmark-explorer__list-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-height: 1.5rem;
		margin: 0;
	}
	/* The result chip appears on reveal; a tight line height keeps it inside the head's height. */
	.benchmark-explorer__list-head :global(.benchmark-chip) {
		line-height: 1.2;
	}

	/* Cover grids */
	.benchmark-covers {
		display: grid;
		gap: var(--space-2);
		width: 100%;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.benchmark-covers--picks {
		grid-template-columns: repeat(5, minmax(0, 1fr));
	}
	.benchmark-covers--clues {
		grid-template-columns: repeat(6, minmax(0, 5.5rem));
	}
	.benchmark-pick {
		position: relative;
		display: block;
	}
	.benchmark-pick__button {
		position: relative;
		display: block;
		width: 100%;
		margin: 0;
		padding: 0;
		border: 0;
		border-radius: var(--radius-xs);
		background: none;
		cursor: pointer;
		transition: opacity 160ms ease;
	}
	/* As on the feed: on hover the cover zooms inside its fixed frame. */
	.benchmark-pick__button:hover :global(.benchmark-cover img),
	.benchmark-explorer__answer-cover:hover :global(.benchmark-cover img) {
		transform: scale(1.05);
	}
	.benchmark-pick__button:hover :global(.benchmark-cover__title),
	.benchmark-explorer__answer-cover:hover :global(.benchmark-cover__title) {
		transform: scale(1.03);
	}
	.benchmark-pick__button:focus-visible {
		outline: 2px solid var(--color-text-muted);
		outline-offset: 2px;
	}
	.benchmark-pick__rank {
		position: absolute;
		top: 0.25rem;
		left: 0.25rem;
		display: grid;
		place-items: center;
		min-width: 1.125rem;
		height: 1.125rem;
		padding: 0 0.25rem;
		border-radius: 999px;
		font-family: var(--font-family-interactive);
		font-size: 0.625rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: #fff;
		background: rgb(0 0 0 / 0.6);
	}
	/* After the reveal: the hidden favorite is ringed in its recommender's color, the rest recede. */
	.benchmark-pick--dim .benchmark-pick__button {
		opacity: 0.35;
	}
	.benchmark-pick--hit .benchmark-pick__button {
		outline: 3px solid var(--system-color);
		outline-offset: 2px;
	}
	.benchmark-pick--hit .benchmark-pick__rank {
		background: var(--system-color);
	}
	.benchmark-pick__tip {
		position: absolute;
		bottom: calc(100% + var(--space-2));
		z-index: 5;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		width: max-content;
		/* Narrower on the smallest phones, so a hidden card never widens the page. */
		max-width: min(14rem, 60vw);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xs);
		font-family: var(--font-family-interactive);
		font-size: 0.75rem;
		line-height: 1.35;
		color: var(--color-text-muted);
		background: var(--color-card-bg);
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.14);
		pointer-events: none;
		visibility: hidden;
		opacity: 0;
		transition: opacity 120ms ease;
	}
	.benchmark-pick__tip strong {
		font-family: var(--font-family-content);
		font-size: 0.8125rem;
		font-weight: 400;
		color: var(--color-text);
	}
	.benchmark-pick__meta {
		font-variant-numeric: tabular-nums;
	}
	.benchmark-pick__tip--start {
		left: 0;
	}
	.benchmark-pick__tip--center {
		left: 50%;
		transform: translateX(-50%);
	}
	.benchmark-pick__tip--end {
		right: 0;
	}
	.benchmark-pick--active .benchmark-pick__tip {
		visibility: visible;
		opacity: 1;
	}

	/* Full history */
	.benchmark-explorer__history {
		align-items: stretch;
	}
	.benchmark-explorer__history-scroll {
		max-height: 22rem;
		overflow: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		scrollbar-width: thin;
	}
	.benchmark-history {
		width: 100%;
		border-collapse: collapse;
		font-family: var(--font-family-interactive);
		font-size: 0.8125rem;
		color: var(--color-text);
	}
	.benchmark-history th {
		position: sticky;
		top: 0;
		padding: var(--space-2);
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-align: left;
		text-transform: uppercase;
		color: var(--color-text-muted);
		background: var(--color-card-bg);
		box-shadow: inset 0 -1px 0 var(--color-border);
	}
	.benchmark-history td {
		padding: 0.375rem var(--space-2);
		border-bottom: 1px solid var(--color-border);
		vertical-align: top;
	}
	.benchmark-history td:first-child {
		font-family: var(--font-family-content);
	}
	.benchmark-history td:last-child,
	.benchmark-history th:last-child {
		text-align: right;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 767px) {
		.benchmark-explorer__top {
			grid-template-columns: minmax(0, 1fr);
		}
		.benchmark-covers--clues {
			grid-template-columns: repeat(6, minmax(0, 1fr));
		}
		.benchmark-explorer__switch {
			display: inline-flex;
		}
		.benchmark-explorer__answer-cover,
		.benchmark-explorer__mystery {
			flex-basis: 4.5rem;
			width: 4.5rem;
		}
		.benchmark-explorer__lists {
			grid-template-columns: minmax(0, 1fr);
		}
		.benchmark-explorer__list:not(.benchmark-explorer__list--active) {
			display: none;
		}
	}
</style>
