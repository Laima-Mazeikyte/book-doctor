import Papa from 'papaparse';
import type { GoodreadsRow } from './types';

/** Goodreads columns. `Book Id` + `My Rating` presence is how we detect a Goodreads export. */
const COL_BOOK_ID = 'Book Id';
const COL_RATING = 'My Rating';
const COL_TITLE = 'Title';
const COL_AUTHOR = 'Author';
const COL_ORIG_YEAR = 'Original Publication Year';

/**
 * Metadata-only sources (StoryGraph, Hardcover). These exports carry no Goodreads/
 * catalog id and no reliable original-publication year, so goodreads_id and year go
 * to the backend as null and matching falls back to title + author. Ratings are 0–5
 * (fractional) → rounded/clamped to the 1–5 integer `user_ratings` accepts; a read
 * book with a blank rating defaults to 1. Rows are gated on a "read" status so
 * to-read / did-not-finish shelves don't become 1-star ratings.
 *
 * `marker` is the header that uniquely identifies the export for source detection.
 */
interface MetadataColumns {
	title: string;
	author: string;
	rating: string;
	status: string;
	marker: string;
}

const STORYGRAPH_COLS: MetadataColumns = {
	title: 'Title',
	author: 'Authors',
	rating: 'Star Rating',
	status: 'Read Status',
	marker: 'Star Rating'
};

const HARDCOVER_COLS: MetadataColumns = {
	title: 'Title',
	author: 'Author',
	rating: 'Rating',
	status: 'Status',
	marker: 'Hardcover Book ID'
};

/** All metadata-only sources, checked in order during detection. */
const METADATA_SOURCES: readonly MetadataColumns[] = [STORYGRAPH_COLS, HARDCOVER_COLS];

/** Status value (case-insensitive) a row must have to be imported from a metadata source. */
const READ_STATUS = 'read';

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

/**
 * Parse a StoryGraph `Star Rating` (e.g. "4.75", "3", "") into the 1–5 integer that
 * user_ratings accepts, rounding to nearest. Blank/unrated returns null so the row is
 * skipped (mirrors Goodreads' "unrated" handling). Any actual rating is clamped into
 * 1–5, so a low value like 0.25 (which rounds to 0) becomes 1 rather than being lost.
 */
function roundedStar(value: string | undefined): number | null {
	if (value == null) return null;
	const trimmed = value.trim();
	if (!/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) return null;
	const rounded = Math.round(Number(trimmed));
	return Math.min(5, Math.max(1, rounded));
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

function goodreadsToRow(raw: Record<string, string>): GoodreadsRow | null {
	const rating = strictInt(raw[COL_RATING]);

	// Goodreads writes 0 for "unrated", and user_ratings only accepts 1-5, so
	// unrated rows carry nothing to import.
	if (rating == null || rating < 1 || rating > 5) return null;

	const parsedId = strictInt(raw[COL_BOOK_ID]);
	const goodreads_id = parsedId != null && parsedId > 0 ? parsedId : null;

	const title = sanitizeDisplay(raw[COL_TITLE]);
	const author = sanitizeDisplay(raw[COL_AUTHOR]);

	// A row is matchable if it has a Book Id OR enough metadata (title + author)
	// for the map-server to fall back on. Drop rows with neither.
	if (goodreads_id == null && !(title && author)) return null;

	// Original Publication Year is optional — a missing/unparseable value is NA (null).
	const year = strictInt(raw[COL_ORIG_YEAR]);

	return { goodreads_id, rating, title, author, year };
}

function metadataRow(raw: Record<string, string>, cols: MetadataColumns): GoodreadsRow | null {
	// Only import books actually marked "read". Otherwise defaulting a blank rating
	// to 1 (below) would turn to-read / did-not-finish shelves into 1-star ratings.
	if ((raw[cols.status] ?? '').trim().toLowerCase() !== READ_STATUS) return null;

	const title = sanitizeDisplay(raw[cols.title]);
	const author = sanitizeDisplay(raw[cols.author]);

	// No catalog id in these exports, so a row is only matchable via metadata.
	if (!(title && author)) return null;

	// A read book with no explicit rating defaults to 1 (otherwise rounded 1–5).
	// No id and no publication year — both are NA to the backend.
	const rating = roundedStar(raw[cols.rating]) ?? 1;
	return { goodreads_id: null, rating, title, author, year: null };
}

/** Resolved header names for a user-provided CSV (title/author/rating required, year optional). */
interface CustomColumns {
	title: string;
	author: string;
	rating: string;
	year: string | null;
}

/**
 * Map a row from a user-provided CSV. Title, author and a 1–5 rating are required
 * (rows missing any are skipped); year is used only if a matching column exists.
 * No catalog id, so matching falls back to title + author (+ year when present).
 */
function customRow(raw: Record<string, string>, cols: CustomColumns): GoodreadsRow | null {
	const title = sanitizeDisplay(raw[cols.title]);
	const author = sanitizeDisplay(raw[cols.author]);
	if (!(title && author)) return null;

	// Rating is required here (no "read → 1" default): skip rows without a valid one.
	const rating = roundedStar(raw[cols.rating]);
	if (rating == null) return null;

	const year = cols.year ? strictInt(raw[cols.year]) : null;
	return { goodreads_id: null, rating, title, author, year };
}

/**
 * Case-insensitively resolve the first header matching any of `candidates`, returning
 * the actual header string (PapaParse keys rows by the exact header) or null.
 */
function resolveHeader(fields: string[], candidates: readonly string[]): string | null {
	const wanted = candidates.map((c) => c.toLowerCase());
	return fields.find((f) => wanted.includes(f.trim().toLowerCase())) ?? null;
}

/**
 * Pick the row mapper for the detected export, or null if the headers match none.
 * Goodreads is identified by `Book Id` + `My Rating`; each metadata source (StoryGraph,
 * Hardcover) by its unique `marker` header. A user-provided CSV is the last resort:
 * matched case-insensitively on Title + Author/Authors + Rating (Year optional).
 */
function pickRowMapper(
	fields: string[]
): ((raw: Record<string, string>) => GoodreadsRow | null) | null {
	if (fields.includes(COL_BOOK_ID) && fields.includes(COL_RATING)) return goodreadsToRow;

	for (const cols of METADATA_SOURCES) {
		if (fields.includes(cols.marker) && fields.includes(cols.title) && fields.includes(cols.author)) {
			return (raw) => metadataRow(raw, cols);
		}
	}

	const title = resolveHeader(fields, ['title']);
	const author = resolveHeader(fields, ['author', 'authors']);
	const rating = resolveHeader(fields, ['rating']);
	if (title && author && rating) {
		const cols: CustomColumns = { title, author, rating, year: resolveHeader(fields, ['year']) };
		return (raw) => customRow(raw, cols);
	}

	return null;
}

/**
 * Parse a Goodreads, StoryGraph, or Hardcover export — or a user-provided CSV
 * (Title + Author/Authors + Rating) — into rated rows.
 *
 * Uses PapaParse (header mode) so quoted commas, escaped quotes, and newlines
 * inside review/title/author fields are handled correctly. Rejects oversized
 * files, unrecognized files, and libraries larger than MAX_IMPORT_ITEMS.
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
				const mapRow = pickRowMapper(results.meta.fields ?? []);
				if (!mapRow) {
					reject(new GoodreadsCsvError('not_export'));
					return;
				}

				const data = results.data ?? [];
				const rows = data.flatMap((raw) => {
					const row = mapRow(raw);
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
