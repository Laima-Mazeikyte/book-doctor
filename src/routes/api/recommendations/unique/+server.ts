import { resolveFlavorReferenceBooks } from '$lib/server/flavorReferences';
import type { FlavorEvidence } from '$lib/recommendations/flavorGroups';
import { withRequestTimeout } from '$lib/server/requestTimeout';
import { buildDimensionMatchSnapshotsByBookId } from '$lib/recommendations/dimensionMatches';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildAuthorRelationshipAuthorsByBookId } from '$lib/recommendations/authorRelationships';
import { fetchBooksByUlids, fetchSelectionBooksByUlids } from '$lib/server/catalogBooks';
import {
	filterBookIdsExcludingUserLists,
	lastRecommendedAtRecord,
	parseRecommendationRank,
	parseRecommendationTimestamp
} from '$lib/server/recommendationFilters';
import {
	resolveLikedBookPrecedents,
	type RecommendationPrecedentRow
} from '$lib/server/recommendationPrecedents';
import { requireAccessToken } from '$lib/server/requestAuth';
import { createSupabaseWithAuth } from '$lib/server/supabase';
import { loadRecentOverallRecommendationRequests } from '$lib/server/overallRecommendationRequests';

type RecommendationItemRow = RecommendationPrecedentRow & {
	flavor_evidence?: FlavorEvidence;
	request_id?: unknown;
};

