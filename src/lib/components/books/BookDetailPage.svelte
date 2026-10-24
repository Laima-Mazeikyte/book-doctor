<script lang="ts">
	import { onDestroy } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import LibraryLoadNotice from '$lib/components/LibraryLoadNotice.svelte';
	import BookCorrection from '$lib/components/book-card/BookCorrection.svelte';
	import { resolve } from '$app/paths';
	import { Bookmark, BookOpen, ChevronDown, LockKeyhole, Star, ThumbsDown } from 'lucide-svelte';
	import type { Book, RatingValue } from '$lib/types/book';
	import { bookPath } from '$lib/books/bookUrl';
	import type { bookCharacteristics } from '$lib/books/characteristics';
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
	import { filterRatedLikedBookPrecedents } from '$lib/recommendations/likedBookPrecedents';
	import type { RecommendationsUniquePayload } from '$lib/stores/recommendationsPage';

	interface Props {
		book: Book;
		canonicalUrl: string;
		characteristics: ReturnType<typeof bookCharacteristics>;
	}
	let { book, canonicalUrl, characteristics }: Props = $props();
	let coverFailed = $state(false);
	let authorExpanded = $state(false);
	let authorBooks = $state<Book[]>([]);
	let authorBooksTruncated = $state(false);
	let authorBooksStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let authorController: AbortController | null = null;
	const failedAuthorCovers = new SvelteSet<string>();
	let referenceBooks = $state<Book[]>([]);
	let referencesStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
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
	const likedReferences = $derived(
		filterRatedLikedBookPrecedents(referenceBooks, $ratingsStore)
			.filter((item) => item.book_id !== book.book_id)
			.slice(0, 3)
	);
	const qualityLabel = $derived(
		book.qualityBand === 'top_0_1_percent'
			? 'Top 0.1% overall'
			: book.qualityBand === 'top_1_percent'
				? 'Top 1% overall'
				: book.qualityBand === 'top_5_percent'
					? 'Top 5% overall'
					: null
	);
	const description = $derived(
		book.summary?.trim()
			? book.summary.trim().replace(/\s+/g, ' ').slice(0, 200)
			: `Explore ${book.title}${book.author ? ` by ${book.author}` : ''} on unread.`
	);

	async function loadAuthorBooks() {
		if (authorBooksStatus === 'loading' || authorBooksStatus === 'ready') return;
		authorController = new AbortController();
		const controller = authorController;
		authorBooksStatus = 'loading';
		const params = new URLSearchParams({ author: book.author, exclude: book.book_id });
		try {
			const response = await fetch(`${resolve('/api/books/by-author')}?${params}`, {
				signal: controller.signal
			});
			if (!response.ok) throw new Error('Unable to load author books');
			const payload: { books: Book[]; truncated: boolean } = await response.json();
			if (controller.signal.aborted) return;
			authorBooks = payload.books;
			authorBooksTruncated = payload.truncated;
			authorBooksStatus = 'ready';
		} catch {
			if (!controller.signal.aborted) authorBooksStatus = 'error';
		}
	}

	function toggleAuthorBooks() {
		authorExpanded = !authorExpanded;
		if (authorExpanded) void loadAuthorBooks();
	}

	onDestroy(() => authorController?.abort());

	// Existing recommendation evidence remains private, account-scoped, and separate from
	// public catalog characteristics. No new match-score or similarity contract is assumed.
	$effect(() => {
		const token = $authStore.session?.access_token;
		const bookId = book.book_id;
		const ready = libraryReady && hasReadingHistory;
		referenceBooks = [];
		referencesStatus = 'idle';
		if (!token || !ready) return;
		const controller = new AbortController();
		referencesStatus = 'loading';
		void fetch(resolve('/api/recommendations/unique'), {
			headers: { Authorization: `Bearer ${token}` },
			signal: controller.signal
		})
			.then(async (response) => {
				if (!response.ok) throw new Error('Unable to load reference books');
				const payload: RecommendationsUniquePayload = await response.json();
				if (controller.signal.aborted) return;
				referenceBooks = payload.likedBookPrecedentsByBookId?.[bookId] ?? [];
				referencesStatus = 'ready';
			})
			.catch(() => {
				if (!controller.signal.aborted) referencesStatus = 'error';
			});
		return () => controller.abort();
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

{#snippet bookLink(item: Book)}
	<a class="mini-book" href={resolve(bookPath(item))}>
		{#if item.coverUrl}
			<img
				src={item.coverUrl}
				alt=""
				loading="lazy"
				onerror={(event) => {
					(event.currentTarget as HTMLImageElement).style.display = 'none';
				}}
			/>
		{:else}
			<span class="mini-cover"><BookOpen size={22} aria-hidden="true" /></span>
		{/if}
		<span><strong>{item.title}</strong><span class="muted">{item.author}</span></span>
	</a>
{/snippet}

<article class="book-page">
	<LibraryLoadNotice collections={['ratings', 'bookmarks', 'dismissals']} />
	<div class="book-layout">
		<div class="cover-column">
			<div class="book-cover">
				{#if book.coverUrl && !coverFailed}
					<img
						src={book.coverUrl}
						alt={`Cover of ${book.title}`}
						fetchpriority="high"
						onerror={() => (coverFailed = true)}
					/>
				{:else}
					<div class="cover-fallback">
						<BookOpen size={40} aria-hidden="true" /><span>{book.title}</span><small
							>{book.author}</small
						>
					</div>
				{/if}
			</div>
			<div class="library-actions">
				<button
					class="action-button save-button"
					disabled={!actionReady('dismissal')}
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
					disabled={!libraryReady}
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
								>Clear</button
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
					<section id="author-books" class="author-books" aria-label={`More by ${book.author}`}>
						<h2 class="eyebrow">More by {book.author}</h2>
						{#if authorBooksStatus === 'loading'}
							<p class="muted" role="status">Loading other books…</p>
						{:else if authorBooksStatus === 'error'}
							<p class="muted" role="alert">Couldn’t load other books by this author.</p>
							<button class="text-button" onclick={() => void loadAuthorBooks()}>Retry</button>
						{:else if authorBooks.length}
							<div class="author-cover-grid">
								{#each authorBooks as item (item.book_id)}
									<a
										class="author-book-cover"
										href={resolve(bookPath(item))}
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
								{/each}
							</div>
							{#if authorBooksTruncated}<p class="muted">
									Showing the first 48 other books in this catalog.
								</p>{/if}
						{:else}<p class="muted">
								No other books by this author are available in the catalog yet.
							</p>{/if}
					</section>
				{/if}
			{:else}<p class="muted">Author information coming soon</p>{/if}

			<ul class="metadata" aria-label="Book details">
				<li>{book.year || 'Publication year coming soon'}</li>
				{#if book.type}<li>{book.type}</li>{/if}
				{#each book.genres ?? [] as genre (genre)}<li>{genre}</li>{/each}
				{#if !book.genres?.length}<li>Genre information coming soon</li>{/if}
			</ul>
			{#if characteristics.labels.length || qualityLabel}
				<ul class="metadata book-highlights" aria-label="Book characteristics and distinctions">
					{#each characteristics.labels as characteristic (characteristic.label)}
						<li>{characteristic.label}</li>
					{/each}
					{#if qualityLabel}<li>{qualityLabel}</li>{/if}
				</ul>
			{/if}
			<p class="muted series-placeholder">Series information coming soon</p>
			<div class="synopsis">
				{#if book.summary?.trim()}<p>{book.summary}</p>{:else}<p class="muted">
						Synopsis coming soon
					</p>{/if}
			</div>
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

				<h2 class="reference-heading">Similar to books you’ve enjoyed</h2>
				{#if !libraryReady || referencesStatus === 'loading'}<p class="muted" role="status">
						Loading reference books…
					</p>
				{:else if likedReferences.length}
					<div class="reference-books">
						{#each likedReferences as item (item.book_id)}{@render bookLink(item)}{/each}
					</div>
				{:else if referencesStatus === 'error'}<p class="muted">
						Reference books are temporarily unavailable.
					</p>
				{:else}<p class="muted">Book connections coming soon</p>{/if}
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

		<div class="discovery-sections">
			<section aria-labelledby="similar-title">
				<h2 id="similar-title">Similar experience</h2>
				<p class="muted">Different stories, a similar reading experience.</p>
				<div class="discovery-placeholder">
					<BookOpen size={24} aria-hidden="true" />
					<p>Similar-experience recommendations coming soon</p>
				</div>
			</section>
			<section aria-labelledby="different-title">
				<h2 id="different-title">A different direction</h2>
				<p class="muted">Explore a departure with a meaningful connection to this book.</p>
				<div class="discovery-placeholder">
					<BookOpen size={24} aria-hidden="true" />
					<p>Different-direction recommendations coming soon</p>
				</div>
			</section>
		</div>
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
	.series-placeholder {
		margin-block: 0.5rem 1.5rem;
	}
	.synopsis {
		font-size: 1.15rem;
		line-height: 1.65;
		white-space: pre-line;
	}
	.synopsis p {
		margin: 0;
	}
	.book-highlights {
		margin-top: 0.75rem;
		color: var(--color-text);
		font-weight: 500;
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
	.reference-heading {
		font-size: 1.2rem;
		margin-top: 1.75rem;
	}
	.reference-books {
		display: grid;
		gap: 1rem;
		margin-block: 1rem;
	}
	.mini-book {
		display: flex;
		align-items: start;
		gap: 0.7rem;
		text-decoration: none;
		min-width: 0;
	}
	.mini-book img,
	.mini-cover {
		width: 3.2rem;
		aspect-ratio: 2 / 3;
		object-fit: cover;
		border-radius: var(--radius-sm);
		flex-shrink: 0;
	}
	.mini-cover {
		display: grid;
		place-items: center;
		background: var(--color-bg-muted);
	}
	.mini-book strong {
		display: block;
		font-family: var(--font-family-content);
		font-size: 1rem;
		font-weight: 400;
	}
	.mini-book .muted {
		display: block;
		font-size: 0.75rem;
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
	.premium-panel h2,
	.discovery-sections h2 {
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
	.discovery-sections {
		grid-column: 1 / 3;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--color-border);
	}
	.discovery-sections > section + section {
		border-left: 1px solid var(--color-border);
		padding-left: 1.5rem;
	}
	.discovery-placeholder {
		display: flex;
		align-items: center;
		gap: 1rem;
		min-height: 7rem;
		padding: 1rem;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		font-family: var(--font-family-interactive);
		font-size: 0.85rem;
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
		.discovery-sections {
			grid-column: 1 / -1;
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
		.personal-column,
		.discovery-sections {
			grid-column: 1;
			grid-template-columns: 1fr;
		}
		.discovery-sections > section + section {
			border-left: 0;
			border-top: 1px solid var(--color-border);
			padding: 1.5rem 0 0;
		}
		.profile-panel,
		.premium-panel {
			padding: 1rem;
		}
	}
</style>
