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

export type PollRecommendationsOutcome =
	| { status: 'ready'; books: Book[] }
	| { status: 'timeout' }
	| { status: 'error'; message: string };

/**
 * Poll until books arrive, timeout, or error. Caller should re-check `isActive` between awaits.
 */
export async function pollRecommendationsUntilReady(
	accessToken: string | null,
	requestId: string,
	isActive: () => boolean,
	opts?: { intervalMs?: number; timeoutMs?: number; startTime?: number }
): Promise<PollRecommendationsOutcome> {
	const intervalMs = opts?.intervalMs ?? RECOMMENDATIONS_POLL_INTERVAL_MS;
	const timeoutMs = opts?.timeoutMs ?? RECOMMENDATIONS_POLL_TIMEOUT_MS;
	const start = opts?.startTime ?? Date.now();

	while (isActive()) {
		try {
			const { books } = await fetchRecommendations(accessToken, requestId);
			if (!isActive()) return { status: 'error', message: 'aborted' };
			if (books.length > 0) return { status: 'ready', books };
			if (Date.now() - start >= timeoutMs) return { status: 'timeout' };
		} catch (e) {
			if (!isActive()) return { status: 'error', message: 'aborted' };
			return {
				status: 'error',
				message: e instanceof Error ? e.message : 'Failed to load recommendations'
			};
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return { status: 'error', message: 'aborted' };
}
