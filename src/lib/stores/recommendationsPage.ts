import type { DimensionMatchSnapshotsByBookId } from '$lib/recommendations/dimensionMatches';
import { get, writable } from 'svelte/store';
import type { Book } from '$lib/types/book';
import type { AuthorRelationshipAuthorsByBookId } from '$lib/recommendations/authorRelationships';

export type RecommendationRun = {
	request_id: string;
	created_at: string;
};

export type RecommendationRunData = {
	books: Book[];
	likedBookPrecedentsByBookId: Record<string, Book[]>;
	authorRelationshipAuthorsByBookId: AuthorRelationshipAuthorsByBookId;
	dimensionMatchSnapshotsByBookId: DimensionMatchSnapshotsByBookId;
};

/** Kept in sync with `/api/recommendations/unique` so best-fit sort can hydrate without a flash. */
export type RecommendationsUniqueMeta = {
	allRecommendedBookIds: string[];
	lastRecommendedAt: Record<string, number>;
	recommendationAppearanceCount: Record<string, number>;
	bestRecommendationRank: Record<string, number>;
	likedBookPrecedentsByBookId: Record<string, Book[]>;
	authorRelationshipAuthorsByBookId: AuthorRelationshipAuthorsByBookId;
	dimensionMatchSnapshotsByBookId: DimensionMatchSnapshotsByBookId;
};

function emptyUniqueMeta(): RecommendationsUniqueMeta {
	return {
		allRecommendedBookIds: [],
		lastRecommendedAt: {},
		recommendationAppearanceCount: {},
		bestRecommendationRank: {},
		likedBookPrecedentsByBookId: {},
		authorRelationshipAuthorsByBookId: {},
		dimensionMatchSnapshotsByBookId: {}
	};
}

interface RecommendationsHistoryState extends RecommendationsUniqueMeta {
	runs: RecommendationRun[];
	uniqueBooks: Book[];
	loaded: boolean;
	uniqueLoaded: boolean;
}

export function createRecommendationsPageStore() {
	const history = writable<RecommendationsHistoryState>({
		runs: [],
		uniqueBooks: [],
		loaded: false,
		uniqueLoaded: false,
		...emptyUniqueMeta()
	});
	let ownerUserId: string | null = null;
	const runData = writable<Map<string, RecommendationRunData>>(new Map());

	return {
		ensureUser(userId: string | null) {
			if (ownerUserId === userId) return;
			this.reset();
			ownerUserId = userId;
		},
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
		getRun(requestId: string): RecommendationRunData | undefined {
			return get(runData).get(requestId);
		},
		setRun(requestId: string, data: RecommendationRunData) {
			runData.update((state) => {
				const next = new Map(state);
				next.set(requestId, {
					...data,
					books: [...data.books]
				});
				return next;
			});
		},
		reset() {
			runData.set(new Map());
			history.set({
				runs: [],
				uniqueBooks: [],
				loaded: false,
				uniqueLoaded: false,
				...emptyUniqueMeta()
			});
		}
	};
}

export const recommendationsPageStore = createRecommendationsPageStore();
