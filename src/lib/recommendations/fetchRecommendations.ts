import type { Book } from '$lib/types/book';

export const RECOMMENDATIONS_POLL_INTERVAL_MS = 3000;
export const RECOMMENDATIONS_POLL_TIMEOUT_MS = 60_000;

export type FetchRecommendationsResult = {
	books: Book[];
	request_id: string | null;
};

export async function fetchRecommendations(
	accessToken: string | null,
	requestId: string | null
): Promise<FetchRecommendationsResult> {
	const url = requestId
		? `/api/recommendations?request_id=${encodeURIComponent(requestId)}`
		: '/api/recommendations';
	const headers: Record<string, string> = {};
	if (accessToken) {
		headers['Authorization'] = `Bearer ${accessToken}`;
	}
	const res = await fetch(url, { headers });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const data: { books: Book[]; request_id: string | null } = await res.json();
	return { books: data.books ?? [], request_id: data.request_id ?? null };
}
