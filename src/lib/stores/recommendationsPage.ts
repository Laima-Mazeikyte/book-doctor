import { get, writable } from 'svelte/store';
import type { Book } from '$lib/types/book';

export type RecommendationRun = {
	request_id: string;
	created_at: string;
};

/** Kept in sync with `/api/recommendations/unique` so best-fit sort can hydrate without a flash. */
export type RecommendationsUniqueMeta = {
	allRecommendedBookIds: number[];
	lastRecommendedAt: Record<string, number>;
	recommendationAppearanceCount: Record<string, number>;
	bestRecommendationRank: Record<string, number>;
};

function emptyUniqueMeta(): RecommendationsUniqueMeta {
	return {
		allRecommendedBookIds: [],
		lastRecommendedAt: {},
		recommendationAppearanceCount: {},
		bestRecommendationRank: {}
	};
}

interface RecommendationsHistoryState extends RecommendationsUniqueMeta {
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
		uniqueLoaded: false,
		...emptyUniqueMeta()
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
		setUniqueBooks(books: Book[], meta: RecommendationsUniqueMeta = emptyUniqueMeta()) {
			history.update((state) => ({
				...state,
				uniqueBooks: [...books],
				loaded: true,
				uniqueLoaded: true,
				...meta
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
				uniqueLoaded: false,
				...emptyUniqueMeta()
			});
			runBooks.set(new Map());
		}
	};
}

export const recommendationsPageStore = createRecommendationsPageStore();
