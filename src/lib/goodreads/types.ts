/**
 * Shared types for the Goodreads CSV import feature.
 *
 * Only `goodreads_id` + `rating` are ever sent to Supabase (see GoodreadsImportItem).
 * `title` / `author` stay in the browser purely to label the "couldn't find" list
 * after the map-server reports which ids it couldn't resolve.
 */

/** A rated row parsed from the CSV. Title/author are retained client-side only. */
export interface GoodreadsRow {
	goodreads_id: number;
	rating: number; // 1-5
	title: string;
	author: string;
}

/** The minimal payload written into a job row's `items` column. */
export interface GoodreadsImportItem {
	goodreads_id: number;
	rating: number;
}

export type ImportJobStatus = 'pending' | 'done' | 'error';

/** The result columns the frontend reads back off the job row. */
export interface ImportJobResult {
	status: ImportJobStatus;
	matched_count: number;
	unmatched: number[]; // goodreads_ids the map-server could not resolve
	error: string | null;
}
