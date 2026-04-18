import { get, writable } from 'svelte/store';
import type { Book } from '$lib/types/book';

export type RecommendationRun = {
	request_id: string;
	created_at: string;
};

interface RecommendationsHistoryState {
	runs: RecommendationRun[];
	uniqueBooks: Book[];
	loaded: boolean;
	uniqueLoaded: boolean;
}

function createRecommendationsPageStore() {
	const history = writable<RecommendationsHistoryState>({
		runs: [],
		uniqueBooks: [],
		loaded: false,
		uniqueLoaded: false
	});
	const runBooks = writable<Map<string, Book[]>>(new Map());

	return {
		history: {
			subscribe: history.subscribe
		},
		getHistorySnapshot(): RecommendationsHistoryState {
			return get(history);
		},
		setRuns(runs: RecommendationRun[]) {
			history.update((state) => ({
				...state,
				runs: [...runs],
				loaded: true
			}));
		},
		setUniqueBooks(books: Book[]) {
			history.update((state) => ({
				...state,
				uniqueBooks: [...books],
				loaded: true,
				uniqueLoaded: true
			}));
		},
		getRunBooks(requestId: string): Book[] | undefined {
			return get(runBooks).get(requestId);
		},
		setRunBooks(requestId: string, books: Book[]) {
			runBooks.update((state) => {
				const next = new Map(state);
				next.set(requestId, [...books]);
				return next;
			});
		},
		reset() {
			history.set({
				runs: [],
				uniqueBooks: [],
				loaded: false,
				uniqueLoaded: false
			});
			runBooks.set(new Map());
		}
	};
}

export const recommendationsPageStore = createRecommendationsPageStore();
