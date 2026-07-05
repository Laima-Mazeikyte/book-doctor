/**
 * Shared types for the Goodreads CSV import feature.
 *
 * Each item sent to Supabase carries `goodreads_id` (when present), `rating`, and
 * `title` / `author` / `year` so the map-server can fall back to a metadata match
 * for catalog books that have no goodreads_id (e.g. sourced from other databases).
 * Each item is tagged with its row `index`; the map-server reports back the indices
 * it couldn't resolve, which the frontend maps to the "couldn't find" list.
 */

/** A rated row parsed from the CSV. */
export interface GoodreadsRow {
	goodreads_id: number | null; // null when the export row has no Book Id
	rating: number; // 1-5
	title: string;
	author: string;
	year: number | null; // Original Publication Year, or null (NA) when absent
}

/** The payload written into a job row's `items` column, one per rated row. */
export interface GoodreadsImportItem {
	index: number; // row position; echoed back in `unmatched`
	goodreads_id: number | null;
	rating: number;
	title: string;
	author: string;
	year: number | null;
}

export type ImportJobStatus = 'pending' | 'done' | 'error';

/** The result columns the frontend reads back off the job row. */
export interface ImportJobResult {
	status: ImportJobStatus;
	matched_count: number;
	unmatched: number[]; // row indices the map-server could not resolve
	error: string | null;
}
