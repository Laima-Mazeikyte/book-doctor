import { withTimeout, RequestTimeoutError } from '$lib/requests/timeout';
import { t } from '$lib/copy';
import { getSupabase } from '$lib/supabase';
import type { CorrectionChanges, CorrectionContext } from './model';
import { CorrectionRequestError } from './errors';

async function request(
	method: 'GET' | 'POST' | 'DELETE',
	bookId: string,
	body?: unknown,
	signal?: AbortSignal
) {
	return withTimeout(
		async (signal) => {
			const client = getSupabase();
			if (!client) throw new Error('Could not connect. Please try again.');
			const { data, error } = await client.auth.getSession();
			if (error || !data.session || data.session.user.is_anonymous)
				throw new Error('Please sign in with a registered account.');
			signal.throwIfAborted();
			const response = await fetch(
				`/api/book-corrections${method === 'GET' ? `?book_id=${encodeURIComponent(bookId)}` : ''}`,
				{
					method,
					headers: {
						Authorization: `Bearer ${data.session.access_token}`,
						'Content-Type': 'application/json'
					},
					body: body === undefined ? undefined : JSON.stringify(body),
					signal
				}
			);
			if (!response.ok) {
				const payload = await response.json().catch(() => null);
				throw new CorrectionRequestError(
					payload?.message ?? 'Could not save or load your proposal. Please try again.',
					response.status
				);
			}
			return response.status === 204 ? null : response.json();
		},
		{ signal }
	).catch((error: unknown) => {
		if (
			method !== 'GET' &&
			(error instanceof RequestTimeoutError ||
				(error instanceof CorrectionRequestError && error.status === 504))
		) {
			throw new CorrectionRequestError(t('requests.uncertainCorrection'), 504);
		}
		throw error;
	});
}

export async function loadCorrectionContext(
	bookId: string,
	signal?: AbortSignal
): Promise<CorrectionContext> {
	return request('GET', bookId, undefined, signal);
}

export async function saveCorrection(
	bookId: string,
	id: string,
	changes: CorrectionChanges
): Promise<CorrectionContext> {
	return request('POST', bookId, { book_id: bookId, id, changes });
}

export async function withdrawCorrection(bookId: string, id: string): Promise<void> {
	await request('DELETE', bookId, { id });
}
