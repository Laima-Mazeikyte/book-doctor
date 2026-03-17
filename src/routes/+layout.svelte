<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { page } from '$app/stores';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import SkipLink from '$lib/components/SkipLink.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import { getSupabase } from '$lib/supabase';
	import { authStore } from '$lib/stores/auth';
	import { ratingsStore } from '$lib/stores/ratings';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import type { Book, RatingValue } from '$lib/types/book';

	let { children } = $props();

	/** Track if we had a user so we only reset ratings when they sign out, not on initial load. */
	let hadUserBefore = $state(false);

	async function loadUserRatingsAndPersistence(
		supabase: SupabaseClient,
		userId: string
	): Promise<void> {
		const { data: rows, error: ratingsError } = await supabase
			.from('user_ratings')
			.select('book_id, book_rating, books(id, book_id, book_name, author, cover_url, year)')
			.eq('user_id', userId);

		if (ratingsError) {
			console.error('[ratings] Failed to load user ratings:', ratingsError.message);
			return;
		}

		const rawRows = rows ?? [];
		// Build bookId (UUID) for each row; app uses books.id (UUID) as key, not book_id (integer).
		const needBookIds = rawRows.some((row) => !(row as { books?: { id?: string } }).books?.id);
		let bookIdByNum: Record<number, string> = {};
		let fallbackBooks: Array<{ id: string; book_id: number; book_name: string; author: string; cover_url?: string; year?: number }> = [];
		if (needBookIds && rawRows.length > 0) {
			const bookIds = [...new Set(rawRows.map((r) => r.book_id))];
			const { data: bookRows } = await supabase
				.from('books')
				.select('id, book_id, book_name, author, cover_url, year')
				.in('book_id', bookIds);
			if (bookRows) {
				bookIdByNum = Object.fromEntries(
					bookRows.map((b) => [b.book_id, String(b.id)])
				) as Record<number, string>;
				fallbackBooks = bookRows.map((b) => ({
					id: String(b.id),
					book_id: b.book_id,
					book_name: b.book_name ?? '',
					author: b.author ?? '',
					cover_url: b.cover_url ?? undefined,
					year: b.year
				}));
			}
		}

		const detailsMap = new Map<string, Book>();

		const entries: Array<{ bookId: string; rating: RatingValue }> = rawRows.map((row) => {
			const rowWithBooks = row as {
				book_id: number;
				book_rating: number;
				books?: { id?: string; book_id?: number; book_name?: string; author?: string; cover_url?: string; year?: number };
			};
			const uuid =
				rowWithBooks.books?.id != null
					? String(rowWithBooks.books.id)
					: bookIdByNum[rowWithBooks.book_id] ?? String(rowWithBooks.book_id);
			// So the rating list can show all rated books, store book details when we have them.
			if (rowWithBooks.books?.id != null && rowWithBooks.books?.book_name != null) {
				const b = rowWithBooks.books;
				detailsMap.set(uuid, {
					id: uuid,
					book_id: b.book_id,
					title: b.book_name,
					author: b.author ?? '',
					coverUrl: b.cover_url ?? undefined,
					year: b.year != null ? String(b.year) : undefined
				});
			} else if (fallbackBooks.length > 0) {
				const fb = fallbackBooks.find((f) => f.id === uuid || f.book_id === rowWithBooks.book_id);
				if (fb) {
					detailsMap.set(uuid, {
						id: uuid,
						book_id: fb.book_id,
						title: fb.book_name,
						author: fb.author,
						coverUrl: fb.cover_url,
						year: fb.year != null ? String(fb.year) : undefined
					});
				}
			}
			return {
				bookId: uuid,
				rating: rowWithBooks.book_rating as RatingValue
			};
		});

		ratingsStore.hydrate(entries);
		ratingsStore.setRatedBooksDetails(detailsMap);

		ratingsStore.setPersistence({
			set(bookIdNum, value) {
				supabase
					.from('user_ratings')
					.upsert(
						{
							user_id: userId,
							book_id: bookIdNum,
							book_rating: value,
							updated_at: new Date().toISOString()
						},
						{ onConflict: 'user_id,book_id' }
					)
					.then(({ error }) => {
						if (error) console.error('[ratings] Failed to save rating:', error.message);
					});
			},
			remove(bookIdNum) {
				supabase
					.from('user_ratings')
					.delete()
					.eq('user_id', userId)
					.eq('book_id', bookIdNum)
					.then(({ error }) => {
						if (error) console.error('[ratings] Failed to remove rating:', error.message);
					});
			}
		});
	}

	onMount(async () => {
		const supabase = getSupabase();
		if (!supabase) return;
		try {
			const { data: { session } } = await supabase.auth.getSession();
			if (!session) {
				const { data: signInData, error } = await supabase.auth.signInAnonymously();
				if (error) {
					console.error('[auth] Anonymous sign-in failed:', error.message, error);
					return;
				}
				authStore.setSession(signInData?.session ?? null);
				if (signInData?.user) {
					console.debug('[auth] Anonymous sign-in OK, user id:', signInData.user.id);
				}
			} else {
				authStore.setSession(session);
			}

			const { data: { subscription } } = supabase.auth.onAuthStateChange(
				(_event, session) => {
					authStore.setSession(session);
				}
			);

			return () => {
				subscription.unsubscribe();
			};
		} catch (e) {
			console.error('[auth] Auth setup error', e);
		}
	});

	$effect(() => {
		const session = $authStore.session;
		const user = $authStore.user;
		const supabase = typeof window !== 'undefined' ? getSupabase() : null;

		if (!supabase) return;

		const hasUser = !!(session && user);

		if (!hasUser) {
			if (hadUserBefore) ratingsStore.reset();
			hadUserBefore = false;
			ratingsStore.setPersistence(null);
			return;
		}

		hadUserBefore = true;
		void loadUserRatingsAndPersistence(supabase, user.id);
	});

	// After anonymous→account migration, ratings are written server-side; reload them.
	onMount(() => {
		const handler = () => {
			const supabase = getSupabase();
			const user = get(authStore).user;
			if (supabase && user?.id) {
				void loadUserRatingsAndPersistence(supabase, user.id);
			}
		};
		window.addEventListener('auth:ratings-migrated', handler);
		return () => window.removeEventListener('auth:ratings-migrated', handler);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<SkipLink />
<AppHeader />
<main id="main" class:rate-page={$page.url.pathname === '/rate'}>
	{@render children()}
</main>
