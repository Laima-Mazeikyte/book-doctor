import {
	catalogTypeFromRow,
	genresFromGenreColumns,
	type BookGenreSlotRow
} from '$lib/book-catalog-fields';
import { coverUrlForBookId } from '$lib/book-cover';
import type { Book } from '$lib/types/book';

export type BookCatalogRow = {
	id: string;
	book_id: string;
	book_name: string | null;
	author: string | null;
	summary: string | null;
	year: number | null;
} & BookGenreSlotRow & { type?: string | null };

export function mapBookRowToBook(row: BookCatalogRow): Book {
	const type = catalogTypeFromRow(row);
	return {
		id: String(row.id),
		book_id: row.book_id,
		title: row.book_name ?? '',
		author: row.author ?? '',
		coverUrl: coverUrlForBookId(row.book_id),
		summary: row.summary ?? undefined,
		year: row.year != null ? String(row.year) : undefined,
		genres: genresFromGenreColumns(row),
		...(type ? { type } : {})
	};
}
