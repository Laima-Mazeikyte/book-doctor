<script lang="ts">
	import { onMount } from 'svelte';
	import { setOpenBugReportContext } from '$lib/bugReportContext';
	import { get } from 'svelte/store';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { PUBLIC_BUNNY_COVERS_BASE } from '$env/static/public';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { t } from '$lib/copy';
	import SkipLink from '$lib/components/SkipLink.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import AppFooter from '$lib/components/AppFooter.svelte';
	import BugReportModal from '$lib/components/BugReportModal.svelte';
	import { registerAnonymousSessionStarter } from '$lib/auth/anonymous-session';
	import { notifyLibraryPersistedMutationForBrowseFeedWarm, onAfterNavigateForBrowseFeedWarm } from '$lib/feed/browseFeedWarm';
	import { getSupabase } from '$lib/supabase';
	import { authStore, clearPasswordRecoveryFlag, passwordRecoveryActive } from '$lib/stores/auth';
	import { planToReadStore } from '$lib/stores/planToRead';
	import { ratingsStore } from '$lib/stores/ratings';
	import {
		recommendationsCountStore,
		refreshRecommendationsCountFromApi
	} from '$lib/stores/recommendationsCount';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import { bookmarksPageStore } from '$lib/stores/bookmarksPage';
	import { recommendationsPageStore } from '$lib/stores/recommendationsPage';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import {
		BOOK_GENRE_TYPE_SELECT,
		catalogTypeFromRow,
		genresFromGenreColumns,
		pickGenreTypeFields,
		type BookGenreSlotRow
	} from '$lib/book-catalog-fields';
	import type { Book, RatingValue } from '$lib/types/book';

	const coversBase = (PUBLIC_BUNNY_COVERS_BASE ?? '').replace(/\/$/, '');
	function coverUrlFor(cover_url: string | null | undefined, book_id: number | undefined): string | undefined {
		if (cover_url?.trim()) return cover_url;
		return coversBase && book_id != null ? `${coversBase}/${book_id}.avif` : undefined;
	}

	let { children } = $props();

	let bugModalOpen = $state(false);

	function openBugModal() {
		bugModalOpen = true;
	}

	function closeBugModal() {
		bugModalOpen = false;
	}

	setOpenBugReportContext(openBugModal);

	function skipToRateBottomBar(e: MouseEvent) {
		e.preventDefault();
		const el = document.getElementById('rate-bottom-bar');
		el?.scrollIntoView({ block: 'nearest' });
		el?.focus({ preventScroll: true });
	}

	/** Routes with `.book-card-grid` — drop main max-width so more columns fit on large screens */
	const isBookGridShell = $derived.by(() => {
		const pathname = page.url.pathname;
		return (
			pathname === '/my-bookshelf' ||
			pathname === '/not-interested' ||
			pathname === '/faq' ||
			pathname === '/rate' ||
			pathname.startsWith('/rate/')
		);
	});

	const showAppFooter = $derived.by(() => {
		const pathname = page.url.pathname;
		if (pathname === '/rate/recommendations') return true;
		return pathname !== '/rate' && !pathname.startsWith('/rate/');
	});

	/** Track if we had a user so we only reset ratings when they sign out, not on initial load. */
	let hadUserBefore = $state(false);
	let ratingsLoadRequestId = 0;
	let ratingsPersistenceUserId: string | null = null;

	function isStaleRatingsLoad(requestId: number): boolean {
		return requestId !== ratingsLoadRequestId;
	}

	function attachRatingsPersistence(supabase: SupabaseClient, userId: string): void {
		if (ratingsPersistenceUserId === userId) {
			void ratingsStore.flushPending();
			return;
		}

		ratingsPersistenceUserId = userId;
		ratingsStore.setPersistence({
			async set(bookIdNum, value) {
				const { error } = await supabase
					.from('user_ratings')
					.upsert(
						{
							user_id: userId,
							book_id: bookIdNum,
							book_rating: value,
							updated_at: new Date().toISOString()
						},
						{ onConflict: 'user_id,book_id' }
					);
				if (error) {
					console.error('[ratings] Failed to save rating:', error.message);
					throw error;
				}
				notifyLibraryPersistedMutationForBrowseFeedWarm();
			},
			async remove(bookIdNum) {
				const { error } = await supabase
					.from('user_ratings')
					.delete()
					.eq('user_id', userId)
					.eq('book_id', bookIdNum);
				if (error) {
					console.error('[ratings] Failed to remove rating:', error.message);
					throw error;
				}
				notifyLibraryPersistedMutationForBrowseFeedWarm();
			}
		});
	}

	async function loadUserRatingsAndPersistence(
		supabase: SupabaseClient,
		userId: string,
		requestId: number
	): Promise<void> {
		const { data: rows, error: ratingsError } = await supabase
			.from('user_ratings')
			.select(`book_id, book_rating, books(id, book_id, book_name, author, cover_url, year, summary, ${BOOK_GENRE_TYPE_SELECT})`)
			.eq('user_id', userId)
			.order('updated_at', { ascending: false });

		if (isStaleRatingsLoad(requestId)) return;

		if (ratingsError) {
			console.error('[ratings] Failed to load user ratings:', ratingsError.message);
			return;
		}

		const rawRows = rows ?? [];
		// Build bookId (UUID) for each row; app uses books.id (UUID) as key, not book_id (integer).
		const needBookIds = rawRows.some((row) => !(row as { books?: { id?: string } }).books?.id);
		let bookIdByNum: Record<number, string> = {};
		let fallbackBooks: Array<{
			id: string;
			book_id: number;
			book_name: string;
			author: string;
			cover_url?: string;
			year?: number;
			summary?: string | null;
		} & BookGenreSlotRow & { type?: string | null }> = [];
		if (needBookIds && rawRows.length > 0) {
			const bookIds = [...new Set(rawRows.map((r) => r.book_id))];
			const { data: bookRows } = await supabase
				.from('books')
				.select(`id, book_id, book_name, author, cover_url, year, summary, ${BOOK_GENRE_TYPE_SELECT}`)
				.in('book_id', bookIds);
			if (isStaleRatingsLoad(requestId)) return;
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
					year: b.year,
					summary: b.summary ?? undefined,
					...pickGenreTypeFields(b as BookGenreSlotRow & { type?: string | null })
				}));
			}
		}

		const detailsMap = new Map<string, Book>();

		const entries: Array<{ bookId: string; rating: RatingValue }> = rawRows.map((row) => {
			const rowWithBooks = row as {
				book_id: number;
				book_rating: number;
				books?: {
					id?: string;
					book_id?: number;
					book_name?: string;
					author?: string;
					cover_url?: string;
					year?: number;
					summary?: string | null;
				} & BookGenreSlotRow & { type?: string | null };
			};
			const uuid =
				rowWithBooks.books?.id != null
					? String(rowWithBooks.books.id)
					: bookIdByNum[rowWithBooks.book_id] ?? String(rowWithBooks.book_id);
			// So the rating list can show all rated books, store book details when we have them.
			if (rowWithBooks.books?.id != null && rowWithBooks.books?.book_name != null) {
				const b = rowWithBooks.books;
				const type = catalogTypeFromRow(b);
				detailsMap.set(uuid, {
					id: uuid,
					book_id: b.book_id,
					title: b.book_name ?? '',
					author: b.author ?? '',
					coverUrl: coverUrlFor(b.cover_url, b.book_id),
					year: b.year != null ? String(b.year) : undefined,
					summary: b.summary ?? undefined,
					genres: genresFromGenreColumns(b),
					...(type ? { type } : {})
				});
			} else if (fallbackBooks.length > 0) {
				const fb = fallbackBooks.find((f) => f.id === uuid || f.book_id === rowWithBooks.book_id);
				if (fb) {
					const type = catalogTypeFromRow(fb);
					detailsMap.set(uuid, {
						id: uuid,
						book_id: fb.book_id,
						title: fb.book_name,
						author: fb.author,
						coverUrl: coverUrlFor(fb.cover_url, fb.book_id),
						year: fb.year != null ? String(fb.year) : undefined,
						summary: fb.summary ?? undefined,
						genres: genresFromGenreColumns(fb),
						...(type ? { type } : {})
					});
				}
			}
			return {
				bookId: uuid,
				rating: rowWithBooks.book_rating as RatingValue
			};
		});

		if (isStaleRatingsLoad(requestId)) return;
		ratingsStore.hydrate(entries);
		ratingsStore.setRatedBooksDetails(detailsMap);

		// Load bookmarks and set persistence
		const { data: bmRows, error: bmError } = await supabase
			.from('user_bookmarks')
			.select('book_id')
			.eq('user_id', userId);
		if (isStaleRatingsLoad(requestId)) return;
		if (bmError) {
			console.error('[bookmarks] Failed to load bookmarks:', bmError.message);
		}
		if (bmRows?.length) {
			const bmBookIds = bmRows.map((r) => r.book_id).filter((id): id is number => id != null);
			const { data: bookRows } = await supabase
				.from('books')
				.select('id, book_id')
				.in('book_id', bmBookIds);
			if (isStaleRatingsLoad(requestId)) return;
			const ids = (bookRows ?? []).map((b) => String(b.id));
			const idToNum = new Map((bookRows ?? []).map((b) => [String(b.id), b.book_id]));
			planToReadStore.hydrate(ids, idToNum);
		} else {
			planToReadStore.hydrate([], new Map());
		}
		planToReadStore.setPersistence({
			add(bookIdNum) {
				supabase
					.from('user_bookmarks')
					.upsert({ user_id: userId, book_id: bookIdNum }, { onConflict: 'user_id,book_id' })
					.then(({ error }) => {
						if (error) console.error('[bookmarks] Failed to add:', error.message);
						else notifyLibraryPersistedMutationForBrowseFeedWarm();
					});
			},
			remove(bookIdNum) {
				supabase
					.from('user_bookmarks')
					.delete()
					.eq('user_id', userId)
					.eq('book_id', bookIdNum)
					.then(({ error }) => {
						if (error) console.error('[bookmarks] Failed to remove:', error.message);
						else notifyLibraryPersistedMutationForBrowseFeedWarm();
					});
			}
		});

		// Migrate any localStorage not-interested IDs into DB (anonymous → signed-in)
		const localNiIds: number[] = [];
		try {
			const raw = window.localStorage.getItem('book-doctor:not-interested');
			if (raw) {
				const arr = JSON.parse(raw) as unknown;
				if (Array.isArray(arr) && arr.every((x) => typeof x === 'number')) localNiIds.push(...arr);
			}
		} catch { /* ignore */ }
		if (localNiIds.length > 0) {
			await supabase
				.from('user_not_interested')
				.upsert(localNiIds.map((book_id) => ({ user_id: userId, book_id })), { onConflict: 'user_id,book_id' });
			try { window.localStorage.removeItem('book-doctor:not-interested'); } catch { /* ignore */ }
		}

		const { data: niRows } = await supabase
			.from('user_not_interested')
			.select('book_id')
			.eq('user_id', userId);
		if (isStaleRatingsLoad(requestId)) return;
		notInterestedStore.hydrate(
			(niRows ?? []).map((r) => r.book_id).filter((id): id is number => id != null)
		);

		notInterestedStore.setPersistence({
			add(bookIdNum) {
				supabase
					.from('user_not_interested')
					.upsert({ user_id: userId, book_id: bookIdNum }, { onConflict: 'user_id,book_id' })
					.then(({ error }) => {
						if (error) console.error('[not-interested] Failed to add:', error.message);
						else notifyLibraryPersistedMutationForBrowseFeedWarm();
					});
			},
			remove(bookIdNum) {
				supabase
					.from('user_not_interested')
					.delete()
					.eq('user_id', userId)
					.eq('book_id', bookIdNum)
					.then(({ error }) => {
						if (error) console.error('[not-interested] Failed to remove:', error.message);
						else notifyLibraryPersistedMutationForBrowseFeedWarm();
					});
			}
		});
	}

	async function getSessionAfterUrlTokens(supabase: SupabaseClient) {
		for (let attempt = 0; attempt < 10; attempt++) {
			const {
				data: { session }
			} = await supabase.auth.getSession();
			if (session) return session;
			if (
				typeof window === 'undefined' ||
				!window.location.hash.includes('access_token')
			) {
				break;
			}
			await new Promise((r) => setTimeout(r, 80));
		}
		const {
			data: { session }
		} = await supabase.auth.getSession();
		return session;
	}

	onMount(() => {
		ratingsStore.hydratePendingFromLocalStorage();
		notInterestedStore.hydrateFromLocalStorage();
		const supabaseClient = getSupabase();
		if (!supabaseClient) return;
		const supabase = supabaseClient;

		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((event, session) => {
			if (event === 'PASSWORD_RECOVERY') {
				passwordRecoveryActive.set(true);
			}
			authStore.setSession(session);
			if (session?.user) void ratingsStore.flushPending();
		});

		let authInitInFlight = false;

		async function ensureAnonymousSession(): Promise<boolean> {
			if (authInitInFlight) return !!get(authStore).session;
			authInitInFlight = true;
			try {
				const session = await getSessionAfterUrlTokens(supabase);
				if (session) {
					authStore.setSession(session);
					if (session.user) void ratingsStore.flushPending();
					return true;
				}

				if (get(authStore).session) return true;

				const { data: signInData, error } = await supabase.auth.signInAnonymously();

				if (!error && signInData?.session) {
					authStore.setSession(signInData.session);
					if (signInData.session.user) void ratingsStore.flushPending();
					if (signInData.user) {
						console.debug('[auth] Anonymous sign-in OK, user id:', signInData.user.id);
					}
					return true;
				}

				if (error) {
					console.error('[auth] Anonymous sign-in failed:', error.message, error);
				}

				const {
					data: { session: sessionAfterFail }
				} = await supabase.auth.getSession();
				if (sessionAfterFail) {
					authStore.setSession(sessionAfterFail);
					if (sessionAfterFail.user) void ratingsStore.flushPending();
					return true;
				}
				return !!get(authStore).session;
			} catch (e) {
				console.error('[auth] Lazy anonymous sign-in error', e);
				return !!get(authStore).session;
			} finally {
				authInitInFlight = false;
			}
		}

		registerAnonymousSessionStarter(ensureAnonymousSession);
		void (async () => {
			const session = await getSessionAfterUrlTokens(supabase);
			if (!session) return;
			authStore.setSession(session);
			if (session.user) void ratingsStore.flushPending();
		})();

		return () => {
			subscription.unsubscribe();
			registerAnonymousSessionStarter(null);
		};
	});

	afterNavigate(({ from, to }) => {
		if (
			from?.url.pathname === '/auth/reset-password' &&
			to?.url.pathname !== '/auth/reset-password'
		) {
			clearPasswordRecoveryFlag();
		}
		onAfterNavigateForBrowseFeedWarm(from?.url, to?.url);
	});

	$effect(() => {
		const session = $authStore.session;
		const user = $authStore.user;
		const supabase = typeof window !== 'undefined' ? getSupabase() : null;

		if (!supabase) return;

		const hasUser = !!(session && user);

		if (!hasUser) {
			ratingsLoadRequestId += 1;
			ratingsPersistenceUserId = null;
			ratingsStore.setPersistence(null);
			planToReadStore.setPersistence(null);
			notInterestedStore.setPersistence(null);
			bookmarksPageStore.reset();
			recommendationsPageStore.reset();
			recommendationsCountStore.set(0);
			if (hadUserBefore) {
				ratingsStore.reset();
				planToReadStore.reset();
				notInterestedStore.reset();
				notInterestedStore.clearLocalStorage();
			}
			hadUserBefore = false;
			return;
		}

		hadUserBefore = true;
		attachRatingsPersistence(supabase, user.id);
		const requestId = ++ratingsLoadRequestId;
		void loadUserRatingsAndPersistence(supabase, user.id, requestId);

		const token = session.access_token ?? null;

		// Load recommendations count for header
		if (token) void refreshRecommendationsCountFromApi(token);
	});

	// After anonymous→account migration, ratings are written server-side; reload them.
	onMount(() => {
		const handler = () => {
			const supabase = getSupabase();
			const user = get(authStore).user;
			if (supabase && user?.id) {
				attachRatingsPersistence(supabase, user.id);
				void ratingsStore.flushPending();
				const requestId = ++ratingsLoadRequestId;
				void loadUserRatingsAndPersistence(supabase, user.id, requestId);
			}
		};
		window.addEventListener('auth:ratings-migrated', handler);
		return () => window.removeEventListener('auth:ratings-migrated', handler);
	});

	onMount(() => {
		const retryQueuedRatings = () => {
			void ratingsStore.flushPending();
		};
		const handleVisibilityChange = () => {
			if (document.visibilityState === 'visible') retryQueuedRatings();
		};

		window.addEventListener('online', retryQueuedRatings);
		window.addEventListener('focus', retryQueuedRatings);
		document.addEventListener('visibilitychange', handleVisibilityChange);

		return () => {
			window.removeEventListener('online', retryQueuedRatings);
			window.removeEventListener('focus', retryQueuedRatings);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Beth+Ellen&family=Inter:wght@400;500;600&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<SkipLink />
{#if page.url.pathname === '/rate'}
	<a
		href="#rate-bottom-bar"
		class="skip-link skip-link--rate-bottom-bar"
		onclick={skipToRateBottomBar}
	>
		{t('rate.skipToBottomBar')}
	</a>
{/if}
<div class="app-chrome">
	<AppHeader onOpenBugReport={openBugModal} />
	<main
		id="main"
		class:rate-page={page.url.pathname === '/rate'}
		class:landing-page={page.url.pathname === '/'}
		class:main-book-grid-shell={isBookGridShell}
	>
		<div class="main-min">
			{@render children()}
		</div>
	</main>
	{#if showAppFooter}
		<AppFooter onOpenBugReport={openBugModal} />
	{/if}
</div>
<BugReportModal open={bugModalOpen} onClose={closeBugModal} />

<style>
	.app-chrome {
		display: flex;
		flex-direction: column;
		width: 100%;
		/* Matches AppHeader __inner: min-height 3.25rem + vertical padding (2× --space-3) */
		--app-header-chrome-height: 4.75rem;
	}
	.app-chrome :global(main) {
		min-width: 0;
		width: 100%;
	}
	.main-min {
		min-width: 0;
		min-height: calc(100dvh - var(--app-header-chrome-height));
	}
</style>
