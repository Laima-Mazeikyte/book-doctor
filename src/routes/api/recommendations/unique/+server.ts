import { buildDimensionMatchSnapshotsByBookId } from '$lib/recommendations/dimensionMatches';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildAuthorRelationshipAuthorsByBookId } from '$lib/recommendations/authorRelationships';
import { fetchBooksByUlids } from '$lib/server/catalogBooks';
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

type RecommendationItemRow = RecommendationPrecedentRow & {
	request_id?: unknown;
};

export const GET: RequestHandler = async ({ request }) => {
	const accessToken = requireAccessToken(request);
	const supabase = createSupabaseWithAuth(accessToken);

	// Get user's recommendation runs (newest first) for per-book recency ordering
	const { data: logs, error: logError } = await supabase
		.from('recommendation_log')
		.select('request_id, created_at')
		.order('created_at', { ascending: false });

	if (logError) {
		console.error(logError);
		throw error(500, 'Failed to load recommendation runs');
	}

	const requestIds = (logs ?? []).map((r) => r.request_id).filter(Boolean);
	if (requestIds.length === 0) {
		return json({
			hasRuns: (logs ?? []).length > 0,
			books: [],
			lastRecommendedAt: {},
			recommendationAppearanceCount: {},
			bestRecommendationRank: {},
			likedBookPrecedentsByBookId: {},
			authorRelationshipAuthorsByBookId: {},
			dimensionMatchSnapshotsByBookId: {}
		});
	}

	// Get all items for those runs (may contain duplicates across runs)
	const { data: items, error: itemsError } = await supabase
		.from('recommendation_items')
		.select(
			'book_id, request_id, rank, dimension_matches, liked_book_precedent_ids, author_relationship_evidence'
		)
		.in('request_id', requestIds);

	if (itemsError) {
		console.error(itemsError);
		throw error(500, 'Failed to load recommendation items');
	}

	const itemsByRequestId = new Map<string, RecommendationItemRow[]>();
	const appearanceCountByBook = new Map<string, number>();
	const bestRankByBook = new Map<string, number>();

	for (const row of items ?? []) {
		const bid = String(row.book_id ?? '').trim();
		const requestId = typeof row.request_id === 'string' ? row.request_id : '';
		if (!bid || !requestId) continue;
		const list = itemsByRequestId.get(requestId) ?? [];
		list.push(row as RecommendationItemRow);
		itemsByRequestId.set(requestId, list);

		appearanceCountByBook.set(bid, (appearanceCountByBook.get(bid) ?? 0) + 1);
		const rank = parseRecommendationRank(row.rank);
		if (rank != null) {
			const prev = bestRankByBook.get(bid);
			if (prev == null || rank < prev) bestRankByBook.set(bid, rank);
		}
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
	// Most recent run that contained each book (logs are newest-first)
	const lastRecommendedMs = new Map<string, number>();
	for (const log of logs ?? []) {
		const rid = log.request_id;
		if (!rid) continue;
		const runBookIds = (itemsByRequestId.get(rid) ?? [])
			.map((row) => String(row.book_id ?? '').trim())
			.filter(Boolean);
		const ts = parseRecommendationTimestamp(log.created_at);
		if (ts == null) continue;
		for (const bid of runBookIds) {
			if (!lastRecommendedMs.has(bid)) {
				lastRecommendedMs.set(bid, ts);
			}
		}
	}

	uniqueBookIds = await filterBookIdsExcludingUserLists(supabase, uniqueBookIds, {
		excludeNotInterested: true,
		excludeRated: true
	});

	const recommendationAppearanceCount: Record<string, number> = {};
	for (const [bid, n] of appearanceCountByBook) {
		recommendationAppearanceCount[String(bid)] = n;
	}
	const bestRecommendationRank: Record<string, number> = {};
	for (const [bid, r] of bestRankByBook) {
		bestRecommendationRank[String(bid)] = r;
	}

	if (uniqueBookIds.length === 0) {
		return json({
			hasRuns: (logs ?? []).length > 0,
			books: [],
			lastRecommendedAt: lastRecommendedAtRecord(lastRecommendedMs),
			recommendationAppearanceCount,
			bestRecommendationRank,
			likedBookPrecedentsByBookId: {},
			authorRelationshipAuthorsByBookId: {},
			dimensionMatchSnapshotsByBookId: {}
		});
	}

	try {
		const books = await fetchBooksByUlids(supabase, uniqueBookIds);
		const returnedBookIds = new Set(books.map((book) => book.book_id));
		const precedentRowsInPriorityOrder: RecommendationPrecedentRow[] = [];
		for (const log of logs ?? []) {
			if (!log.request_id) continue;
			precedentRowsInPriorityOrder.push(
				...(itemsByRequestId.get(log.request_id) ?? []).filter((row) =>
					returnedBookIds.has(String(row.book_id ?? '').trim())
				)
			);
		}
		const likedBookPrecedentsByBookId = await resolveLikedBookPrecedents(
			supabase,
			precedentRowsInPriorityOrder
		);
		const dimensionMatchSnapshotsByBookId = buildDimensionMatchSnapshotsByBookId(
			precedentRowsInPriorityOrder
		);
		const authorRelationshipAuthorsByBookId = buildAuthorRelationshipAuthorsByBookId(
			precedentRowsInPriorityOrder
		);

		return json({
			hasRuns: (logs ?? []).length > 0,
			books,
			lastRecommendedAt: lastRecommendedAtRecord(lastRecommendedMs),
			recommendationAppearanceCount,
			bestRecommendationRank,
			likedBookPrecedentsByBookId,
			authorRelationshipAuthorsByBookId,
			dimensionMatchSnapshotsByBookId
		});
	} catch (booksError) {
		console.error(booksError);
		throw error(500, 'Failed to load books');
	}
};
