import { getSupabase } from '$lib/supabase';
import { withTimeout } from '$lib/requests/timeout';
import { isStartingBookId } from './filteredRecommendations';
import { genresFromGenreColumns, type BookGenreSlotRow } from '$lib/book-catalog-fields';
import { normalizeKeywords } from '$lib/books/annotations';

export type StartingBook = {
	book_id: string;
	slug?: string;
	title: string;
	author: string;
	genres?: string[];
	keywords?: string[];
};

type StartingBookRow = BookGenreSlotRow & {
	book_id: string;
	slug: string;
	book_name: string;
	author: string;
} & Partial<Record<`keyword${number}`, unknown>>;

export const STARTING_BOOK_SELECT = [
	'book_id',
	'slug',
	'book_name',
	'author',
	...Array.from({ length: 7 }, (_, i) => `genre${i + 1}`),
	...Array.from({ length: 10 }, (_, i) => `keyword${i + 1}`)
].join(',');

/** Small public display lookup; the recommendation server resolves annotations itself. */
export async function loadStartingBooks(
	ids: string[],
	signal?: AbortSignal
): Promise<StartingBook[]> {
	const bookIds = [...new Set(ids.filter(isStartingBookId))];
	if (!bookIds.length) return [];
	return withTimeout(
		async (signal) => {
			const supabase = getSupabase();
			if (!supabase) throw new Error('Book lookup is unavailable.');
			const { data, error } = await supabase
				.from('books')
				.select(STARTING_BOOK_SELECT)
				.in('book_id', bookIds)
				.abortSignal(signal);
			if (error) throw error;
			return ((data ?? []) as unknown as StartingBookRow[]).map(startingBook);
		},
		{ signal }
	);
}

/** Slugs have a unique catalog index; resolve identity and picker metadata together. */
export async function loadStartingBookBySlug(
	slug: string,
	signal?: AbortSignal
): Promise<StartingBook | null> {
	if (!slug || slug.length > 2000 || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug)) return null;
	return withTimeout(
		async (signal) => {
			const supabase = getSupabase();
			if (!supabase) throw new Error('Book lookup is unavailable.');
			const { data, error } = await supabase
				.from('books')
				.select(STARTING_BOOK_SELECT)
				.eq('slug', slug)
				.abortSignal(signal)
				.maybeSingle();
			if (error) throw error;
			return data ? startingBook(data as unknown as StartingBookRow) : null;
		},
		{ signal }
	);
}

function startingBook(row: StartingBookRow): StartingBook {
	return {
		book_id: row.book_id,
		slug: row.slug,
		title: row.book_name,
		author: row.author,
		genres: genresFromGenreColumns(row) ?? [],
		keywords: normalizeKeywords(Array.from({ length: 10 }, (_, i) => row[`keyword${i + 1}`]))
	};
}
