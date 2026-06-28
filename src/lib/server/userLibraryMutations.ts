import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getUserIdFromToken } from '$lib/server/auth';
import { createSupabaseWithAuth } from '$lib/server/supabase';
import { requireAccessToken } from '$lib/server/requestAuth';

type UserLibraryTable = 'user_bookmarks' | 'user_not_interested';

async function parseBookIdFromJson(request: Request): Promise<string> {
	let body: { book_id?: string };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const bookId = body.book_id?.trim();
	if (!bookId) throw error(400, 'Missing or invalid book_id');
	return bookId;
}

function parseBookIdFromQuery(url: URL): string {
	const bookId = url.searchParams.get('book_id')?.trim() ?? '';
	if (!bookId) throw error(400, 'Missing or invalid book_id');
	return bookId;
}

export function createUserLibraryPostHandler(
	table: UserLibraryTable,
	failureMessage: string
): RequestHandler {
	return async ({ request }) => {
		const accessToken = requireAccessToken(request);
		const userId = await getUserIdFromToken(accessToken);
		if (!userId) throw error(401, 'Invalid or expired token');

		const bookId = await parseBookIdFromJson(request);
		const supabase = createSupabaseWithAuth(accessToken);
		const { error: insertError } = await supabase
			.from(table)
			.upsert({ user_id: userId, book_id: bookId }, { onConflict: 'user_id,book_id' });

		if (insertError) {
			console.error(insertError);
			throw error(500, failureMessage);
		}

		return json({ ok: true });
	};
}

export function createUserLibraryDeleteHandler(
	table: UserLibraryTable,
	failureMessage: string
): RequestHandler {
	return async ({ request, url }) => {
		const accessToken = requireAccessToken(request);
		const bookId = parseBookIdFromQuery(url);
		const supabase = createSupabaseWithAuth(accessToken);
		const { error: deleteError } = await supabase.from(table).delete().eq('book_id', bookId);

		if (deleteError) {
			console.error(deleteError);
			throw error(500, failureMessage);
		}

		return json({ ok: true });
	};
}
