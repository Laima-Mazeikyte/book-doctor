import {
	withTimeout,
	wait,
	RequestTimeoutError,
	LARGE_REQUEST_TIMEOUT_MS
} from '$lib/requests/timeout';
import { getSupabase } from '$lib/supabase';
import type { GoodreadsImportItem, ImportJobResult } from './types';

export const JOBS_TABLE = 'goodreads_import_jobs';

/** Poll defaults: a Goodreads import is a single bulk upsert server-side, so it finishes fast. */
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30_000;

const RESULT_COLUMNS = 'status, matched_count, unmatched, error';

function normalizeResult(row: {
	status: string;
	matched_count: number | null;
	unmatched: unknown;
	error: string | null;
}): ImportJobResult {
	return {
		status: row.status as ImportJobResult['status'],
		matched_count: row.matched_count ?? 0,
		unmatched: Array.isArray(row.unmatched) ? (row.unmatched as number[]) : [],
		error: row.error
	};
}

/**
 * Insert one job row for the current user and return its id.
 * `user_id` is passed explicitly (also enforced by RLS `user_id = auth.uid()`).
 */
export async function createImportJob(
	userId: string,
	items: GoodreadsImportItem[]
): Promise<{ id: string | null; error: Error | null }> {
	const supabase = getSupabase();
	if (!supabase) return { id: null, error: new Error('Supabase client not available') };

	try {
		const { data, error } = await withTimeout(
			(signal) =>
				supabase
					.from(JOBS_TABLE)
					.insert({ user_id: userId, items, status: 'pending' })
					.select('id')
					.abortSignal(signal)
					.single(),
			{ timeoutMs: LARGE_REQUEST_TIMEOUT_MS }
		);

		if (error) return { id: null, error: new Error(error.message) };
		return { id: data.id as string, error: null };
	} catch (error) {
		return { id: null, error: error instanceof Error ? error : new Error('Import unavailable') };
	}
}

/** One-shot read of a job's result columns. */
export async function fetchJobResult(
	id: string,
	signal?: AbortSignal
): Promise<{ result: ImportJobResult | null; error: Error | null }> {
	const supabase = getSupabase();
	if (!supabase) return { result: null, error: new Error('Supabase client not available') };

	const { data, error } = await withTimeout(
		(signal) =>
			supabase.from(JOBS_TABLE).select(RESULT_COLUMNS).eq('id', id).abortSignal(signal).single(),
		{ signal }
	);

	if (error) return { result: null, error: new Error(error.message) };
	return { result: normalizeResult(data), error: null };
}

export type PollOutcome =
	| { status: 'done' | 'error'; result: ImportJobResult }
	| { status: 'timeout' }
	| { status: 'failed'; error: Error };

export interface PollOptions {
	intervalMs?: number;
	timeoutMs?: number;
	/** Injectable for tests; defaults to setTimeout. */
	sleep?: (ms: number) => Promise<void>;
	/** Abort polling early (e.g. modal closed). */
	signal?: AbortSignal;
}

/**
 * Poll the job row until the map-server flips status to 'done'/'error', or we time out.
 * The job keeps running server-side after a timeout — callers surface a "still importing" state.
 */
export async function pollImportJob(id: string, options: PollOptions = {}): Promise<PollOutcome> {
	const { intervalMs = POLL_INTERVAL_MS, timeoutMs = POLL_TIMEOUT_MS, sleep, signal } = options;

	try {
		return await withTimeout(
			async (signal): Promise<PollOutcome> => {
				while (true) {
					if (signal?.aborted) return { status: 'timeout' };

					const { result, error } = await fetchJobResult(id, signal);
					signal.throwIfAborted();
					if (error) return { status: 'failed', error };
					if (result && result.status !== 'pending') {
						return { status: result.status, result };
					}

					if (sleep) await sleep(intervalMs);
					else await wait(intervalMs, signal);
				}
			},
			{ timeoutMs, signal }
		);
	} catch (error) {
		if (error instanceof RequestTimeoutError || signal?.aborted) return { status: 'timeout' };
		return {
			status: 'failed',
			error: error instanceof Error ? error : new Error('Unable to check import')
		};
	}
}
