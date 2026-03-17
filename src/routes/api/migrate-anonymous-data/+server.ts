import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSupabaseServiceRole } from '$lib/server/supabase';

const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const supabaseUrl =
	typeof import.meta.env?.VITE_SUPABASE_URL === 'string'
		? import.meta.env.VITE_SUPABASE_URL
		: '';

/**
 * Resolve user id from access token via Supabase Auth API.
 */
async function getUserIdFromToken(accessToken: string): Promise<string | null> {
	if (!supabaseUrl) return null;
	const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
		headers: { Authorization: `Bearer ${accessToken}` }
	});
	if (!res.ok) return null;
	const data = await res.json();
	return data?.id ?? data?.user?.id ?? null;
}

/**
 * Migrates data from an anonymous user to the currently authenticated user.
 * Call this after signUp when the user was previously anonymous and updateUser failed.
 * Requires Bearer token of the *new* user (so they must sign up first, then call this).
 */
export const POST: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('Authorization');
	const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
	if (!accessToken) {
		throw error(401, 'Missing Authorization');
	}

	let body: { anonymousUserId?: string };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const anonymousUserId = body.anonymousUserId?.trim();
	if (!anonymousUserId || !UUID_REGEX.test(anonymousUserId)) {
		throw error(400, 'Missing or invalid anonymousUserId');
	}

	const newUserId = await getUserIdFromToken(accessToken);
	if (!newUserId) {
		throw error(401, 'Invalid or expired token');
	}

	const supabaseAdmin = createSupabaseServiceRole();
	if (!supabaseAdmin) {
		throw error(503, 'Migration not configured');
	}
	if (newUserId === anonymousUserId) {
		return json({ ok: true, migrated: false, message: 'Same user, nothing to migrate' });
	}

	// Migrate user_ratings: copy rows to new user (anonymous rows stay until we reassign; we insert for new user then delete anonymous)
	const { data: ratingRows, error: ratingsSelectError } = await supabaseAdmin
		.from('user_ratings')
		.select('book_id, book_rating')
		.eq('user_id', anonymousUserId);

	if (ratingsSelectError) {
		console.error('[migrate-anonymous] user_ratings select:', ratingsSelectError);
		throw error(500, 'Failed to read anonymous ratings');
	}

	if (ratingRows && ratingRows.length > 0) {
		const toInsert = ratingRows.map((r) => ({
			user_id: newUserId,
			book_id: r.book_id,
			book_rating: r.book_rating,
			updated_at: new Date().toISOString()
		}));
		const { error: ratingsUpsertError } = await supabaseAdmin
			.from('user_ratings')
			.upsert(toInsert, { onConflict: 'user_id,book_id' });
		if (ratingsUpsertError) {
			console.error('[migrate-anonymous] user_ratings upsert:', ratingsUpsertError);
			throw error(500, 'Failed to migrate ratings');
		}
		await supabaseAdmin.from('user_ratings').delete().eq('user_id', anonymousUserId);
	}

	// Reassign recommendation_requests
	const { error: reqUpdateError } = await supabaseAdmin
		.from('recommendation_requests')
		.update({ user_id: newUserId })
		.eq('user_id', anonymousUserId);
	if (reqUpdateError) {
		console.error('[migrate-anonymous] recommendation_requests update:', reqUpdateError);
	}

	// Reassign recommendation_log
	const { error: logUpdateError } = await supabaseAdmin
		.from('recommendation_log')
		.update({ user_id: newUserId })
		.eq('user_id', anonymousUserId);
	if (logUpdateError) {
		console.error('[migrate-anonymous] recommendation_log update:', logUpdateError);
	}

	// Reassign recommendation_items
	const { error: itemsUpdateError } = await supabaseAdmin
		.from('recommendation_items')
		.update({ user_id: newUserId })
		.eq('user_id', anonymousUserId);
	if (itemsUpdateError) {
		console.error('[migrate-anonymous] recommendation_items update:', itemsUpdateError);
	}

	return json({ ok: true, migrated: true });
});
