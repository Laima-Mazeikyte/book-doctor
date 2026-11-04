<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import LibraryLoadNotice from '$lib/components/LibraryLoadNotice.svelte';
	import BookCorrection from '$lib/components/book-card/BookCorrection.svelte';
	import { resolve } from '$app/paths';
	import { navigating } from '$app/state';
	import { Bookmark, BookOpen, ChevronDown, LockKeyhole, Star, ThumbsDown } from 'lucide-svelte';
	import type { Book, RatingValue } from '$lib/types/book';
	import { bookPath } from '$lib/books/bookUrl';
	import BookAnnotations from './BookAnnotations.svelte';
	import BookAwards from './BookAwards.svelte';
	import BookSeries from './BookSeries.svelte';
	import BookConnections from './BookConnections.svelte';
	import BookDiscovery from './BookDiscovery.svelte';
	import type { BookSeries as BookSeriesData } from '$lib/books/series';
	import { authStore, authReady } from '$lib/stores/auth';
	import { ratingsStore } from '$lib/stores/ratings';
	import LibrarySaveIndicator from '$lib/components/LibrarySaveIndicator.svelte';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import {
		isUserLibraryIdsReady,
		userLibraryHydrationStore,
		canUseLibraryAction
	} from '$lib/stores/userLibrary';
	import {
		toggleBookmarked,
		toggleBookRating,
		removeBookRating,
		toggleNotInterested
	} from '$lib/stores/libraryActions';

	interface Props {
		book: Book;
		canonicalUrl: string;
		series?: BookSeriesData | null;
	}
	let { book, canonicalUrl, series = null }: Props = $props();
	let coverFailedFor = $state<string | null>(null);
	let coverReadyFor = $state<string | null>(null);
	const seriesImagesReady = $derived(coverReadyFor === book.book_id);
	let authorExpanded = $state(false);
	const author = $derived(book.author);
	const currentBookId = $derived(book.book_id);
	let authorCollection = $state<Book[]>([]);
	let authorCollectionTruncated = $state(false);
	const authorHasCurrentBook = $derived(
		authorCollection.some((item) => item.book_id === currentBookId)
	);
	const authorBooks = $derived(
		authorHasCurrentBook ? authorCollection : [...authorCollection.slice(0, 47), book]
	);
	const authorBooksTruncated = $derived(
		authorCollectionTruncated || (!authorHasCurrentBook && authorCollection.length === 48)
	);
	const pendingAuthorBook = $derived(
		navigating.to
			? authorBooks.find(
					(item) => item.slug && resolve(bookPath(item)) === navigating.to?.url.pathname
				)
			: undefined
	);
	let authorBooksStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let authorController: AbortController | null = null;
	let authorPanel = $state<HTMLElement>();
	let authorScrollTop = 0;
	const failedAuthorCovers = new SvelteSet<string>();
	const ratingOptions: RatingValue[] = [1, 2, 3, 4, 5];
	const rating = $derived($ratingsStore.get(book.id) ?? 0);
	const saved = $derived($planToReadStore.has(book.id));
	const dismissed = $derived($notInterestedStore.has(book.book_id));
	const libraryReady = $derived(
		$authReady && isUserLibraryIdsReady($authStore.user?.id, $userLibraryHydrationStore)
	);
	function actionReady(action: 'rating' | 'bookmark' | 'dismissal') {
		return (
			$authReady && canUseLibraryAction(action, $authStore.user?.id, $userLibraryHydrationStore)
		);
	}
	const hasReadingHistory = $derived($ratingsStore.size >= 10);
	const description = $derived(
		book.summary?.trim()
			? book.summary.trim().replace(/\s+/g, ' ').slice(0, 200)
			: `Explore ${book.title}${book.author ? ` by ${book.author}` : ''} on unread.`
	);

	function releaseSeriesImagesAfterCover(node: HTMLElement) {
		const bookId = book.book_id;
		let released = false;
		let firstFrame = 0;
		let secondFrame = 0;
		const release = () => {
			if (released) return;
			released = true;
			// Give the main cover a paint opportunity before adding thumbnail requests.
			firstFrame = requestAnimationFrame(() => {
				secondFrame = requestAnimationFrame(() => (coverReadyFor = bookId));
			});
		};
		// Capture also handles an error before the image becomes the fallback.
		node.addEventListener('load', release, true);
		node.addEventListener('error', release, true);
		const image = node.querySelector('img');
		if (!image || image.complete) release();
		return {
			destroy() {
				node.removeEventListener('load', release, true);
				node.removeEventListener('error', release, true);
				cancelAnimationFrame(firstFrame);
				cancelAnimationFrame(secondFrame);
			}
		};
	}

	async function loadAuthorBooks() {
		if (authorBooksStatus === 'loading' || authorBooksStatus === 'ready') return;
		authorController = new AbortController();
		const controller = authorController;
		authorBooksStatus = 'loading';
		const requestedAuthor = author;
		const params = new URLSearchParams({ author: requestedAuthor });
		try {
			const response = await fetch(`${resolve('/api/books/by-author')}?${params}`, {
				signal: controller.signal
			});
			if (!response.ok) throw new Error('Unable to load author books');
			const payload: { books: Book[]; truncated: boolean } = await response.json();
			if (controller.signal.aborted || requestedAuthor !== author) return;
			authorCollection = payload.books.slice(0, 48);
			authorCollectionTruncated = payload.truncated || payload.books.length > 48;
			authorBooksStatus = 'ready';
		} catch {
			if (!controller.signal.aborted && requestedAuthor === author) authorBooksStatus = 'error';
		}
	}

	function toggleAuthorBooks() {
		authorExpanded = !authorExpanded;
		if (authorExpanded) void loadAuthorBooks();
	}

	function restoreAuthorScroll(node: HTMLElement) {
		node.scrollTop = authorScrollTop;
	}

	$effect.pre(() => {
		void currentBookId;
		const panel = untrack(() => authorPanel);
		if (!panel) return;
		const scrollTop = panel.scrollTop;
		void tick().then(() => {
			if (panel.isConnected) panel.scrollTop = scrollTop;
		});
	});

	onDestroy(() => authorController?.abort());

	$effect(() => {
		// Track the derived author value so same-author book changes retain this state.
		void author;
		untrack(() => {
			authorController?.abort();
			authorController = null;
			authorExpanded = false;
			authorCollection = [];
			authorCollectionTruncated = false;
			authorBooksStatus = 'idle';
			authorScrollTop = 0;
			failedAuthorCovers.clear();
		});
	});
