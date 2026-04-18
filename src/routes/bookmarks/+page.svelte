<script lang="ts">
	import { get } from 'svelte/store';
	import { authStore } from '$lib/stores/auth';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { ratingsStore } from '$lib/stores/ratings';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import { bookmarksPageStore } from '$lib/stores/bookmarksPage';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookCardSkeleton from '$lib/components/BookCardSkeleton.svelte';
	import { t } from '$lib/copy';
	import type { Book } from '$lib/types/book';

	const initialSnapshot = bookmarksPageStore.getSnapshot();

	let books = $state<Book[]>(initialSnapshot.books);
	let loading = $state(!initialSnapshot.loaded);
	let error = $state<string | null>(null);
	let loadRequestId = 0;

	$effect(() => {
		const session = $authStore.session;
		const token = session?.access_token ?? null;
		const snapshot = bookmarksPageStore.getSnapshot();

		const requestId = ++loadRequestId;
		if (!token) {
			error = null;
			books = snapshot.books;
			loading = false;
			return;
		}

		if (snapshot.loaded) {
			books = snapshot.books;
		}
		loading = !snapshot.loaded;
		error = null;

		fetch('/api/bookmarks', {
			headers: { Authorization: `Bearer ${token}` }
		})
			.then((res) => {
				if (!res.ok) throw new Error('Failed to load bookmarks');
				return res.json();
			})
			.then((data: { books: Book[] }) => {
				if (requestId !== loadRequestId) return;
				books = data.books ?? [];
				bookmarksPageStore.setBooks(books);
				error = null;
			})
			.catch((e) => {
				if (requestId !== loadRequestId) return;
				if (snapshot.loaded) {
					error = null;
					return;
				}
				error = e instanceof Error ? e.message : t('bookmarks.empty');
				books = [];
			})
			.finally(() => {
				if (requestId !== loadRequestId) return;
				loading = false;
			});
	});

	function handleBookmark(book: Book, id: string) {
		const wasBookmarked = planToReadStore.has(book.id);
		planToReadStore.toggle(id, book.book_id);
		if (!wasBookmarked && book.book_id != null) {
			notInterestedStore.remove(book.book_id);
		}
		if (wasBookmarked) {
			books = books.filter((b) => b.id !== book.id);
			bookmarksPageStore.removeBook(book.id);
		}
	}

	function handleNotInterested(book: Book) {
		const bid = book.book_id ?? 0;
		const wasNotInterested = notInterestedStore.has(bid);
		const nowNotInterested = notInterestedStore.toggle(bid);
		if (nowNotInterested && !wasNotInterested) {
			if (planToReadStore.has(book.id)) {
				planToReadStore.toggle(book.id, book.book_id);
				books = books.filter((b) => b.id !== book.id);
				bookmarksPageStore.removeBook(book.id);
			}
			if (get(ratingsStore).has(book.id)) {
				ratingsStore.removeRating(book.id, book.book_id);
			}
		}
	}
</script>

<div class="bookmarks-page">
	<h1 class="bookmarks-page__title typ-display2">{t('bookmarks.title')}</h1>
	{#if loading}
		<section class="bookmarks-page__books" aria-labelledby="bookmarks-books-heading">
			<h2 id="bookmarks-books-heading" class="bookmarks-page__books-heading typ-body">
				{t('bookmarks.allTitles')}
			</h2>
			<ul class="bookmarks-page__list book-card-grid" aria-busy="true" aria-label={t('bookmarks.title')}>
				{#each Array(6) as _, index (index)}
					<li><BookCardSkeleton /></li>
				{/each}
			</ul>
		</section>
	{:else if error}
		<p class="bookmarks-page__error" role="alert">{error}</p>
	{:else if books.length === 0}
		<p class="bookmarks-page__empty">{t('bookmarks.empty')}</p>
	{:else}
		<section class="bookmarks-page__books" aria-labelledby="bookmarks-books-heading">
			<h2 id="bookmarks-books-heading" class="bookmarks-page__books-heading typ-body">
				{t('shared.listBookCount', { count: books.length })}{books.length === 1
					? ''
					: t('shared.listBookCountPlural')}
			</h2>
			<ul class="bookmarks-page__list book-card-grid" aria-label={t('shared.recommendationCard.bookmark')}>
				{#each books as book (book.id)}
					<li>
						<BookCard
							context="bookmarks"
							{book}
							bookmarked={$planToReadStore.has(book.id)}
							onBookmark={(id) => handleBookmark(book, id)}
							currentRating={$ratingsStore.get(book.id) ?? null}
							onRate={(id, value) => ratingsStore.setRating(id, value, book.book_id, book)}
							onRemoveRating={(id) => ratingsStore.removeRating(id, book.book_id)}
							notInterested={$notInterestedStore.has(book.book_id ?? 0)}
							onNotInterested={() => handleNotInterested(book)}
						/>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<style>
	.bookmarks-page {
		padding-bottom: var(--space-8);
	}
	.bookmarks-page__title {
		margin: 0 0 var(--space-3) 0;
		text-align: center;
	}
	.bookmarks-page__books-heading {
		font-weight: var(--font-weight-normal);
		margin: 0 0 var(--space-3) 0;
		text-align: center;
	}
	.bookmarks-page__empty,
	.bookmarks-page__error {
		color: var(--color-text-muted);
		margin: 0;
		text-align: center;
	}
	.bookmarks-page__error {
		color: var(--color-error-text);
	}
	.bookmarks-page__list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
</style>
