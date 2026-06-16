import { error } from '@sveltejs/kit';

export function getAccessToken(request: Request): string | null {
	const authHeader = request.headers.get('Authorization');
	return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

export function requireAccessToken(request: Request): string {
	const accessToken = getAccessToken(request);
	if (!accessToken) throw error(401, 'Missing Authorization');
	return accessToken;
}
