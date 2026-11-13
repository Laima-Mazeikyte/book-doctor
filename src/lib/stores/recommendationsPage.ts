import type { FlavorEvidence } from '$lib/recommendations/flavorGroups';
import type { FlavorGroups } from '$lib/recommendations/flavorGroups';
import type { DimensionMatchSnapshotsByBookId } from '$lib/recommendations/dimensionMatches';
import { get, writable } from 'svelte/store';
import type { Book } from '$lib/types/book';
import type { AuthorRelationshipAuthorsByBookId } from '$lib/recommendations/authorRelationships';

export type RecommendationRunData = {
	flavor_groups?: FlavorGroups | null;
	flavorReferenceBooksById?: Record<string, Book>;
	books: Book[];
	likedBookPrecedentsByBookId: Record<string, Book[]>;
	selectionSeedBookIds?: string[];
	authorRelationshipAuthorsByBookId: AuthorRelationshipAuthorsByBookId;
	dimensionMatchSnapshotsByBookId: DimensionMatchSnapshotsByBookId;
};

export type RecommendationsUniquePayload = {
	flavorEvidenceByBookId?: Record<string, FlavorEvidence>;
	flavorReferenceBooksById?: Record<string, Book>;
	books: Book[];
	hasRuns: boolean;
	lastRecommendedAt: Record<string, number>;
	likedBookPrecedentsByBookId: Record<string, Book[]>;
	selectionSeedBookIds?: string[];
	authorRelationshipAuthorsByBookId: AuthorRelationshipAuthorsByBookId;
	dimensionMatchSnapshotsByBookId: DimensionMatchSnapshotsByBookId;
};

export function createEmptyRecommendationsUniquePayload(): RecommendationsUniquePayload {
	return {
		books: [],
		hasRuns: false,
		lastRecommendedAt: {},
		likedBookPrecedentsByBookId: {},
		authorRelationshipAuthorsByBookId: {},
		dimensionMatchSnapshotsByBookId: {}
	};
}

interface RecommendationsPageState {
	unique: RecommendationsUniquePayload;
	uniqueLoaded: boolean;
}

export function createRecommendationsPageStore() {
	const state = writable<RecommendationsPageState>({
		unique: createEmptyRecommendationsUniquePayload(),
		uniqueLoaded: false
	});
	let ownerUserId: string | null = null;
	const runData = writable<Map<string, RecommendationRunData>>(new Map());

	return {
		subscribe: state.subscribe,
		ensureUser(userId: string | null) {
			if (ownerUserId === userId) return;
			this.reset();
			ownerUserId = userId;
		},
		getSnapshot(): RecommendationsPageState {
			return get(state);
		},
		setUnique(payload: RecommendationsUniquePayload) {
			state.set({
				unique: {
					...payload,
					books: [...payload.books]
				},
				uniqueLoaded: true
			});
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
			state.set({
				unique: createEmptyRecommendationsUniquePayload(),
				uniqueLoaded: false
			});
		}
	};
}

export const recommendationsPageStore = createRecommendationsPageStore();
