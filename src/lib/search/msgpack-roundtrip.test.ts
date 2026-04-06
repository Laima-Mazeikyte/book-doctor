import { decode, encode } from '@msgpack/msgpack';
import { describe, expect, it } from 'vitest';

import { SEARCH_ASSET_VERSION } from './types';

describe('search MessagePack payloads', () => {
	it('round-trips a manifest-shaped object', () => {
		const manifest = {
			version: SEARCH_ASSET_VERSION,
			generatedAt: '2026-01-01T00:00:00.000Z',
			documentCount: 2,
			documents: { file: 'documents.msgpack', bytes: 10, chunkCount: 1 },
			fields: {
				title: {
					field: 'title',
					weight: 5,
					loadPhase: 'focus',
					file: 'title.msgpack',
					bytes: 20,
					chunkCount: 3
				},
				author: {
					field: 'author',
					weight: 3,
					loadPhase: 'deferred',
					file: 'author.msgpack',
					bytes: 15,
					chunkCount: 2
				},
				keyword: {
					field: 'keyword',
					weight: 1,
					loadPhase: 'deferred',
					file: 'keyword.msgpack',
					bytes: 12,
					chunkCount: 2
				}
			}
		};

		const decoded = decode(encode(manifest)) as typeof manifest;
		expect(decoded.version).toBe(SEARCH_ASSET_VERSION);
		expect(decoded.fields.title.file).toBe('title.msgpack');
		expect(decoded.documentCount).toBe(2);
	});
});
