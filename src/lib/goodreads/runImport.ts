import type { GoodreadsRow } from './types';
import { createImportJob, pollImportJob, type PollOptions } from './importJobs';

/**
 * Dispatched on the window after a successful import so the app reloads the
 * current user's library (ratings + details). The root layout listens for it.
 */
export const GOODREADS_IMPORT_COMPLETE_EVENT = 'goodreads:import-complete';

export interface ImportMiss {
	goodreads_id: number;
	title: string;
	author: string;
}

export type ImportUiResult =
	| { kind: 'done'; imported: number; misses: ImportMiss[] }
	| { kind: 'timeout' }
	| { kind: 'error' };

/**
 * Map the map-server's `unmatched` ids back to their in-memory title/author.
 *
 * Keyed on the string form of the id on both sides: `rows` carries numeric ids
 * (from strictInt), while the backend serializes `unmatched` as JSON — which may
 * arrive as numbers or strings. String-keying makes the lookup type-agnostic.
 */
export function buildMisses(
	rows: GoodreadsRow[],
	unmatched: ReadonlyArray<number | string>
): ImportMiss[] {
	const byId = new Map(rows.map((r) => [String(r.goodreads_id), r]));
	return unmatched.map((id) => {
		const row = byId.get(String(id));
		return { goodreads_id: Number(id), title: row?.title ?? '', author: row?.author ?? '' };
	});
}

/**
 * Orchestrates a single import: send { goodreads_id, rating } for the rated rows,
 * poll for the map-server's result, then map any unmatched ids back to the
 * in-memory title/author so the UI can list what couldn't be found.
 *
 * Titles/authors never leave the browser — `rows` is the retained parse output.
 */
export async function runGoodreadsImport(
	userId: string,
	rows: GoodreadsRow[],
	poll?: PollOptions
): Promise<ImportUiResult> {
	const items = rows.map(({ goodreads_id, rating }) => ({ goodreads_id, rating }));

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
