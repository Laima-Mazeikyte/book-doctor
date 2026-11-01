import {
	catalogTypeFromRow,
	genresFromGenreColumns,
	type BookGenreSlotRow
} from '$lib/book-catalog-fields';
import { coverUrlForBookId } from '$lib/book-cover';
import { normalizeQualityBand } from '$lib/qualityEvidence';
import type { Book } from '$lib/types/book';
import { catalogAnnotations } from '$lib/books/annotations';
import type { CharacteristicRow } from '$lib/books/characteristics';

export type BookCatalogRow = {
	id: string;
	book_id: string;
	slug?: string | null;
	book_name: string | null;
	author: string | null;
	summary: string | null;
	year: number | null;
} & BookGenreSlotRow &
	CharacteristicRow & {
		type?: string | null;
		quality_band?: string | null;
		book_ranking?: unknown;
		author_ranking?: unknown;
		awards?: unknown;
	};

export function mapBookRowToBook(row: BookCatalogRow): Book {
	if (
		typeof row.book_name !== 'string' ||
		!row.book_name.trim() ||
		typeof row.author !== 'string' ||
		!row.author.trim()
	) {
		throw new Error(`Invalid catalog identity for book ${row.book_id}`);
	}
	const annotations = catalogAnnotations(row);
	if (
		'awards' in row &&
		row.awards !== null &&
		(!Array.isArray(row.awards) || annotations.awards?.length !== row.awards.length)
	) {
		console.warn('[catalog] Invalid optional award entries omitted', { bookId: row.book_id });
	}
	const type = catalogTypeFromRow(row);
	return {
		id: String(row.id),
		book_id: row.book_id,
		...(row.slug ? { slug: row.slug } : {}),
		title: row.book_name ?? '',
		author: row.author ?? '',
		coverUrl: coverUrlForBookId(row.book_id),
		summary: row.summary ?? undefined,
		year: row.year != null ? String(row.year) : undefined,
		genres: genresFromGenreColumns(row),
		...(type ? { type } : {}),
		qualityBand: normalizeQualityBand(row.quality_band),
		...annotations
	};
}