</script>

<svelte:head>
	<title>{book.title}{book.author ? ` by ${book.author}` : ''} — unread</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={canonicalUrl} />
	<meta property="og:type" content="book" />
	<meta property="og:title" content={book.title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonicalUrl} />
	<meta property="og:site_name" content="unread" />
	<meta name="twitter:card" content={book.coverUrl ? 'summary_large_image' : 'summary'} />
	{#if book.coverUrl}
		<meta property="og:image" content={book.coverUrl} />
		<meta property="og:image:alt" content={`Cover of ${book.title}`} />
	{/if}
</svelte:head>

<article class="book-page">
	<LibraryLoadNotice collections={['ratings', 'bookmarks', 'dismissals']} />
	<div class="book-layout">
		<div class="cover-column">
			{#key book.book_id}
				<div
					class="book-cover"
					class:book-cover--not-interested={dismissed}
					use:releaseSeriesImagesAfterCover
				>
					{#if book.coverUrl && coverFailedFor !== book.book_id}
						<img
							src={book.coverUrl}
							alt={`Cover of ${book.title}`}
							fetchpriority="high"
							onerror={() => (coverFailedFor = book.book_id)}
						/>
					{:else}
						<div class="cover-fallback">
							<BookOpen size={40} aria-hidden="true" /><span>{book.title}</span><small
								>{book.author}</small
							>
						</div>
					{/if}
				</div>
			{/key}
			<div class="library-actions">
				<button
					class="action-button save-button"
					disabled={!actionReady('bookmark')}
					aria-pressed={saved}
					onclick={() => toggleBookmarked(book)}
					><Bookmark
						size={18}
						fill={saved ? 'currentColor' : 'none'}
						aria-hidden="true"
					/><LibrarySaveIndicator bookUlid={book.book_id} kind="bookmark" />{saved
						? 'Saved'
						: 'Save book'}</button
				>
				<fieldset
					disabled={!actionReady('rating')}
					aria-label={rating ? `Your rating: ${rating} of 5` : 'Book rating'}
				>
					<div class="rating-stars">
						<div class="rating-options">
							{#each ratingOptions as value (value)}<button
									class="star-button"
									aria-label={`Rate ${value} of 5 stars`}
									aria-pressed={rating === value}
									onclick={() => toggleBookRating(book, value)}
									><Star
										size={23}
										fill={rating >= value ? 'currentColor' : 'none'}
										aria-hidden="true"
									/></button
								>{/each}
						</div>
						<LibrarySaveIndicator bookUlid={book.book_id} kind="rating" />
						{#if rating}<button class="text-button" onclick={() => removeBookRating(book)}
								>Remove</button
							>{/if}
					</div>
				</fieldset>
				<button
					class="action-button"
					disabled={!libraryReady}
					aria-pressed={dismissed}
					onclick={() => toggleNotInterested(book)}
					><ThumbsDown size={17} aria-hidden="true" /><LibrarySaveIndicator
						bookUlid={book.book_id}
						kind="dismissal"
					/>{dismissed ? 'Marked not interested' : 'Not interested'}</button
				>
			</div>
		</div>

		<div class="book-information">
			<h1 class="typ-h3">{book.title}</h1>
			{#if book.author}
				<button
					class="author-button"
					aria-expanded={authorExpanded}
					aria-controls="author-books"
					onclick={toggleAuthorBooks}
				>
					{book.author}<ChevronDown size={18} aria-hidden="true" />
				</button>
				{#if authorExpanded}
					<section
						bind:this={authorPanel}
						use:restoreAuthorScroll
						onscroll={(event) => (authorScrollTop = event.currentTarget.scrollTop)}
						id="author-books"
						class="author-books"
						aria-label={`Books by ${book.author} in publication order`}
					>
						<h2 class="eyebrow author-books-title">Books by {book.author}</h2>
						<p class="muted author-books-subtitle">in publication order</p>
						{#if authorBooksStatus === 'loading'}
							<p class="muted" role="status">Loading books…</p>
						{:else if authorBooksStatus === 'error'}
							<p class="muted" role="alert">Couldn’t load books by this author.</p>
							<button class="text-button" onclick={() => void loadAuthorBooks()}>Retry</button>
						{:else}
							<div class="author-cover-grid">
								{#each authorBooks as item (item.book_id)}
									<!-- eslint-disable svelte/no-navigation-without-resolve -- The populated branch uses resolve; older cached records deliberately have no href. -->
									<a
										class="author-book-cover"
										class:author-book-cover--selected={pendingAuthorBook
											? pendingAuthorBook.book_id === item.book_id
											: item.book_id === currentBookId}
										href={item.slug ? resolve(bookPath(item)) : undefined}
										data-sveltekit-noscroll
										aria-current={item.book_id === currentBookId ? 'page' : undefined}
										aria-busy={pendingAuthorBook?.book_id === item.book_id ? 'true' : undefined}
										aria-label={item.title}
										title={item.title}
									>
										{#if item.coverUrl && !failedAuthorCovers.has(item.book_id)}
											<img
												src={item.coverUrl}
												alt=""
												loading="lazy"
												decoding="async"
												onerror={() => failedAuthorCovers.add(item.book_id)}
											/>
										{:else}
											<BookOpen size={24} aria-hidden="true" />
										{/if}
									</a>
									<!-- eslint-enable svelte/no-navigation-without-resolve -->
								{/each}
							</div>
							{#if authorBooksTruncated}<p class="muted">
									Showing 48 books from this catalog.
								</p>{/if}
						{/if}
					</section>
				{/if}
			{/if}

			{#if book.year || book.type || book.genres?.length}
				<ul class="metadata" aria-label="Book details">
					{#if book.year}<li>{book.year}</li>{/if}
					{#if book.type}<li>{book.type}</li>{/if}
					{#each book.genres ?? [] as genre (genre)}<li>{genre}</li>{/each}
				</ul>
			{/if}
			<BookAnnotations {book} />
			{#if series}{#key series.title}<BookSeries
						{series}
						currentBookId={book.book_id}
						imagesReady={seriesImagesReady}
					/>{/key}{/if}
			<div class="synopsis">
				{#if book.summary?.trim()}<p>{book.summary}</p>{:else}<p class="muted">
						No description available.
					</p>{/if}
			</div>
			<BookAwards awards={book.awards} />
		</div>

		<aside class="personal-column" aria-label="Book recommendations">
			<section class="profile-panel">
				<p class="match-placeholder">Match score coming soon</p>
				{#if !libraryReady}<p class="muted" role="status">Loading your reading history…</p>
				{:else if !hasReadingHistory}<p class="muted">
						Rate at least 10 books to build your reading profile.
					</p>
					<a href={resolve('/rate')}>Rate books →</a>
				{/if}

				<BookConnections bookId={book.book_id} imagesReady={seriesImagesReady} />
			</section>

			<section class="premium-panel" aria-labelledby="premium-title">
				<p class="eyebrow"><LockKeyhole size={13} aria-hidden="true" /> Premium</p>
				<h2 id="premium-title">More like this, but…</h2>
				<p class="muted">Use this book as a starting point and fine-tune your next read.</p>
				<ul class="premium-options" aria-label="Planned premium options">
					<li>Faster pacing</li>
					<li>Less violence</li>
					<li>More demanding vocabulary</li>
					<li>Less widely read</li>
				</ul>
				<p class="placeholder">Premium discovery coming soon</p>
			</section>
		</aside>

		<BookDiscovery bookId={book.book_id} imagesReady={seriesImagesReady} />
	</div>
	<div class="book-correction"><BookCorrection {book} /></div>
</article>

<style>
	.book-page {
		max-width: 92rem;
		margin-inline: auto;
	}
	a {
		color: var(--color-text);
		text-underline-offset: 0.2em;
	}
	.text-button,
	.eyebrow,
	.metadata,
	.muted,
	.placeholder {
		font-family: var(--font-family-interactive);
		font-size: 0.85rem;
	}
	.text-button,
	.author-button {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
		background: none;
		border: 0;
		color: var(--color-text);
		padding: 0.5rem 0;
		cursor: pointer;
	}
	.book-layout {
		display: grid;
		grid-template-columns: minmax(12rem, 0.65fr) minmax(0, 1.8fr) minmax(17rem, 1fr);
		gap: 2.5rem;
		align-items: start;
	}
	.cover-column {
		min-width: 0;
	}
	.book-correction {
		max-width: 48rem;
	}
	.book-cover--not-interested {
		opacity: 0.3;
	}
	.book-cover img,
	.cover-fallback {
		display: block;
		width: 100%;
		aspect-ratio: 2 / 3;
		object-fit: cover;
		border-radius: var(--radius-sm);
		box-shadow: 0 12px 24px #0003;
	}
	.cover-fallback {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		padding: 1rem;
		gap: 1rem;
		text-align: center;
		background: var(--color-bg-muted);
		border: 1px solid var(--color-border);
	}
	.eyebrow {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-weight: 500;
		margin: 0 0 0.75rem;
	}
	.book-information {
		min-width: 0;
	}
	.book-information h1 {
		margin-bottom: 0.5rem;
		font-size: clamp(2.2rem, 3.8vw, 4rem);
		line-height: 1.08;
		overflow-wrap: anywhere;
	}
	.author-button {
		font-family: var(--font-family-content);
		font-size: 1.6rem;
	}
	.author-books {
		margin-block: 1rem;
		padding: 1rem;
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		max-height: 28rem;
		overflow-y: auto;
	}
	.author-cover-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(4rem, 1fr));
		gap: 0.75rem;
	}
	.author-books-title {
		margin-bottom: 0.25rem;
	}
	.author-books-subtitle {
		margin: 0 0 0.75rem;
	}
	.author-book-cover {
		display: grid;
		place-items: center;
		min-width: 0;
		aspect-ratio: 2 / 3;
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-muted);
	}
	.author-book-cover img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.author-book-cover--selected {
		border-color: var(--color-text);
		box-shadow: 0 0 0 1px var(--color-text);
	}
	.metadata {
		display: flex;
		flex-wrap: wrap;
		padding: 0;
		margin: 1.5rem 0 0.5rem;
		gap: 0.6rem 0;
		list-style: none;
		color: var(--color-text-muted);
	}
	.metadata li:not(:last-child) {
		border-right: 1px solid var(--color-border);
		padding-right: 0.8rem;
		margin-right: 0.8rem;
	}
	.synopsis {
		font-size: 1.15rem;
		line-height: 1.65;
		white-space: pre-line;
	}
	.synopsis p {
		margin: 0;
	}

	.muted {
		color: var(--color-text-muted);
		line-height: 1.6;
	}
	.personal-column {
		display: grid;
		gap: 1.5rem;
		grid-column: 3;
		grid-row: 1 / span 2;
	}
	.profile-panel,
	.premium-panel {
		padding: 1.5rem;
		background: var(--color-card-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
	.match-placeholder {
		font-size: 1.7rem;
		line-height: 1.25;
		margin: 0 0 1rem;
	}
	.library-actions {
		display: grid;
		gap: 0.8rem;
		max-width: 20rem;
		margin: 1.25rem auto 0;
	}
	.action-button {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 0.6rem;
		padding: 0.8rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
		cursor: pointer;
	}
	.save-button,
	.action-button[aria-pressed='true'] {
		background: var(--color-bg-muted);
		border-color: var(--color-accent);
	}
	button:disabled {
		opacity: 0.5;
		cursor: wait;
	}
	fieldset {
		min-width: 0;
		padding: 0;
		margin: 0;
		border: 0;
	}
	.rating-stars {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: 0.25rem;
	}
	.rating-options {
		display: flex;
		justify-content: center;
		gap: 0.25rem;
		width: 100%;
	}
	.star-button {
		display: grid;
		place-items: center;
		flex: 1;
		max-width: 2.75rem;
		min-height: 2.75rem;
		background: none;
		border: 0;
		padding: 0.5rem 0;
		color: var(--color-text);
		cursor: pointer;
	}
	.premium-panel h2 {
		font-size: 1.5rem;
		line-height: 1.2;
	}
	.premium-options {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		padding: 0;
	}
	.premium-options li {
		font-family: var(--font-family-interactive);
		font-size: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		padding: 0.25rem 0.6rem;
		color: var(--color-text-muted);
	}
	.placeholder {
		padding: 0.75rem;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
	}
	button:focus-visible,
	a:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 4px;
	}
	@media (max-width: 1100px) {
		.book-layout {
			grid-template-columns: minmax(12rem, 0.55fr) minmax(0, 1.5fr);
			gap: 1.5rem;
		}
		.personal-column {
			grid-column: 1 / -1;
			grid-row: auto;
			grid-template-columns: 1.5fr 1fr;
		}
	}
	@media (max-width: 600px) {
		.book-layout {
			grid-template-columns: 1fr;
		}
		.book-cover {
			max-width: 11rem;
			margin-inline: auto;
		}
		.personal-column {
			grid-column: 1;
			grid-template-columns: 1fr;
		}
		.profile-panel,
		.premium-panel {
			padding: 1rem;
		}
	}
</style>
