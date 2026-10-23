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
import { librarySaves } from '$lib/stores/librarySaves';
import { notInterestedStore } from '$lib/stores/notInterested';
import { planToReadStore } from '$lib/stores/planToRead';
import { ratingsStore } from '$lib/stores/ratings';
import { clearLibraryCache } from '$lib/stores/libraryCache';
import { markUserLibraryIdsStarted, scheduleUserLibraryDetailsLoad } from '$lib/stores/userLibrary';
import { libraryLoads } from '$lib/stores/libraryLoads';
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

function checkResult(result: {
	error: { message: string; code?: string } | null;
	status: number;
}): void {
	if (result.error)
		throw Object.assign(new Error(result.error.message), {
			status: result.status,
			code: result.error.code
		});
}

/** Attach all writers together, before any library read can fail. */
export function attachLibraryPersistence(
	supabase: SupabaseClient,
	userId: string,
	persistenceUserId: { current: string | null }
): void {
	if (persistenceUserId.current === userId) return;
	persistenceUserId.current = userId;
	ratingsStore.setPersistence(
		{
			async set(bookId, value, signal = new AbortController().signal) {
				checkResult(
					await supabase
						.from('user_ratings')
						.upsert(
							{
								user_id: userId,
								book_id: bookId,
								book_rating: value
							},
							{ onConflict: 'user_id,book_id' }
						)
						.abortSignal(signal)
				);
			},
			async remove(bookId, signal = new AbortController().signal) {
				checkResult(
					await supabase
						.from('user_ratings')
						.delete()
						.eq('user_id', userId)
						.eq('book_id', bookId)
						.abortSignal(signal)
				);
			}
		},
		userId
	);
	planToReadStore.setPersistence(
		{
			async add(bookId, signal = new AbortController().signal) {
				checkResult(
					await supabase
						.from('user_bookmarks')
						.upsert(
							{
								user_id: userId,
								book_id: bookId
							},
							{ onConflict: 'user_id,book_id' }
						)
						.abortSignal(signal)
				);
			},
			async remove(bookId, signal = new AbortController().signal) {
				checkResult(
					await supabase
						.from('user_bookmarks')
						.delete()
						.eq('user_id', userId)
						.eq('book_id', bookId)
						.abortSignal(signal)
				);
			}
		},
		userId
	);
	notInterestedStore.setPersistence(
		{
			async add(bookId, signal = new AbortController().signal) {
				checkResult(
					await supabase
						.from('user_not_interested')
						.upsert(
							{
								user_id: userId,
								book_id: bookId
							},
							{ onConflict: 'user_id,book_id' }
						)
						.abortSignal(signal)
				);
			},
			async remove(bookId, signal = new AbortController().signal) {
				checkResult(
					await supabase
						.from('user_not_interested')
						.delete()
						.eq('user_id', userId)
						.eq('book_id', bookId)
						.abortSignal(signal)
				);
			}
		},
		userId
	);
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
	isStale: () => boolean,
	signal: AbortSignal
): Promise<Record<string, string>> {
	const ulids = unresolvedBookUlids(rows);
	if (ulids.length === 0) return {};
	return fetchUuidByUlid(supabase, ulids, isStale, signal);
}

