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

export const GET: RequestHandler = async ({ url, request }) => {
	const requestId = url.searchParams.get('request_id')?.trim() ?? null;
	const accessToken = requireAccessToken(request);
	const supabase = createSupabaseWithAuth(accessToken);

	let targetRequestId: string | null = requestId;

	if (!targetRequestId) {
		const { data: logs, error: logError } = await supabase
			.from('recommendation_log')
			.select('request_id')
			.order('created_at', { ascending: false })
			.limit(1);

		if (logError) {
			console.error(logError);
			throw error(500, 'Failed to load recommendation');
		}
		targetRequestId = logs?.[0]?.request_id ?? null;
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

	const { data: items, error: itemsError } = await supabase
		.from('recommendation_items')
		.select(
			'book_id, rank, dimension_matches, liked_book_precedent_ids, author_relationship_evidence'
		)
		.eq('request_id', targetRequestId)
		.order('rank', { ascending: true })
		.limit(MAX_RECOMMENDATION_RANK);

	if (itemsError) {
		console.error(itemsError);
		throw error(500, 'Failed to load recommendation items');
	}

	if (!items?.length) {
		return json({
			books: [],
			request_id: targetRequestId,
			likedBookPrecedentsByBookId: {},
			authorRelationshipAuthorsByBookId: {},
			dimensionMatchSnapshotsByBookId: {}
		});
	}

	let bookIds = items.map((i) => String(i.book_id ?? '').trim()).filter(Boolean);

	bookIds = await filterBookIdsExcludingUserLists(supabase, bookIds, {
		excludeNotInterested: !requestId,
		excludeRated: true
	});
	if (bookIds.length === 0) {
		return json({
			books: [],
			request_id: targetRequestId,
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
			returnedItems.map((item) => ({ ...item, request_id: targetRequestId }))
		);
		const authorRelationshipAuthorsByBookId = buildAuthorRelationshipAuthorsByBookId(returnedItems);
		return json({
			books,
			request_id: targetRequestId,
			likedBookPrecedentsByBookId,
			authorRelationshipAuthorsByBookId,
			dimensionMatchSnapshotsByBookId
		});
	} catch (booksError) {
		console.error(booksError);
		throw error(500, 'Failed to load books');
	}
};
