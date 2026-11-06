import { json, type RequestEvent, type RequestHandler } from '@sveltejs/kit';
import { RequestTimeoutError, SERVER_TIMEOUT_MS, withTimeout } from '$lib/requests/timeout';

/** One budget for an API handler, including authentication and dependent reads. */
export function withRequestTimeout(
	handler: (event: RequestEvent, signal: AbortSignal) => Promise<Response>,
	timeoutStatus = 504
): RequestHandler {
	return async (event) => {
		try {
			return await withTimeout((signal) => handler(event, signal), {
				timeoutMs: SERVER_TIMEOUT_MS,
				signal: event.request?.signal
			});
		} catch (error) {
			if (!(error instanceof RequestTimeoutError)) throw error;
			return json(
				{
					code: 'request_timeout',
					message: 'The request timed out. Its outcome could not be confirmed.'
				},
				{ status: timeoutStatus, headers: { 'Cache-Control': 'private, no-store' } }
			);
		}
	};
}
