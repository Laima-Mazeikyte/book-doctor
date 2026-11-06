export const REQUEST_TIMEOUT_MS = 15_000;
export const SERVER_TIMEOUT_MS = 8_000;
// Bulk imports and lab artifacts need more time than ordinary JSON reads.
export const LARGE_REQUEST_TIMEOUT_MS = 60_000;

export class RequestTimeoutError extends Error {
	constructor() {
		super('The request timed out. Please try again.');
		this.name = 'RequestTimeoutError';
	}
}

/** Bound the complete operation, including its body and dependent requests.
 * Callbacks return data; publish state only after this promise resolves.
 * Aborting transport does not guarantee that a server-side write was cancelled.
 */
export function withTimeout<T>(
	operation: (signal: AbortSignal) => PromiseLike<T>,
	{ timeoutMs = REQUEST_TIMEOUT_MS, signal }: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<T> {
	if (signal?.aborted) return Promise.reject(signal.reason);
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		return Promise.reject(new RequestTimeoutError());
	}
	return new Promise<T>((resolve, reject) => {
		const controller = new AbortController();
		let settled = false;
		const cleanup = () => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', cancel);
		};
		const fail = (reason: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(reason);
			controller.abort(reason);
		};
		const cancel = () => fail(signal?.reason);
		const timer = setTimeout(() => fail(new RequestTimeoutError()), timeoutMs);
		signal?.addEventListener('abort', cancel, { once: true });
		try {
			Promise.resolve(operation(controller.signal)).then((value) => {
				if (settled) return;
				settled = true;
				cleanup();
				resolve(value);
			}, fail);
		} catch (error) {
			fail(error);
		}
	});
}

/** Abortable delay for existing polling loops. */
export function wait(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise((resolve, reject) => {
		const cancel = () => {
			clearTimeout(timer);
			signal.removeEventListener('abort', cancel);
			reject(signal.reason);
		};
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', cancel);
			resolve();
		}, ms);
		signal.addEventListener('abort', cancel, { once: true });
	});
}
