import { wait, withTimeout } from '$lib/requests/timeout';
import type { Book } from '$lib/types/book';
import type { SelectionRun } from './bookSelection';
import type { FetchRecommendationsResult } from './fetchRecommendations';
import { selectionResultBooks, SelectionJobError, SELECTION_POLL_MS } from './selectionJob';

export type CompletedSelection = {
	run: SelectionRun;
	books: Book[];
	result: FetchRecommendationsResult;
};

export class SelectionHistoryError extends SelectionJobError {
	constructor(
		public run: SelectionRun,
		public books: Book[]
	) {
		super(run.error_code ?? 'failed');
	}
}

/** Read-only history loading: never submit a job or persist a pending-job journal. */
export function loadSelectionHistory(options: {
	id: string;
	signal: AbortSignal;
	getRun: (
		id: string,
		includeBooks: boolean,
		signal: AbortSignal
	) => Promise<{
		request: SelectionRun;
		books?: Book[];
	}>;
	loadResults: (id: string, signal: AbortSignal) => Promise<FetchRecommendationsResult>;
}): Promise<CompletedSelection> {
	return withTimeout(
		async (signal) => {
			let books: Book[] = [];
			let first = true;
			while (true) {
				const data = await options.getRun(options.id, first, signal);
				signal.throwIfAborted();
				if (first) books = data.books ?? [];
				first = false;
				const run = data.request;
				if (['failed', 'skipped'].includes(run.status)) throw new SelectionHistoryError(run, books);
				if (run.status === 'completed') {
					const byId = new Map(books.map((book) => [book.book_id, book]));
					const submitted = run.book_ids.map(
						(id) =>
							byId.get(id) ?? {
								id,
								book_id: id,
								title: 'Unavailable book',
								author: 'Saved selection'
							}
					);
					const payload = await options.loadResults(run.public_id, signal);
					signal.throwIfAborted();
					return {
						run,
						books: submitted,
						result: {
							...payload,
							books: selectionResultBooks(run, payload, submitted)
						}
					};
				}
				await wait(SELECTION_POLL_MS, signal);
			}
		},
		{ signal: options.signal }
	);
}
