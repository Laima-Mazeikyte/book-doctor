import Papa from 'papaparse';
import type { GoodreadsRow } from './types';

/** Columns we rely on. `Book Id` presence is how we sanity-check it's a Goodreads export. */
const COL_BOOK_ID = 'Book Id';
const COL_RATING = 'My Rating';
const COL_TITLE = 'Title';
const COL_AUTHOR = 'Author';

/** Reject files larger than this before parsing, so a giant upload can't OOM the tab. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Cap on rated rows we'll submit. Kept in sync with the DB CHECK on goodreads_import_jobs.items. */
export const MAX_IMPORT_ITEMS = 5_000;

/** Max length for a displayed title/author in the "couldn't find" list. */
const MAX_DISPLAY_LEN = 200;

/**
 * Code-point ranges stripped from displayed strings:
 * C0 controls, DEL + C1 controls, and bidi formatting/override chars
 * (LRM/RLM, embeddings/overrides, isolates, Arabic letter mark).
 * Expressed numerically to keep the source pure ASCII.
 */
const CONTROL_AND_BIDI_RANGES: ReadonlyArray<readonly [number, number]> = [
	[0x00, 0x1f],
	[0x7f, 0x9f],
	[0x200e, 0x200f],
	[0x202a, 0x202e],
	[0x2066, 0x2069],
	[0x061c, 0x061c]
];

function isControlOrBidi(codePoint: number): boolean {
	return CONTROL_AND_BIDI_RANGES.some(([lo, hi]) => codePoint >= lo && codePoint <= hi);
}

export type GoodreadsCsvErrorCode = 'not_export' | 'file_too_large' | 'too_many_rows';

export class GoodreadsCsvError extends Error {
	code: GoodreadsCsvErrorCode;
	constructor(code: GoodreadsCsvErrorCode) {
		super(code);
		this.name = 'GoodreadsCsvError';
		this.code = code;
	}
}

export interface ParsedGoodreadsCsv {
	/** Rated rows only (rating 1-5), each with a sanitized title/author for the miss list. */
	rows: GoodreadsRow[];
	/** Total data rows in the file (rated or not) — for "X of Y" messaging. */
	totalDataRows: number;
}

/** Strict non-negative integer parse — rejects "123abc", "1.5", " 3 " etc. (no lenient coercion). */
function strictInt(value: string | undefined): number | null {
	if (value == null) return null;
	const trimmed = value.trim();
	if (!/^[0-9]+$/.test(trimmed)) return null;
	const n = Number(trimmed);
	return Number.isSafeInteger(n) ? n : null;
}

/** Strip control/bidi chars, collapse whitespace, and cap length for safe display. */
function sanitizeDisplay(value: string | undefined): string {
	let out = '';
	for (const ch of value ?? '') {
		out += isControlOrBidi(ch.codePointAt(0) ?? 0) ? ' ' : ch;
	}
	const cleaned = out.replace(/[ \t\r\n]+/g, ' ').trim();
	return cleaned.length > MAX_DISPLAY_LEN ? `${cleaned.slice(0, MAX_DISPLAY_LEN)}…` : cleaned;
}

function toRow(raw: Record<string, string>): GoodreadsRow | null {
	const goodreads_id = strictInt(raw[COL_BOOK_ID]);
	const rating = strictInt(raw[COL_RATING]);

	// Keep only resolvable, actually-rated rows. Goodreads writes 0 for "unrated",
	// and user_ratings only accepts 1-5, so unrated rows carry nothing to import.
	if (goodreads_id == null || goodreads_id <= 0) return null;
	if (rating == null || rating < 1 || rating > 5) return null;

	return {
		goodreads_id,
		rating,
		title: sanitizeDisplay(raw[COL_TITLE]),
		author: sanitizeDisplay(raw[COL_AUTHOR])
	};
}

/**
 * Parse a Goodreads export CSV into rated rows.
 *
 * Uses PapaParse (header mode) so quoted commas, escaped quotes, and newlines
 * inside review/title/author fields are handled correctly. Rejects oversized
 * files, non-Goodreads files, and libraries larger than MAX_IMPORT_ITEMS.
 */
export function parseGoodreadsCsv(input: string | File): Promise<ParsedGoodreadsCsv> {
	return new Promise((resolve, reject) => {
		if (typeof File !== 'undefined' && input instanceof File && input.size > MAX_FILE_BYTES) {
			reject(new GoodreadsCsvError('file_too_large'));
			return;
		}

		// Parsed on the main thread: the 5 MB cap keeps this well under a second, and
		// papaparse's worker mode is unreliable under Vite bundling.
		Papa.parse<Record<string, string>>(input, {
			header: true,
			skipEmptyLines: true,
			complete: (results) => {
				const fields = results.meta.fields ?? [];
				if (!fields.includes(COL_BOOK_ID) || !fields.includes(COL_RATING)) {
					reject(new GoodreadsCsvError('not_export'));
					return;
				}

				const data = results.data ?? [];
				const rows = data.flatMap((raw) => {
					const row = toRow(raw);
					return row ? [row] : [];
				});

				if (rows.length > MAX_IMPORT_ITEMS) {
					reject(new GoodreadsCsvError('too_many_rows'));
					return;
				}

				resolve({ rows, totalDataRows: data.length });
			},
			error: (err: Error) => reject(err)
		});
	});
}