export const GET: RequestHandler = withRequestTimeout(async ({ request }, signal) => {
	const selectionView = new URL(request.url).searchParams.get('view') === 'selection';
	const accessToken = requireAccessToken(request);
	const supabase = createSupabaseWithAuth(accessToken, signal);

	const { runs, publicIds } = await loadRecentOverallRecommendationRequests(supabase).catch(
		(cause) => {
			console.error(cause);
			throw error(500, 'Failed to load recommendation runs');
		}
	);

	const requestIds = (runs ?? []).map((r) => r.request_id).filter(Boolean);
	if (requestIds.length === 0) {
		if (selectionView) return json({ books: [], lastRecommendedAt: {} });
		return json({
			hasRuns: (runs ?? []).length > 0,
			books: [],
			lastRecommendedAt: {},
			likedBookPrecedentsByBookId: {},
			authorRelationshipAuthorsByBookId: {},
			dimensionMatchSnapshotsByBookId: {}
		});
	}

	const items = runs.flatMap((run) =>
		run.flavor_groups.groups.flatMap((group) =>
			group.items.map((item) => ({ ...item, request_id: run.request_id }))
		)
	);

	const itemsByRequestId = new Map<string, RecommendationItemRow[]>();

	for (const row of (items ?? []) as unknown as RecommendationItemRow[]) {
		const bid = String(row.book_id ?? '').trim();
		const requestId = row.request_id == null ? '' : String(row.request_id);
		if (!bid || !requestId) continue;
		const rank = parseRecommendationRank(row.rank);
		if (rank == null || rank > 7) continue;
		const list = itemsByRequestId.get(requestId) ?? [];
		list.push(row as RecommendationItemRow);
		itemsByRequestId.set(requestId, list);
	}

	for (const runItems of itemsByRequestId.values()) {
		runItems.sort((a, b) => {
			const rankA = parseRecommendationRank(a.rank);
			const rankB = parseRecommendationRank(b.rank);
			if (rankA == null && rankB == null) return 0;
			if (rankA == null) return 1;
			if (rankB == null) return -1;
			return rankA - rankB;
		});
	}

	let uniqueBookIds = [
		...new Set(
			[...itemsByRequestId.values()]
				.flat()
				.map((row) => String(row.book_id ?? '').trim())
				.filter(Boolean)
		)
	];
	// Most recent run that contained each book (runs are newest-first)
	const lastRecommendedMs = new Map<string, number>();
	for (const run of runs ?? []) {
		const rid = run.request_id;
		if (!rid) continue;
		const runBookIds = (itemsByRequestId.get(rid) ?? [])
			.map((row) => String(row.book_id ?? '').trim())
			.filter(Boolean);
		const ts = parseRecommendationTimestamp(run.created_at);
		if (ts == null) continue;
		for (const bid of runBookIds) {
			if (!lastRecommendedMs.has(bid)) {
				lastRecommendedMs.set(bid, ts);
			}
		}
	}

	try {
		uniqueBookIds = await filterBookIdsExcludingUserLists(supabase, uniqueBookIds, {
			excludeNotInterested: true,
			excludeRated: true
		});
	} catch (filterError) {
		console.error('[recommendations/unique] Failed to load exclusions:', filterError);
		throw error(500, 'Failed to load recommendations');
	}
	if (selectionView) {
		try {
			return json({
				books: await fetchSelectionBooksByUlids(supabase, uniqueBookIds),
				lastRecommendedAt: lastRecommendedAtRecord(lastRecommendedMs)
			});
		} catch (cause) {
			console.error(cause);
			throw error(500, 'Failed to load books');
		}
	}

	if (uniqueBookIds.length === 0) {
		return json({
			hasRuns: (runs ?? []).length > 0,
			books: [],
			lastRecommendedAt: lastRecommendedAtRecord(lastRecommendedMs),
			likedBookPrecedentsByBookId: {},
			authorRelationshipAuthorsByBookId: {},
			dimensionMatchSnapshotsByBookId: {}
		});
	}

	try {
		const books = await fetchBooksByUlids(supabase, uniqueBookIds);
		const returnedBookIds = new Set(books.map((book) => book.book_id));
		const precedentRowsInPriorityOrder: RecommendationPrecedentRow[] = [];
		for (const run of runs ?? []) {
			if (!run.request_id) continue;
			precedentRowsInPriorityOrder.push(
				...(itemsByRequestId.get(run.request_id) ?? []).filter((row) =>
					returnedBookIds.has(String(row.book_id ?? '').trim())
				)
			);
		}
		const selectionSeedBookIds: string[] = [];
		const seen = new Set<string>();
		const runTypes = new Map(runs.map((run) => [run.request_id, run.request_type]));
		for (const row of precedentRowsInPriorityOrder) {
			const id = String(row.book_id ?? '');
			if (seen.has(id)) continue;
			seen.add(id);
			if (runTypes.get(String(row.request_id)) === 'recommend_from_selection')
				selectionSeedBookIds.push(id);
		}
		const flavorEvidenceByBookId: Record<string, FlavorEvidence> = {};
		const evidenceSeen = new Set<string>();
		for (const row of precedentRowsInPriorityOrder as RecommendationItemRow[]) {
			const id = String(row.book_id);
			if (evidenceSeen.has(id)) continue;
			evidenceSeen.add(id);
			if (row.flavor_evidence) flavorEvidenceByBookId[id] = row.flavor_evidence;
		}
		const flavorReferenceBooksById = await resolveFlavorReferenceBooks(
			supabase,
			Object.values(flavorEvidenceByBookId)
		);
		const likedBookPrecedentsByBookId = await resolveLikedBookPrecedents(
			supabase,
			precedentRowsInPriorityOrder
		);
		const dimensionMatchSnapshotsByBookId = buildDimensionMatchSnapshotsByBookId(
			precedentRowsInPriorityOrder.map((row) => ({
				...row,
				request_id:
					typeof row.request_id === 'string'
						? (publicIds.get(row.request_id) ?? row.request_id)
						: row.request_id
			}))
		);
		const authorRelationshipAuthorsByBookId = buildAuthorRelationshipAuthorsByBookId(
			precedentRowsInPriorityOrder
		);

		return json({
			hasRuns: (runs ?? []).length > 0,
			books,
			flavorEvidenceByBookId,
			flavorReferenceBooksById,
			lastRecommendedAt: lastRecommendedAtRecord(lastRecommendedMs),
			likedBookPrecedentsByBookId,
			selectionSeedBookIds,
			authorRelationshipAuthorsByBookId,
			dimensionMatchSnapshotsByBookId
		});
	} catch (booksError) {
		console.error(booksError);
		throw error(500, 'Failed to load books');
	}
});
