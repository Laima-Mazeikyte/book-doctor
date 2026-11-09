import { isPublicRequestId } from '$lib/requests/publicId';
import { withRequestTimeout } from '$lib/server/requestTimeout';
import { buildDimensionMatchSnapshotsByBookId } from '$lib/recommendations/dimensionMatches';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildAuthorRelationshipAuthorsByBookId } from '$lib/recommendations/authorRelationships';
import { fetchBooksByUlidsInOrder } from '$lib/server/catalogBooks';
import { filterBookIdsExcludingUserLists } from '$lib/server/recommendationFilters';
import {
	MAX_RECOMMENDATION_RANK,
	resolveLikedBookPrecedents,
	type RecommendationPrecedentRow
} from '$lib/server/recommendationPrecedents';
import { requireAccessToken } from '$lib/server/requestAuth';
import { createSupabaseWithAuth } from '$lib/server/supabase';
import { loadRecentOverallRecommendationRequests } from '$lib/server/overallRecommendationRequests';

export const GET: RequestHandler = withRequestTimeout(async ({ url, request }, signal) => {
	const requestId = url.searchParams.get('request_id')?.trim() ?? null;
	const includeRated = requestId !== null && url.searchParams.get('include_rated') === '1';
	const accessToken = requireAccessToken(request);
	const supabase = createSupabaseWithAuth(accessToken, signal);

	let targetRequestId: string | null = requestId;
	let publicRequestId: string | null = null;
	let requestType: string | null = null;
	let resultCount = MAX_RECOMMENDATION_RANK;
	if (requestId && (isPublicRequestId(requestId) || /^\d+$/.test(requestId))) {
		const { data: ownedRequest, error: lookupError } = await supabase
			.from('recommendation_requests')
			.select('id, public_id, request_type, status, result_count')
			.eq(isPublicRequestId(requestId) ? 'public_id' : 'id', requestId)
			.maybeSingle();
		if (lookupError) throw error(500, 'Failed to load recommendation request');
		if (!ownedRequest && (isPublicRequestId(requestId) || includeRated))
			throw error(404, 'Recommendation request unavailable');
		if (ownedRequest) {
			targetRequestId = String(ownedRequest.id);
			publicRequestId = ownedRequest.public_id ?? targetRequestId;
			requestType = ownedRequest.request_type;
			resultCount =
				ownedRequest.status === 'completed'
					? Math.min(MAX_RECOMMENDATION_RANK, ownedRequest.result_count ?? 0)
					: 0;
		}
	}

	if (!targetRequestId) {
		try {
			const { runs, publicIds } = await loadRecentOverallRecommendationRequests(supabase);
			const latest = runs[0];
			targetRequestId = latest?.request_id ?? null;
			publicRequestId = latest ? (publicIds.get(latest.request_id) ?? latest.request_id) : null;
			requestType = latest?.request_type ?? null;
			resultCount = Math.min(MAX_RECOMMENDATION_RANK, latest?.result_count ?? 0);
		} catch (cause) {
			console.error(cause);
			throw error(500, 'Failed to load recommendation requests');
		}
	}

	if (!targetRequestId) {
		return json({
			books: [],
			request_id: null,
			likedBookPrecedentsByBookId: {},
			authorRelationshipAuthorsByBookId: {},
			dimensionMatchSnapshotsByBookId: {}
		});
	}
	publicRequestId ??= targetRequestId;

	const { data: items, error: itemsError } = await supabase
		.from('recommendation_items')
		.select(
			'book_id, rank, dimension_matches, liked_book_precedent_ids, author_relationship_evidence'
		)
		.eq('request_id', targetRequestId)
		.order('rank', { ascending: true })
		.limit(resultCount);

	if (itemsError) {
		console.error(itemsError);
		throw error(500, 'Failed to load recommendation items');
	}

	if (!items?.length) {
		return json({
			books: [],
			request_id: publicRequestId,
			request_type: requestType,
			likedBookPrecedentsByBookId: {},
			authorRelationshipAuthorsByBookId: {},
			dimensionMatchSnapshotsByBookId: {}
		});
	}

	let bookIds = items.map((i) => String(i.book_id ?? '').trim()).filter(Boolean);

	try {
		bookIds = await filterBookIdsExcludingUserLists(supabase, bookIds, {
			excludeNotInterested: !requestId,
			excludeRated: !includeRated
		});
	} catch (filterError) {
		console.error('[recommendations] Failed to load exclusions:', filterError);
		throw error(500, 'Failed to load recommendations');
	}
	if (bookIds.length === 0) {
		return json({
			books: [],
			request_id: publicRequestId,
			request_type: requestType,
			likedBookPrecedentsByBookId: {},
			authorRelationshipAuthorsByBookId: {},
			dimensionMatchSnapshotsByBookId: {}
		});
	}

	try {
		const books = await fetchBooksByUlidsInOrder(supabase, bookIds);
		const returnedBookIds = new Set(books.map((book) => book.book_id));
		const returnedItems = (items ?? []).filter((item) =>
			returnedBookIds.has(String(item.book_id ?? '').trim())
		);
		const likedBookPrecedentsByBookId = await resolveLikedBookPrecedents(
			supabase,
			returnedItems as RecommendationPrecedentRow[]
		);
		const dimensionMatchSnapshotsByBookId = buildDimensionMatchSnapshotsByBookId(
			returnedItems.map((item) => ({ ...item, request_id: publicRequestId }))
		);
		const authorRelationshipAuthorsByBookId = buildAuthorRelationshipAuthorsByBookId(returnedItems);
		return json({
			books,
			request_id: publicRequestId,
			request_type: requestType,
			likedBookPrecedentsByBookId,
			selectionSeedBookIds:
				requestType === 'recommend_from_selection' ? Object.keys(likedBookPrecedentsByBookId) : [],
			authorRelationshipAuthorsByBookId,
			dimensionMatchSnapshotsByBookId
		});
	} catch (booksError) {
		console.error(booksError);
		throw error(500, 'Failed to load books');
	}
});
