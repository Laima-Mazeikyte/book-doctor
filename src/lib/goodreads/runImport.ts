import type { GoodreadsRow } from './types';
import { createImportJob, pollImportJob, type PollOptions } from './importJobs';

/**
 * Dispatched on the window after a successful import so the app reloads the
 * current user's library (ratings + details). The root layout listens for it.
 */
export const GOODREADS_IMPORT_COMPLETE_EVENT = 'goodreads:import-complete';

export interface ImportMiss {
	index: number;
	title: string;
	author: string;
}

export type ImportUiResult =
	| { kind: 'done'; imported: number; misses: ImportMiss[] }
	| { kind: 'timeout' }
	| { kind: 'error' };

/**
 * Map the map-server's `unmatched` row indices back to their title/author.
 *
 * The backend serializes `unmatched` as JSON, so an index may arrive as a number
 * or a string — Number() normalizes both. Any index outside `rows` is skipped
 * defensively (a malformed backend write shouldn't surface a blank miss).
 */
export function buildMisses(
	rows: GoodreadsRow[],
	unmatched: ReadonlyArray<number | string>
): ImportMiss[] {
	return unmatched.flatMap((raw) => {
		const index = Number(raw);
		const row = rows[index];
		if (!row) return [];
		return [{ index, title: row.title, author: row.author }];
	});
}

/**
 * Orchestrates a single import: send { index, goodreads_id, rating, title,
 * author, year } for the rated rows, poll for the map-server's result, then map
 * any unmatched indices back to their title/author so the UI can list what
 * couldn't be found.
 */
export async function runGoodreadsImport(
	userId: string,
	rows: GoodreadsRow[],
	poll?: PollOptions
): Promise<ImportUiResult> {
	const items = rows.map((row, index) => ({ index, ...row }));

	const { id, error } = await createImportJob(userId, items);
	if (error || !id) return { kind: 'error' };

	const outcome = await pollImportJob(id, poll);

	if (outcome.status === 'timeout') return { kind: 'timeout' };
	if (outcome.status === 'failed' || outcome.status === 'error') return { kind: 'error' };

	// status === 'done'
	const misses = buildMisses(rows, outcome.result.unmatched);

	if (typeof window !== 'undefined') {
		window.dispatchEvent(new Event(GOODREADS_IMPORT_COMPLETE_EVENT));
	}

	return { kind: 'done', imported: outcome.result.matched_count, misses };
}
