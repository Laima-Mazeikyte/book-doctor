const supabaseUrl =
	typeof import.meta.env?.VITE_SUPABASE_URL === 'string' ? import.meta.env.VITE_SUPABASE_URL : '';

const supabaseAnonKey =
	typeof import.meta.env?.VITE_SUPABASE_ANON_KEY === 'string'
		? import.meta.env.VITE_SUPABASE_ANON_KEY
		: '';

/**
 * Resolve user id from access token via Supabase Auth API.
 */
export async function getUserIdFromToken(accessToken: string): Promise<string | null> {
	if (!supabaseUrl || !supabaseAnonKey) {
		console.error('[auth] Missing Supabase URL or anon key for token validation');
		return null;
	}
	const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
		headers: { Authorization: `Bearer ${accessToken}`, apikey: supabaseAnonKey }
	});
	if (!res.ok) return null;
	const data = (await res.json()) as { id?: string };
	return typeof data.id === 'string' ? data.id : null;
}
