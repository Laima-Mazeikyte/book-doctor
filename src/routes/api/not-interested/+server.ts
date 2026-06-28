import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAccessToken } from '$lib/server/requestAuth';
import { createSupabaseWithAuth } from '$lib/server/supabase';
import {
	createUserLibraryDeleteHandler,
	createUserLibraryPostHandler
} from '$lib/server/userLibraryMutations';

export const GET: RequestHandler = async ({ request }) => {
	const accessToken = requireAccessToken(request);
	const supabase = createSupabaseWithAuth(accessToken);

	const { data: rows, error: selectError } = await supabase
		.from('user_not_interested')
		.select('book_id');

	if (selectError) {
		console.error(selectError);
		throw error(500, 'Failed to load not interested');
	}

	const bookIds = (rows ?? [])
		.map((r) => r.book_id)
		.filter((id): id is string => typeof id === 'string' && id.trim() !== '');

	return json({ book_ids: bookIds });
};

export const POST = createUserLibraryPostHandler(
	'user_not_interested',
	'Failed to add not interested'
);
export const DELETE = createUserLibraryDeleteHandler(
	'user_not_interested',
	'Failed to remove not interested'
);
