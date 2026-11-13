import { withRequestTimeout } from '$lib/server/requestTimeout';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAccessToken } from '$lib/server/requestAuth';
import { createSupabaseWithAuth } from '$lib/server/supabase';
import { loadRecentOverallRecommendationRequests } from '$lib/server/overallRecommendationRequests';
import { filterBookIdsExcludingUserLists } from '$lib/server/recommendationFilters';

export const GET: RequestHandler = withRequestTimeout(async ({ request }, signal) => {
	const db = createSupabaseWithAuth(requireAccessToken(request), signal);
	try {
		const { runs } = await loadRecentOverallRecommendationRequests(db);
		const ids = [
			...new Set(
				runs.flatMap((run) =>
					run.flavor_groups.groups.flatMap((group) => group.items.map((item) => item.book_id))
				)
			)
		];
		const unread = await filterBookIdsExcludingUserLists(db, ids, {
			excludeNotInterested: true,
			excludeRated: true
		});
		return json({ count: unread.length });
	} catch (cause) {
		console.error('[api/recommendations/count]', cause);
		throw error(500, 'Failed to load recommendation count');
	}
});
