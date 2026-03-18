import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUserIdFromToken } from '$lib/server/auth';
import { createSupabaseWithAuth } from '$lib/server/supabase';

function getAccessToken(request: Request): string | null {
	const authHeader = request.headers.get('Authorization');
	return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

export const GET: RequestHandler = async ({ request }) => {
	const accessToken = getAccessToken(request);
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
		.filter((id): id is number => id != null && Number.isInteger(id));

	return json({ book_ids: bookIds });
};

export const POST: RequestHandler = async ({ request }) => {
	const accessToken = getAccessToken(request);
	if (!accessToken) throw error(401, 'Missing Authorization');

	const userId = await getUserIdFromToken(accessToken);
	if (!userId) throw error(401, 'Invalid or expired token');

	let body: { book_id?: number };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const bookId = body.book_id;
	if (typeof bookId !== 'number' || !Number.isInteger(bookId)) {
		throw error(400, 'Missing or invalid book_id');
	}

	const supabase = createSupabaseWithAuth(accessToken);
	const { error: insertError } = await supabase
		.from('user_not_interested')
		.upsert({ user_id: userId, book_id: bookId }, { onConflict: 'user_id,book_id' });

	if (insertError) {
		console.error(insertError);
		throw error(500, 'Failed to add not interested');
	}

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, url }) => {
	const accessToken = getAccessToken(request);
	if (!accessToken) throw error(401, 'Missing Authorization');

	const bookIdParam = url.searchParams.get('book_id');
	const bookId = bookIdParam ? parseInt(bookIdParam, 10) : NaN;
	if (!Number.isInteger(bookId)) {
		throw error(400, 'Missing or invalid book_id');
	}

	const supabase = createSupabaseWithAuth(accessToken);
	const { error: deleteError } = await supabase
		.from('user_not_interested')
		.delete()
		.eq('book_id', bookId);

	if (deleteError) {
		console.error(deleteError);
		throw error(500, 'Failed to remove not interested');
	}

	return json({ ok: true });
};
