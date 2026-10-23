<script lang="ts">
	import LibraryLoadNotice from '$lib/components/LibraryLoadNotice.svelte';
	import { resolve } from '$app/paths';
	import {
		Bookmark,
		BookOpen,
		ChevronDown,
		LockKeyhole,
		Share2,
		Star,
		ThumbsDown,
		Trophy
	} from 'lucide-svelte';
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
		authorBooks: Book[];
		authorBooksUnavailable: boolean;
		authorBooksTruncated: boolean;
		canonicalUrl: string;
		characteristics: ReturnType<typeof bookCharacteristics>;
	}
	let {
		book,
		authorBooks,
		authorBooksUnavailable,
		authorBooksTruncated,
		canonicalUrl,
		characteristics
	}: Props = $props();
	let coverFailed = $state(false);
	let authorExpanded = $state(false);
	let shareStatus = $state('');
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
		return $authReady && canUseLibraryAction(action, $authStore.user?.id, $userLibraryHydrationStore);
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

	async function shareBook() {
		shareStatus = '';
		try {
			if (navigator.share) {
				await navigator.share({
					title: book.title,
					text: `${book.title}${book.author ? ` by ${book.author}` : ''}`,
					url: canonicalUrl
				});
				shareStatus = 'Shared';
			} else {
				await navigator.clipboard.writeText(canonicalUrl);
				shareStatus = 'Link copied';
			}
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'AbortError'))
				shareStatus = 'Unable to share. Copy the book link below.';
		}
	}
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
	<div class="page-toolbar">
		<a class="back-link" href={resolve('/rate')}>Discover books</a>
		<button class="text-button" onclick={shareBook}
			><Share2 size={16} aria-hidden="true" /> Share</button
		>
	</div>
	<p class="share-status" role="status">{shareStatus}</p>

	<div class="book-layout">
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

		<div class="book-information">
			<p class="eyebrow">{book.type || book.genres?.[0] || 'Book'}</p>
			<h1 class="typ-display2">{book.title}</h1>
			{#if book.author}
				<button
					class="author-button"
					aria-expanded={authorExpanded}
					aria-controls="author-books"
					onclick={() => (authorExpanded = !authorExpanded)}
				>
					{book.author}<ChevronDown size={18} aria-hidden="true" />
				</button>
				{#if authorExpanded}
					<section id="author-books" class="author-books" aria-label={`More by ${book.author}`}>
						<h2 class="eyebrow">More by {book.author}</h2>
						{#if authorBooksUnavailable}
							<p class="muted">Other books are temporarily unavailable. Please try again later.</p>
						{:else if authorBooks.length}
							<div class="mini-book-grid">
								{#each authorBooks as item (item.book_id)}{@render bookLink(item)}{/each}
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
				{#each book.genres ?? [] as genre (genre)}<li>{genre}</li>{/each}
				{#if !book.genres?.length}<li>Genre information coming soon</li>{/if}
			</ul>
			<p class="muted series-placeholder">Series information coming soon</p>
			<div class="synopsis">
				{#if book.summary?.trim()}<p>{book.summary}</p>{:else}<p class="muted">
						Synopsis coming soon
					</p>{/if}
			</div>

			<section class="information-section" aria-labelledby="characteristics-title">
				<h2 id="characteristics-title" class="eyebrow">Reading characteristics</h2>
				{#if characteristics.labels.length}
					<ul class="characteristic-list" aria-label="Defining reading characteristics">
						{#each characteristics.labels.slice(0, 4) as characteristic (characteristic.label)}
							<li>
								<strong>{characteristic.label}</strong><span>{characteristic.description}</span>
							</li>
						{/each}
					</ul>
					{#if characteristics.labels.length > 4}
						<details>
							<summary>Show {characteristics.labels.length - 4} more characteristics</summary>
							<ul class="characteristic-list">
								{#each characteristics.labels.slice(4) as characteristic (characteristic.label)}<li>
										<strong>{characteristic.label}</strong><span>{characteristic.description}</span>
									</li>{/each}
							</ul>
						</details>
					{/if}
				{:else if characteristics.availableDimensions > 0}
					<p class="muted">No distinctive characteristics to highlight.</p>
				{/if}
				{#if characteristics.availableDimensions === 0}<p class="muted">
						Reading characteristics coming soon
					</p>
				{:else if characteristics.availableDimensions < characteristics.totalDimensions}<p
						class="muted"
					>
						Additional reading characteristics coming soon
					</p>{/if}
				<details>
					<summary>About reading characteristics</summary>
					<p>
						Highlights of the book’s pace, vocabulary, depth, originality, discussion potential,
						graphic violence, and explicit sexual content. Only distinctive characteristics receive
						labels.
					</p>
				</details>
			</section>

			<section class="information-section" aria-labelledby="distinctions-title">
				<h2 id="distinctions-title" class="eyebrow">Catalog distinctions</h2>
				{#if qualityLabel}<p class="distinction">
						<Trophy size={20} aria-hidden="true" />{qualityLabel}
					</p>
				{:else if !book.qualityBand}<p class="muted">Overall catalog standing coming soon</p>{/if}
				<p class="muted">
					Reader favorites, critical recognition, polarization, and popularity distinctions coming
					soon
				</p>
				<details>
					<summary>How distinctions work</summary>
					<p>
						Overall standing uses unread’s published catalog quality band. Individual distinctions
						will highlight exceptional standing in reader favorites, critical recognition,
						polarization, or popularity.
					</p>
					<a href={resolve('/lab/book-search')}>Explore book rankings in Lab →</a>
				</details>
			</section>
		</div>

		<aside class="personal-column" aria-label="Your reading profile and actions">
			<section class="profile-panel">
				<div class="panel-heading">
					<h2 class="eyebrow"><LockKeyhole size={14} aria-hidden="true" /> Your reading profile</h2>
					<span class="muted">Only you</span>
				</div>
				<p class="match-placeholder">Match score coming soon</p>
				{#if !libraryReady}<p class="muted" role="status">Loading your reading history…</p>
				{:else if !hasReadingHistory}<p class="muted">
						Rate at least 10 books to build your reading profile.
					</p>
					<a href={resolve('/rate')}>Rate books →</a>
				{:else}<p class="muted">
						Your ratings will help estimate how well this book fits your taste.
					</p>{/if}

				<h3 class="reference-heading">Connections to books you’ve enjoyed</h3>
				{#if !libraryReady || referencesStatus === 'loading'}<p class="muted" role="status">
						Loading reference books…
					</p>
				{:else if likedReferences.length}
					<div class="reference-books">
						{#each likedReferences as item (item.book_id)}{@render bookLink(item)}{/each}
					</div>
					<p class="muted">Reference points from your recommendation history.</p>
				{:else if referencesStatus === 'error'}<p class="muted">
						Reference books are temporarily unavailable.
					</p>
				{:else}<p class="muted">Book connections coming soon</p>{/if}

				<div class="library-actions">
					<button
						class="action-button save-button"
						disabled={!actionReady('dismissal')}
						aria-pressed={saved}
						onclick={() => toggleBookmarked(book)}
						><Bookmark size={18} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" /><LibrarySaveIndicator bookUlid={book.book_id} kind="bookmark" />{saved
							? 'Saved'
							: 'Save book'}</button
					>
					<fieldset disabled={!libraryReady}>
						<legend>{rating ? `Your rating: ${rating} of 5` : 'Rate this book'} <LibrarySaveIndicator bookUlid={book.book_id} kind="rating" /></legend>
						<div class="rating-stars">
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
						><ThumbsDown size={17} aria-hidden="true" /><LibrarySaveIndicator bookUlid={book.book_id} kind="dismissal" />{dismissed
							? 'Marked not interested'
							: 'Not interested'}</button
					>
				</div>
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
	<details class="share-link">
		<summary>Book link</summary>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- The server constructs this absolute canonical URL with the base path included. -->
		<a href={canonicalUrl}>{canonicalUrl}</a>
	</details>
</article>

<style>
	.book-page {
		max-width: 92rem;
		margin-inline: auto;
	}
	.page-toolbar,
	.panel-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}
	.page-toolbar {
		margin-bottom: 0.5rem;
	}
	a {
		color: var(--color-text);
		text-underline-offset: 0.2em;
	}
	.back-link,
	.text-button,
	.eyebrow,
	.metadata,
	.muted,
	details,
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
	.share-status {
		min-height: 1.25rem;
		margin: 0 0 1rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
		text-align: right;
	}
	.book-layout {
		display: grid;
		grid-template-columns: minmax(10rem, 0.65fr) minmax(0, 1.8fr) minmax(17rem, 1fr);
		gap: 2.5rem;
		align-items: start;
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
	.mini-book-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 1rem;
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
	.information-section {
		border-top: 1px solid var(--color-border);
		padding-top: 1.25rem;
		margin-top: 1.75rem;
	}
	.characteristic-list {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
		gap: 1rem;
		list-style: none;
		padding: 0;
		margin-block: 1rem;
	}
	.characteristic-list li {
		padding-left: 0.75rem;
		border-left: 2px solid var(--color-border);
	}
	.characteristic-list strong {
		display: block;
		font-weight: 500;
		margin-bottom: 0.25rem;
	}
	.characteristic-list span {
		display: block;
		font-family: var(--font-family-interactive);
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}
	.muted {
		color: var(--color-text-muted);
		line-height: 1.6;
	}
	details {
		color: var(--color-text-muted);
		line-height: 1.6;
	}
	summary {
		cursor: pointer;
		color: var(--color-text);
	}
	.distinction {
		display: flex;
		align-items: center;
		gap: 0.6rem;
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
	.panel-heading {
		align-items: start;
	}
	.panel-heading .muted {
		white-space: nowrap;
		font-size: 0.75rem;
	}
	.match-placeholder {
		font-size: 1.7rem;
		line-height: 1.25;
		margin: 1rem 0;
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
		border-top: 1px solid var(--color-border);
		margin-top: 1.25rem;
		padding-top: 1.25rem;
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
		padding: 0;
		margin: 0;
		border: 0;
	}
	legend {
		font-family: var(--font-family-interactive);
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin-bottom: 0.4rem;
	}
	.rating-stars {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	.star-button {
		display: grid;
		place-items: center;
		background: none;
		border: 0;
		padding: 0.5rem;
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
	.share-link {
		margin-top: 2rem;
		overflow-wrap: anywhere;
	}
	button:focus-visible,
	a:focus-visible,
	summary:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 4px;
	}
	@media (max-width: 1100px) {
		.book-layout {
			grid-template-columns: minmax(9rem, 0.55fr) minmax(0, 1.5fr);
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
