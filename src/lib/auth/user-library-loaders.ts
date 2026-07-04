import {
	bookUuidFromJoinRow,
	bookmarkUlidFromRow,
	fetchUuidByUlid,
	type BookIdJoinRow
} from '$lib/auth/book-id-resolver';
import {
	BOOK_GENRE_TYPE_SELECT,
	catalogTypeFromRow,
	genresFromGenreColumns,
	pickGenreTypeFields,
	type BookGenreSlotRow
} from '$lib/book-catalog-fields';
import { coverUrlForBookId } from '$lib/book-cover';
import { notifyLibraryPersistedMutationForBrowseFeedWarm } from '$lib/feed/browseFeedWarm';
import { notInterestedStore } from '$lib/stores/notInterested';
import { planToReadStore } from '$lib/stores/planToRead';
import { ratingsStore } from '$lib/stores/ratings';
import {
	markUserLibraryDetailsReady,
	markUserLibraryIdsReady,
	markUserLibraryIdsStarted
} from '$lib/stores/userLibrary';
import type { Book, RatingValue } from '$lib/types/book';
import type { SupabaseClient } from '@supabase/supabase-js';

type RatingIdRow = BookIdJoinRow & {
	book_rating: RatingValue;
};

export type LibraryLoadCoordinator = {
	nextRequest(): number;
	isStale(requestId: number): boolean;
};

export function createLibraryLoadCoordinator(): LibraryLoadCoordinator {
	let requestId = 0;
	return {
		nextRequest() {
			return ++requestId;
		},
		isStale(id: number) {
			return id !== requestId;
		}
	};
}

function attachBookmarkPersistence(supabase: SupabaseClient, userId: string): void {
	planToReadStore.setPersistence({
		add(bookId) {
			supabase
				.from('user_bookmarks')
				.upsert({ user_id: userId, book_id: bookId }, { onConflict: 'user_id,book_id' })
				.then(({ error }) => {
					if (error) console.error('[bookmarks] Failed to add:', error.message);
					else notifyLibraryPersistedMutationForBrowseFeedWarm();
				});
		},
		remove(bookId) {
			supabase
				.from('user_bookmarks')
				.delete()
				.eq('user_id', userId)
				.eq('book_id', bookId)
				.then(({ error }) => {
					if (error) console.error('[bookmarks] Failed to remove:', error.message);
					else notifyLibraryPersistedMutationForBrowseFeedWarm();
				});
		}
	});
}

function attachNotInterestedPersistence(supabase: SupabaseClient, userId: string): void {
	notInterestedStore.setPersistence({
		add(bookId) {
			supabase
				.from('user_not_interested')
				.upsert({ user_id: userId, book_id: bookId }, { onConflict: 'user_id,book_id' })
				.then(({ error }) => {
					if (error) console.error('[not-interested] Failed to add:', error.message);
					else notifyLibraryPersistedMutationForBrowseFeedWarm();
				});
		},
		remove(bookId) {
			supabase
				.from('user_not_interested')
				.delete()
				.eq('user_id', userId)
				.eq('book_id', bookId)
				.then(({ error }) => {
					if (error) console.error('[not-interested] Failed to remove:', error.message);
					else notifyLibraryPersistedMutationForBrowseFeedWarm();
				});
		}
	});
}

export function attachRatingsPersistence(
	supabase: SupabaseClient,
	userId: string,
	persistenceUserId: { current: string | null }
): void {
	if (persistenceUserId.current === userId) {
		void ratingsStore.flushPending();
		return;
	}

	persistenceUserId.current = userId;
	ratingsStore.setPersistence({
		async set(bookId, value) {
			const { error } = await supabase.from('user_ratings').upsert(
				{
					user_id: userId,
					book_id: bookId,
					book_rating: value
					// updated_at is set by the set_user_ratings_updated_at trigger / column default
				},
				{ onConflict: 'user_id,book_id' }
			);
			if (error) {
				console.error('[ratings] Failed to save rating:', error.message);
				throw error;
			}
			notifyLibraryPersistedMutationForBrowseFeedWarm();
		},
		async remove(bookId) {
			const { error } = await supabase
				.from('user_ratings')
				.delete()
				.eq('user_id', userId)
				.eq('book_id', bookId);
			if (error) {
				console.error('[ratings] Failed to remove rating:', error.message);
				throw error;
			}
			notifyLibraryPersistedMutationForBrowseFeedWarm();
		}
	});
}

/**
 * ULIDs whose embedded `books(id, …)` join did not resolve — the subset that needs a
 * separate lookup. Empty on the common path where every row already carries `books.id`.
 * (book_id is declared integer but stored as ULID text; see the book_id type-drift note.)
 */
function unresolvedBookUlids(
	rows: Array<{ book_id: string; books?: { id?: unknown } | null }>
): string[] {
	if (rows.length === 0 || !rows.some((row) => !row.books?.id)) return [];
	return [...new Set(rows.map((row) => row.book_id))];
}

