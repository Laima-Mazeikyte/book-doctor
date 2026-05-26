import { PUBLIC_BUNNY_COVERS_BASE } from '$env/static/public';
import {
	catalogTypeFromRow,
	genresFromGenreColumns,
	type BookGenreSlotRow
} from '$lib/book-catalog-fields';
import type { Book } from '$lib/types/book';

export type BookCatalogRow = {
	id: string;
	book_id: number;
	book_name: string | null;
	author: string | null;
	cover_url: string | null;
	summary: string | null;
	year: number | null;
} & BookGenreSlotRow & { type?: string | null };

export function mapBookRowToBook(row: BookCatalogRow): Book {
	const base = (PUBLIC_BUNNY_COVERS_BASE ?? '').replace(/\/$/, '');
	const type = catalogTypeFromRow(row);
	return {
		id: String(row.id),
		book_id: row.book_id,
		title: row.book_name ?? '',
		author: row.author ?? '',
		coverUrl: row.cover_url ?? (base ? `${base}/${row.book_id}.avif` : undefined),
		summary: row.summary ?? undefined,
		year: row.year != null ? String(row.year) : undefined,
		genres: genresFromGenreColumns(row),
		...(type ? { type } : {})
	};
}
