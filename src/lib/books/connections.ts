import type { SupabaseClient } from '@supabase/supabase-js';
import type { Book, RatingValue } from '$lib/types/book';

export interface BookConnection {
	book: Book;
	rating: RatingValue;
}

interface ConnectionMatch {
	book_id: string;
	similarity: number;
	rating: RatingValue;
}

interface ConnectionsResponse {
	book_id: string;
	release_id: string;
	status: 'computed' | 'target_unavailable';
	connections: ConnectionMatch[];
}

function parseResponse(data: unknown, bookId: string): ConnectionsResponse {
	const payload = data as ConnectionsResponse | null;
	if (
		!payload ||
		payload.book_id !== bookId ||
		typeof payload.release_id !== 'string' ||
		!['computed', 'target_unavailable'].includes(payload.status) ||
		!Array.isArray(payload.connections) ||
		payload.connections.length > 3 ||
		(payload.status === 'target_unavailable' && payload.connections.length > 0) ||
		payload.connections.some(
			(match) =>
				!match ||
				typeof match.book_id !== 'string' ||
				!match.book_id ||
				match.book_id === bookId ||
				!Number.isFinite(match.similarity) ||
				match.similarity < -1 ||
				match.similarity > 1 ||
				![1, 2, 3, 4, 5].includes(match.rating)
		) ||
		new Set(payload.connections.map((match) => match.book_id)).size !== payload.connections.length
	) {
		throw new Error('Invalid book connections response');
	}
	return payload;
}

/** A visit snapshot. Similarity selection and rating context belong to the RPC. */
export async function loadBookConnections(
	supabase: SupabaseClient,
	bookId: string,
	signal: AbortSignal,
	cachedBooks: Iterable<Book> = []
): Promise<BookConnection[]> {
	const { data, error } = await supabase
		.rpc('get_book_connections', { p_book_id: bookId, p_limit: 3 })
		.abortSignal(signal);
	if (error) throw new Error(error.message || 'Unable to load book connections');
	signal.throwIfAborted();
	const payload = parseResponse(data, bookId);
	if (payload.connections.length === 0) return [];

	const missing = new Set(payload.connections.map((match) => match.book_id));
	const books = new Map<string, Book>();
	for (const book of cachedBooks) {
		// Older library snapshots have titles/covers but no canonical URL.
		if (missing.has(book.book_id) && book.slug) {
			books.set(book.book_id, book);
			missing.delete(book.book_id);
		}
		if (!missing.size) break;
	}
	if (missing.size) {
		const { data: rows, error: metadataError } = await supabase
			.from('books')
			.select('id,book_id,slug,book_name,author')
			.in('book_id', [...missing])
			.abortSignal(signal);
		if (metadataError) throw new Error(metadataError.message || 'Unable to load connected books');
		signal.throwIfAborted();
		for (const row of rows ?? []) {
			if (
				typeof row.book_id === 'string' &&
				missing.has(row.book_id) &&
				typeof row.slug === 'string' &&
				row.slug &&
				typeof row.book_name === 'string' &&
				row.book_name &&
				typeof row.author === 'string'
			) {
				books.set(row.book_id, {
					id: String(row.id),
					book_id: row.book_id,
					slug: row.slug,
					title: row.book_name,
					author: row.author
				});
			}
		}
	}
	return payload.connections.flatMap((match) => {
		const book = books.get(match.book_id);
		return book ? [{ book, rating: match.rating }] : [];
	});
}