export async function loadUserLibraryIds(
	supabase: SupabaseClient,
	userId: string,
	requestId: number,
	coordinator: LibraryLoadCoordinator
): Promise<void> {
	const isCurrent = () => !coordinator.isStale(requestId) && librarySaves.getOwner() === userId;
	if (!isCurrent()) return;
	libraryLoads.register(
		userId,
		'ratings',
		async (signal) => {
			const readRevision = librarySaves.getRevision();
			const result = await supabase
				.from('user_ratings')
				.select('book_id, book_rating, books(id, book_id)')
				.order('updated_at', { ascending: false })
				.order('book_id', { ascending: true })
				.eq('user_id', userId)
				.abortSignal(signal);
			checkResult(result);
			const rows = (result.data ?? []) as unknown as RatingIdRow[];
			const mapping = await resolveUuidMapForRows(supabase, rows, () => !isCurrent(), signal);
			const entries = rows.map((row) => {
				const bookId = bookUuidFromJoinRow(row, mapping);
				if (!bookId) throw new Error('Could not resolve a rated book.');
				return { bookId, rating: row.book_rating };
			});
			return () => {
				ratingsStore.hydrate(entries, readRevision);
				scheduleUserLibraryDetailsLoad(userId);
			};
		},
		requestId,
		isCurrent
	);
	libraryLoads.register(
		userId,
		'bookmarks',
		async (signal) => {
			const readRevision = librarySaves.getRevision();
			const result = await supabase
				.from('user_bookmarks')
				.select('book_id, books(id, book_id)')
				.eq('user_id', userId)
				.abortSignal(signal);
			checkResult(result);
			const rows = (result.data ?? []) as unknown as BookIdJoinRow[];
			const mapping = await resolveUuidMapForRows(supabase, rows, () => !isCurrent(), signal);
			const resolved = rows.map((row) => {
				const uuid = bookUuidFromJoinRow(row, mapping);
				if (!uuid) throw new Error('Could not resolve a bookmarked book.');
				return { uuid, ulid: bookmarkUlidFromRow(row) };
			});
			return () =>
				planToReadStore.hydrate(
					resolved.map((row) => row.uuid),
					new Map(resolved.map((row) => [row.uuid, row.ulid])),
					readRevision
				);
		},
		requestId,
		isCurrent
	);
	libraryLoads.register(
		userId,
		'dismissals',
		async (signal) => {
			const readRevision = librarySaves.getRevision();
			const result = await supabase
				.from('user_not_interested')
				.select('book_id')
				.eq('user_id', userId)
				.abortSignal(signal);
			checkResult(result);
			return () =>
				notInterestedStore.hydrate(
					(result.data ?? [])
						.map((row) => row.book_id)
						.filter((id): id is string => typeof id === 'string'),
					readRevision
				);
		},
		requestId,
		isCurrent
	);
	await Promise.all(
		['ratings', 'bookmarks', 'dismissals'].map((kind) =>
			libraryLoads.load(kind as 'ratings' | 'bookmarks' | 'dismissals')
		)
	);
}

export async function loadUserLibraryDetails(
	supabase: SupabaseClient,
	userId: string,
	requestId: number,
	coordinator: LibraryLoadCoordinator
): Promise<void> {
	const isCurrent = () => !coordinator.isStale(requestId) && librarySaves.getOwner() === userId;
	if (!isCurrent()) return;
	libraryLoads.register(
		userId,
		'ratedDetails',
		(signal) => loadUserLibraryDetailsBody(supabase, userId, requestId, coordinator, signal),
		requestId,
		isCurrent
	);
	await libraryLoads.load('ratedDetails');
}

async function loadUserLibraryDetailsBody(
	supabase: SupabaseClient,
	userId: string,
	requestId: number,
	coordinator: LibraryLoadCoordinator,
	signal: AbortSignal
): Promise<() => void> {
	const isStale = () => coordinator.isStale(requestId) || librarySaves.getOwner() !== userId;
	const readRevision = librarySaves.getRevision();

	const {
		data: rows,
		error: ratingsError,
		status
	} = await supabase
		.from('user_ratings')
		.select(
			`book_id, book_rating, books(id, book_id, book_name, author, year, summary, ${BOOK_GENRE_TYPE_SELECT})`
		)
		.eq('user_id', userId)
		.order('updated_at', { ascending: false })
		.abortSignal(signal);

	if (isStale()) return () => {};

	if (ratingsError) throw Object.assign(new Error(ratingsError.message), { status });

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
		const { data: bookRows, error: bookError } = await supabase
			.from('books')
			.select(`id, book_id, book_name, author, year, summary, ${BOOK_GENRE_TYPE_SELECT}`)
			.in('book_id', unresolvedDetailUlids)
			.abortSignal(signal);
		if (bookError) throw bookError;
		if (isStale()) return () => {};
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
		if (!uuid) throw new Error('Could not resolve rated book details.');

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

	if (isStale()) return () => {};
	if (detailsMap.size !== rawRows.length)
		throw new Error('Some rated book details are unavailable.');
	return () => ratingsStore.setRatedBooksDetails(detailsMap, readRevision);
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
	attachLibraryPersistence(supabase, userId, persistenceUserId);
	void librarySaves.flush().catch(() => undefined);
	// Drop any stale (e.g. anonymous) library cache; the account's cache is rebuilt after this load.
	clearLibraryCache();
	hydratedForUserId.current = null;
	return startUserLibraryIdsLoad(supabase, userId, coordinator, hydratedForUserId);
}

export function resetUserLibraryOnSignOut(hadUserBefore: { current: boolean }): void {
	ratingsStore.setPersistence(null);
	planToReadStore.setPersistence(null);
	notInterestedStore.setPersistence(null);
	if (hadUserBefore.current) {
		ratingsStore.reset(true);
		planToReadStore.reset(true);
		notInterestedStore.reset(true);
		clearLibraryCache();
	}
	hadUserBefore.current = false;
}
