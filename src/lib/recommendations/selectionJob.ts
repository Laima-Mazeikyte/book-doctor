import { RequestTimeoutError, wait, withTimeout } from '$lib/requests/timeout';
import type { Book } from '$lib/types/book';
import type { SelectionPending, SelectionRun } from './bookSelection';
import { sameSelection } from './bookSelection';
import type { FetchRecommendationsResult } from './fetchRecommendations';

export const SELECTION_TIMEOUT_MS = 10_000;
export const SELECTION_SLOW_MS = 4000;
export const SELECTION_POLL_MS = 500;

export class SelectionJobError extends Error {
	constructor(public code: string) {
		super(code);
		this.name = 'SelectionJobError';
	}
}

export function selectionResultBooks(
	run: SelectionRun,
	payload: FetchRecommendationsResult,
	submitted: Book[]
): Book[] {
	const ranked = payload.books.slice(0, Math.min(10, run.result_count ?? 0));
	if (run.request_type !== 'rank_selection' || run.book_ids.length >= 10 || !ranked.length)
		return ranked;
	const returned = new Set(ranked.map((book) => book.book_id));
	const skipped = new Set(run.skipped_book_ids ?? []);
	return [
		...ranked,
		...submitted
			.filter((book) => skipped.has(book.book_id) && !returned.has(book.book_id))
			.sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }))
	];
}

type JobOptions = {
	pending: SelectionPending;
	signal: AbortSignal;
	submit?: (signal: AbortSignal) => Promise<string>;
	getStatus: (id: string, signal: AbortSignal) => Promise<SelectionRun>;
	getRecent: (signal: AbortSignal) => Promise<SelectionRun[]>;
	loadResults: (id: string, signal: AbortSignal) => Promise<FetchRecommendationsResult>;
	onPending: (pending: SelectionPending) => void;
	onRun: (run: SelectionRun) => void;
	onRecovering: (recovering: boolean) => void;
	visibilityTarget?: Document;
};

/** One bounded operation: never overlap status checks or resubmit an uncertain write. */
export function runSelectionJob(options: JobOptions) {
	return withTimeout(
		async (signal) => {
			let pending = { ...options.pending };
			let failures = 0;
			let wake: (() => void) | undefined;
			let visibleCheckRequested = false;
			const visibility = () => {
				if (options.visibilityTarget?.visibilityState !== 'visible') return;
				visibleCheckRequested = true;
				wake?.();
			};
			options.visibilityTarget?.addEventListener('visibilitychange', visibility);
			const delay = async (ms: number) => {
				if (visibleCheckRequested) {
					visibleCheckRequested = false;
					return;
				}
				const controller = new AbortController();
				const cancel = () => controller.abort(signal.reason);
				signal.addEventListener('abort', cancel, { once: true });
				wake = () => controller.abort();
				try {
					await wait(ms, controller.signal);
				} catch {
					if (signal.aborted) throw signal.reason;
				} finally {
					wake = undefined;
					visibleCheckRequested = false;
					signal.removeEventListener('abort', cancel);
				}
			};
			try {
				if (options.submit) {
					try {
						pending.public_id = await options.submit(signal);
						if (signal.aborted) throw signal.reason;
						options.onPending(pending);
					} catch (cause) {
						if (signal.aborted) throw signal.reason;
						if (isConfirmedError(cause)) throw cause;
						options.onRecovering(true);
					}
				}
				while (!signal.aborted) {
					try {
						if (!pending.public_id) {
							options.onRecovering(true);
							const recent = await options.getRecent(signal);
							if (signal.aborted) throw signal.reason;
							const found = recent.find(
								(run) =>
									!pending.excluded_ids?.includes(run.public_id) &&
									Date.parse(run.created_at) >= pending.since - 5000 &&
									sameSelection(run, pending)
							);
							if (!found) {
								await delay(SELECTION_POLL_MS);
								continue;
							}
							pending = { ...pending, public_id: found.public_id };
							options.onPending(pending);
						}
						const id = pending.public_id;
						if (!id) continue;
						const run = await options.getStatus(id, signal);
						if (signal.aborted) throw signal.reason;
						options.onRun(run);
						if (['failed', 'skipped'].includes(run.status))
							throw new SelectionJobError(run.error_code ?? 'failed');
						if (run.status === 'completed') {
							if (run.book_ids.every((id) => run.skipped_book_ids?.includes(id)))
								throw new SelectionJobError('no_usable_selection');
							const result = await options.loadResults(run.public_id, signal);
							if (signal.aborted) throw signal.reason;
							return { run, result };
						}
						failures = 0;
						options.onRecovering(false);
						await delay(SELECTION_POLL_MS);
					} catch (cause) {
						if (signal.aborted) throw signal.reason;
						if (cause instanceof SelectionJobError || isConfirmedError(cause)) throw cause;
						options.onRecovering(true);
						await delay(Math.min(SELECTION_POLL_MS * 2 ** ++failures, 4000));
					}
				}
				throw signal.reason;
			} finally {
				options.visibilityTarget?.removeEventListener('visibilitychange', visibility);
			}
		},
		{
			signal: options.signal,
			timeoutMs: SELECTION_TIMEOUT_MS - (Date.now() - options.pending.since)
		}
	);
}

function isConfirmedError(cause: unknown): boolean {
	const error = cause as { status?: number; notStarted?: boolean } | null;
	return Boolean(
		error?.notStarted || (error?.status && error.status < 500 && ![408, 429].includes(error.status))
	);
}

export { RequestTimeoutError };