/**
 * ULID→UUID map for the rows whose join row lacked `books.id`. Empty (no extra query) when
 * nothing needs resolving. Used by the id-only loaders; the details loader needs full book
 * rows for its fallback and issues its own query off {@link unresolvedBookUlids}.
 */
async function resolveUuidMapForRows(
	supabase: SupabaseClient,
	rows: Array<{ book_id: string; books?: { id?: unknown } | null }>,
	isStale: () => boolean
): Promise<Record<string, string>> {
	const ulids = unresolvedBookUlids(rows);
	if (ulids.length === 0) return {};
	return fetchUuidByUlid(supabase, ulids, isStale);
}

export async function loadUserLibraryIds(
	supabase: SupabaseClient,
	userId: string,
	requestId: number,
	coordinator: LibraryLoadCoordinator
): Promise<void> {
	try {
		await loadUserLibraryIdsBody(supabase, userId, requestId, coordinator);
	} finally {
		if (!coordinator.isStale(requestId)) {
			markUserLibraryIdsReady(userId);
		}
	}
}

async function loadUserLibraryIdsBody(
	supabase: SupabaseClient,
	userId: string,
	requestId: number,
	coordinator: LibraryLoadCoordinator
): Promise<void> {
	const isStale = () => coordinator.isStale(requestId);

	const [ratingsResult, bookmarksResult, notInterestedResult] = await Promise.all([
		supabase
			.from('user_ratings')
			.select('book_id, book_rating, books(id, book_id)')
			// Drives the bookshelf "Newest" order: most recently rated/re-rated first, with
			// book_id as a stable tiebreaker so batch imports (shared updated_at) don't shuffle.
			.order('updated_at', { ascending: false })
			.order('book_id', { ascending: true })
			.eq('user_id', userId),
		supabase.from('user_bookmarks').select('book_id, books(id, book_id)').eq('user_id', userId),
		supabase.from('user_not_interested').select('book_id').eq('user_id', userId)
	]);

	if (isStale()) return;

	const { data: ratingRows, error: ratingsError } = ratingsResult;
	if (ratingsError) {
		console.error('[ratings] Failed to load user ratings:', ratingsError.message);
		return;
	}

	const rawRatingRows = (ratingRows ?? []) as unknown as RatingIdRow[];
	const ratingUuidByUlid = await resolveUuidMapForRows(supabase, rawRatingRows, isStale);
	if (isStale()) return;

	const ratingEntries = rawRatingRows.flatMap((row) => {
		const bookId = bookUuidFromJoinRow(row, ratingUuidByUlid);
		if (!bookId) {
			console.warn('[ratings] Skipping rating with unresolved book UUID for ULID:', row.book_id);
			return [];
		}
		return [{ bookId, rating: row.book_rating }];
	});
	ratingsStore.hydrate(ratingEntries);

	const { data: bmRows, error: bmError } = bookmarksResult;
	if (bmError) {
		console.error('[bookmarks] Failed to load bookmarks:', bmError.message);
	}

	const rawBookmarkRows = (bmRows ?? []) as unknown as BookIdJoinRow[];
	const bookmarkUuidByUlid = await resolveUuidMapForRows(supabase, rawBookmarkRows, isStale);
	if (isStale()) return;

	if (rawBookmarkRows.length > 0) {
		const resolvedBookmarks = rawBookmarkRows.flatMap((row) => {
			const uuid = bookUuidFromJoinRow(row, bookmarkUuidByUlid);
			if (!uuid) {
				console.warn(
					'[bookmarks] Skipping bookmark with unresolved book UUID for ULID:',
					row.book_id
				);
				return [];
			}
			return [{ uuid, ulid: bookmarkUlidFromRow(row) }];
		});
		const ids = resolvedBookmarks.map((entry) => entry.uuid);
		const idToUlid = new Map(resolvedBookmarks.map((entry) => [entry.uuid, entry.ulid]));
		planToReadStore.hydrate(ids, idToUlid);
	} else {
		planToReadStore.hydrate([], new Map());
	}
	attachBookmarkPersistence(supabase, userId);

	const { data: niRows } = notInterestedResult;
	notInterestedStore.hydrate(
		(niRows ?? []).map((r) => r.book_id).filter((id): id is string => typeof id === 'string')
	);
	attachNotInterestedPersistence(supabase, userId);
}

export async function loadUserLibraryDetails(
	supabase: SupabaseClient,
	userId: string,
	requestId: number,
	coordinator: LibraryLoadCoordinator
): Promise<void> {
	try {
		await loadUserLibraryDetailsBody(supabase, userId, requestId, coordinator);
	} finally {
		if (!coordinator.isStale(requestId)) {
			markUserLibraryDetailsReady(userId);
		}
	}
}

