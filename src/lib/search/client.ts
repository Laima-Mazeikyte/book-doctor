import { browser } from '$app/environment';
import { base } from '$app/paths';

import { searchBooksViaApi } from './fallback';
import { SEARCH_PAGE_SIZE } from './types';
import type { SearchResultPage, SearchWorkerRequest, SearchWorkerResponse } from './types';

const workerUrl = new URL('./worker.ts', import.meta.url);

let searchWorker: Worker | null = null;
let nextRequestId = 1;
let workerDisabled = false;
let titleWarmPromise: Promise<void> | null = null;
let deferredWarmPromise: Promise<void> | null = null;
const pendingRequests = new Map<
	number,
	{
		resolve: (message: SearchWorkerResponse) => void;
		reject: (error: Error) => void;
	}
>();

function getAssetBaseUrl(): string {
	const originAndBase = `${window.location.origin}${base}`.replace(/\/$/, '');
	return `${originAndBase}/search/`;
}

function rejectPending(error: Error): void {
	for (const { reject } of pendingRequests.values()) {
		reject(error);
	}

	pendingRequests.clear();
}

function ensureWorker(): Worker {
	if (!browser) {
		throw new Error('Search worker is only available in the browser');
	}

	if (workerDisabled) {
		throw new Error('Search worker has been disabled after a previous failure');
	}

	if (searchWorker) {
		return searchWorker;
	}

	searchWorker = new Worker(workerUrl, { type: 'module' });
	searchWorker.onmessage = (event: MessageEvent<SearchWorkerResponse>) => {
		const message = event.data;
		const pending = pendingRequests.get(message.id);
		if (!pending) return;

		pendingRequests.delete(message.id);

		if (message.type === 'error') {
			pending.reject(new Error(message.message));
			return;
		}

		pending.resolve(message);
	};
	searchWorker.onerror = (event) => {
		workerDisabled = true;
		const message =
			event instanceof ErrorEvent && event.message
				? event.message
				: 'Search worker failed unexpectedly';
		rejectPending(new Error(message));
		searchWorker?.terminate();
		searchWorker = null;
	};

	return searchWorker;
}

type WorkerRequestPayload =
	| { type: 'warmTitle' }
	| { type: 'warmRemaining' }
	| { type: 'search'; query: string; offset: number; limit: number };

async function sendWorkerRequest(request: WorkerRequestPayload): Promise<SearchWorkerResponse> {
	const worker = ensureWorker();
	const id = nextRequestId++;
	const assetBase = getAssetBaseUrl();

	const message: SearchWorkerRequest =
		request.type === 'search'
			? { id, assetBase, type: 'search', query: request.query, offset: request.offset, limit: request.limit }
			: request.type === 'warmTitle'
				? { id, assetBase, type: 'warmTitle' }
				: { id, assetBase, type: 'warmRemaining' };

	const responsePromise = new Promise<SearchWorkerResponse>((resolveRequest, rejectRequest) => {
		pendingRequests.set(id, {
			resolve: resolveRequest,
			reject: rejectRequest
		});
	});

	worker.postMessage(message);
	return responsePromise;
}

function disableWorker(error: unknown): void {
	console.warn('[search] FlexSearch worker unavailable, falling back to API search', error);
	workerDisabled = true;
	searchWorker?.terminate();
	searchWorker = null;
	rejectPending(new Error('Search worker disabled'));
}

export async function warmTitleIndex(): Promise<void> {
	if (!browser || workerDisabled) return;

	titleWarmPromise ??= (async () => {
		try {
			await sendWorkerRequest({ type: 'warmTitle' });
		} catch (error) {
			disableWorker(error);
		}
	})();

	await titleWarmPromise;
}

export async function warmRemainingIndexes(): Promise<void> {
	if (!browser || workerDisabled) return;

	deferredWarmPromise ??= (async () => {
		try {
			await warmTitleIndex();
			if (workerDisabled) return;
			await sendWorkerRequest({ type: 'warmRemaining' });
		} catch (error) {
			disableWorker(error);
		}
	})();

	await deferredWarmPromise;
}

export function warmBookSearch(): void {
	if (!browser || workerDisabled) return;

	void warmTitleIndex().then(() => {
		if (!workerDisabled) {
			void warmRemainingIndexes();
		}
	});
}

export async function searchBooks(
	query: string,
	offset = 0,
	limit = SEARCH_PAGE_SIZE
): Promise<SearchResultPage> {
	if (!browser || workerDisabled) {
		return searchBooksViaApi(query, offset);
	}

	try {
		const response = await sendWorkerRequest({
			type: 'search',
			query,
			offset,
			limit
		});

		if (response.type !== 'search-result') {
			throw new Error(`Unexpected worker response: ${response.type}`);
		}

		return response.result;
	} catch (error) {
		disableWorker(error);
		return searchBooksViaApi(query, offset);
	}
}
