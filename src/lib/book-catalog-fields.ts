/** PostgREST `select` fragment for catalog genre slots and `type` (see `public.books`). */
export const BOOK_GENRE_TYPE_SELECT =
	'genre1, genre2, genre3, genre4, genre5, genre6, genre7, type' as const;

export type BookGenreSlotRow = {
	genre1?: string | null;
	genre2?: string | null;
	genre3?: string | null;
	genre4?: string | null;
	genre5?: string | null;
	genre6?: string | null;
	genre7?: string | null;
};

const GENRE_SLOT_KEYS: (keyof BookGenreSlotRow)[] = [
	'genre1',
	'genre2',
	'genre3',
	'genre4',
	'genre5',
	'genre6',
	'genre7'
];

/** Non-empty genre labels in slot order (genre1 … genre7) for chips / lists. */
export function genresFromGenreColumns(row: BookGenreSlotRow): string[] | undefined {
	const out: string[] = [];
	for (const k of GENRE_SLOT_KEYS) {
		const v = row[k]?.trim();
		if (v) out.push(v);
	}
	return out.length ? out : undefined;
}

export function catalogTypeFromRow(row: { type?: string | null }): string | undefined {
	const t = row.type?.trim();
	return t || undefined;
}

/** Copy catalog genre slots + `type` for denormalized client payloads (e.g. rating fallbacks). */
export function pickGenreTypeFields(row: BookGenreSlotRow & { type?: string | null }) {
	return {
		genre1: row.genre1,
		genre2: row.genre2,
		genre3: row.genre3,
		genre4: row.genre4,
		genre5: row.genre5,
		genre6: row.genre6,
		genre7: row.genre7,
		type: row.type
	};
}