async function loadUserLibraryDetailsBody(
	supabase: SupabaseClient,
	userId: string,
	requestId: number,
	coordinator: LibraryLoadCoordinator
): Promise<void> {
	const isStale = () => coordinator.isStale(requestId);

	const { data: rows, error: ratingsError } = await supabase
		.from('user_ratings')
		.select(
			`book_id, book_rating, books(id, book_id, book_name, author, year, summary, ${BOOK_GENRE_TYPE_SELECT})`
		)
		.eq('user_id', userId)
		.order('updated_at', { ascending: false });

	if (isStale()) return;

	if (ratingsError) {
		console.error('[ratings] Failed to load rated book details:', ratingsError.message);
		return;
	}

	const rawRows = rows ?? [];
	const unresolvedDetailUlids = unresolvedBookUlids(
		rawRows as Array<{ book_id: string; books?: { id?: unknown } | null }>
	);
	let bookIdByUlid: Record<string, string> = {};
	let fallbackBooks: Array<
		{
			id: string;
			book_id: string;
			book_name: string;
			author: string;
			year?: number;
			summary?: string | null;
		} & BookGenreSlotRow & { type?: string | null }
	> = [];

	if (unresolvedDetailUlids.length > 0) {
		const { data: bookRows } = await supabase
			.from('books')
			.select(`id, book_id, book_name, author, year, summary, ${BOOK_GENRE_TYPE_SELECT}`)
			.in('book_id', unresolvedDetailUlids);
		if (isStale()) return;
		if (bookRows) {
			bookIdByUlid = Object.fromEntries(bookRows.map((b) => [b.book_id, String(b.id)])) as Record<
				string,
				string
			>;
			fallbackBooks = bookRows.map((b) => ({
				id: String(b.id),
				book_id: b.book_id,
				book_name: b.book_name ?? '',
				author: b.author ?? '',
				year: b.year,
				summary: b.summary ?? undefined,
				...pickGenreTypeFields(b as BookGenreSlotRow & { type?: string | null })
			}));
		}
	}

	const detailsMap = new Map<string, Book>();

	for (const row of rawRows) {
		const rowWithBooks = row as {
			book_id: string;
			book_rating: number;
			books?: {
				id?: string;
				book_id?: string;
				book_name?: string;
				author?: string;
				year?: number;
				summary?: string | null;
			} & BookGenreSlotRow & { type?: string | null };
		};
		const uuid =
			rowWithBooks.books?.id != null
				? String(rowWithBooks.books.id)
				: (bookIdByUlid[rowWithBooks.book_id] ?? null);
		if (!uuid) {
			console.warn(
				'[ratings] Skipping rated book details with unresolved UUID for ULID:',
				rowWithBooks.book_id
			);
			continue;
		}

		if (rowWithBooks.books?.id != null && rowWithBooks.books?.book_name != null) {
			const b = rowWithBooks.books;
			const detailBookId = b.book_id ?? rowWithBooks.book_id;
			const type = catalogTypeFromRow(b);
			detailsMap.set(uuid, {
				id: uuid,
				book_id: detailBookId,
				title: b.book_name ?? '',
				author: b.author ?? '',
				coverUrl: coverUrlForBookId(detailBookId),
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
					coverUrl: coverUrlForBookId(fb.book_id),
					year: fb.year != null ? String(fb.year) : undefined,
					summary: fb.summary ?? undefined,
					genres: genresFromGenreColumns(fb),
					...(type ? { type } : {})
				});
			}
		}
	}

	if (isStale()) return;
	ratingsStore.setRatedBooksDetails(detailsMap);
}

export function startUserLibraryIdsLoad(
	supabase: SupabaseClient,
	userId: string,
	coordinator: LibraryLoadCoordinator,
	hydratedForUserId: { current: string | null }
): number {
	hydratedForUserId.current = userId;
	const requestId = coordinator.nextRequest();
	markUserLibraryIdsStarted(userId);
	void loadUserLibraryIds(supabase, userId, requestId, coordinator);
	return requestId;
}

export function reloadUserLibraryAfterMigration(
	supabase: SupabaseClient,
	userId: string,
	coordinator: LibraryLoadCoordinator,
	hydratedForUserId: { current: string | null },
	persistenceUserId: { current: string | null }
): number {
	attachRatingsPersistence(supabase, userId, persistenceUserId);
	void ratingsStore.flushPending();
	hydratedForUserId.current = null;
	return startUserLibraryIdsLoad(supabase, userId, coordinator, hydratedForUserId);
}

export function resetUserLibraryOnSignOut(hadUserBefore: { current: boolean }): void {
	ratingsStore.setPersistence(null);
	planToReadStore.setPersistence(null);
	notInterestedStore.setPersistence(null);
	if (hadUserBefore.current) {
		ratingsStore.reset();
		planToReadStore.reset();
		notInterestedStore.reset();
		notInterestedStore.clearLocalStorage();
	}
	hadUserBefore.current = false;
}
