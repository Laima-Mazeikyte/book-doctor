/// <reference lib="webworker" />

import { decode } from '@msgpack/msgpack';

import { SearchEngine } from './engine';
import {
	SEARCH_ASSET_VERSION,
	type ExportChunk,
	type SearchBookDocument,
	type SearchIndexField,
	type SearchIndexManifest,
	type SearchWorkerRequest,
	type SearchWorkerResponse
} from './types';

const workerScope = self as DedicatedWorkerGlobalScope;

let assetBaseUrl = '';
let manifestPromise: Promise<SearchIndexManifest> | null = null;
let enginePromise: Promise<SearchEngine> | null = null;
const fieldLoads = new Map<SearchIndexField, Promise<void>>();
let deferredWarmPromise: Promise<void> | null = null;

function getAssetUrl(file: string): string {
	if (!assetBaseUrl) {
		throw new Error('Search worker has no asset base URL');
	}

	return new URL(file, assetBaseUrl).toString();
}

async function fetchMsgpack<T>(file: string): Promise<T> {
	const res = await fetch(getAssetUrl(file));
	if (!res.ok) {
		throw new Error(`Failed to fetch ${file}: HTTP ${res.status}`);
	}

	const buffer = await res.arrayBuffer();
	return decode(new Uint8Array(buffer)) as T;
}

async function ensureManifest(): Promise<SearchIndexManifest> {
	manifestPromise ??= (async () => {
		const manifest = await fetchMsgpack<SearchIndexManifest>('manifest.msgpack');
		if (manifest.version !== SEARCH_ASSET_VERSION) {
			throw new Error(
				`Search index version mismatch (got ${manifest.version}, expected ${SEARCH_ASSET_VERSION})`
			);
		}
		return manifest;
	})();
	return manifestPromise;
}

async function ensureEngine(): Promise<SearchEngine> {
	enginePromise ??= (async () => {
		const manifest = await ensureManifest();
		const [documents, titleChunks] = await Promise.all([
			fetchMsgpack<SearchBookDocument[]>(manifest.documents.file),
			fetchMsgpack<ExportChunk[]>(manifest.fields.title.file)
		]);
		const engine = new SearchEngine(manifest, documents);
		engine.importField('title', titleChunks);
		return engine;
	})();

	return enginePromise;
}

async function loadField(field: SearchIndexField): Promise<void> {
	if (field === 'title') {
		await ensureEngine();
		return;
	}

	if (fieldLoads.has(field)) {
		return fieldLoads.get(field)!;
	}

	const load = (async () => {
		const manifest = await ensureManifest();
		const engine = await ensureEngine();
		const chunks = await fetchMsgpack<ExportChunk[]>(manifest.fields[field].file);
		engine.importField(field, chunks);
	})();

	fieldLoads.set(field, load);

	try {
		await load;
	} catch (error) {
		fieldLoads.delete(field);
		throw error;
	}
}

async function warmTitleIndex(): Promise<SearchIndexField[]> {
	const engine = await ensureEngine();
	await loadField('title');
	return engine.getLoadedFields();
}

async function warmRemainingIndexes(): Promise<SearchIndexField[]> {
	deferredWarmPromise ??= (async () => {
		await warmTitleIndex();
		await loadField('author');
		await loadField('keyword');
	})();

	await deferredWarmPromise;
	return (await ensureEngine()).getLoadedFields();
}

async function executeSearch(query: string, offset: number, limit: number) {
	const engine = await ensureEngine();
	await loadField('title');

	if (!deferredWarmPromise) {
		void warmRemainingIndexes();
	}

	return engine.search(query, offset, limit);
}

function reply(message: SearchWorkerResponse): void {
	workerScope.postMessage(message);
}

function replyError(id: number, error: unknown): void {
	const message = error instanceof Error ? error.message : 'Unknown search worker error';
	reply({ id, type: 'error', message });
}

workerScope.onmessage = async (event: MessageEvent<SearchWorkerRequest>) => {
	const request = event.data;
	assetBaseUrl = request.assetBase;

	try {
		switch (request.type) {
			case 'warmTitle':
				reply({
					id: request.id,
					type: 'ready',
					loadedFields: await warmTitleIndex()
				});
				return;

			case 'warmRemaining':
				reply({
					id: request.id,
					type: 'ready',
					loadedFields: await warmRemainingIndexes()
				});
				return;

			case 'search':
				reply({
					id: request.id,
					type: 'search-result',
					result: await executeSearch(request.query, request.offset, request.limit)
				});
				return;
		}
	} catch (error) {
		replyError(request.id, error);
	}
};
