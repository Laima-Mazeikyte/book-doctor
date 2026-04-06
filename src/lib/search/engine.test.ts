import { Index } from 'flexsearch';
import { describe, expect, it } from 'vitest';

import { SearchEngine } from './engine';
import type { ExportChunk, SearchBookDocument, SearchIndexManifest } from './types';

async function exportIndex(index: Index): Promise<ExportChunk[]> {
	const chunks: ExportChunk[] = [];
	await index.export((key, data) => {
		chunks.push([key, data]);
	});
	return chunks;
}

function manifestFixture(): SearchIndexManifest {
	return {
		version: 1,
		generatedAt: '',
		documentCount: 2,
		documents: { file: 'documents.msgpack', bytes: 0, chunkCount: 0 },
		fields: {
			title: {
				field: 'title',
				weight: 5,
				loadPhase: 'focus',
				file: 'title.msgpack',
				bytes: 0,
				chunkCount: 0
			},
			author: {
				field: 'author',
				weight: 3,
				loadPhase: 'deferred',
				file: 'author.msgpack',
				bytes: 0,
				chunkCount: 0
			},
			keyword: {
				field: 'keyword',
				weight: 1,
				loadPhase: 'deferred',
				file: 'keyword.msgpack',
				bytes: 0,
				chunkCount: 0
			}
		}
	};
}

describe('SearchEngine', () => {
	const books: SearchBookDocument[] = [
		{ id: '1', title: 'Alpha Chronicle', author: 'Zed Quill', book_id: 1 },
		{ id: '2', title: 'Beta Almanac', author: 'Amy Author', book_id: 2 }
	];

	it('returns empty page for blank query', () => {
		const engine = new SearchEngine(manifestFixture(), books);
		const page = engine.search('   ', 0, 24);
		expect(page.books).toEqual([]);
		expect(page.hasMore).toBe(false);
		expect(page.source).toBe('flexsearch');
	});

	it('ranks title matches and paginates', async () => {
		const titleIndex = new Index({
			tokenize: 'forward',
			encoder: 'LatinBalance',
			resolution: 9,
			cache: 100,
			fastupdate: false
		});
		for (const b of books) {
			titleIndex.add(b.id, b.title);
		}
		const titleChunks = await exportIndex(titleIndex);

		const authorIndex = new Index({
			tokenize: 'forward',
			encoder: 'LatinBalance',
			resolution: 9,
			cache: 100,
			fastupdate: false
		});
		for (const b of books) {
			authorIndex.add(b.id, b.author);
		}
		const authorChunks = await exportIndex(authorIndex);

		const engine = new SearchEngine(manifestFixture(), books);
		engine.importField('title', titleChunks);
		engine.importField('author', authorChunks);

		const page = engine.search('Alpha', 0, 1);
		expect(page.books).toHaveLength(1);
		expect(page.books[0]?.id).toBe('1');
		expect(page.hasMore).toBe(false);

		const page2 = engine.search('Alpha', 1, 1);
		expect(page2.books).toHaveLength(0);
		expect(page2.hasMore).toBe(false);
	});

	it('dedupes by id across loaded fields in one ranked list', async () => {
		const titleIndex = new Index({
			tokenize: 'forward',
			encoder: 'LatinBalance',
			resolution: 9,
			cache: 100,
			fastupdate: false
		});
		titleIndex.add(books[0]!.id, books[0]!.title);
		const titleChunks = await exportIndex(titleIndex);

		const authorIndex = new Index({
			tokenize: 'forward',
			encoder: 'LatinBalance',
			resolution: 9,
			cache: 100,
			fastupdate: false
		});
		authorIndex.add(books[0]!.id, books[0]!.author);
		const authorChunks = await exportIndex(authorIndex);

		const engine = new SearchEngine(manifestFixture(), books);
		engine.importField('title', titleChunks);
		engine.importField('author', authorChunks);

		const page = engine.search('Alpha', 0, 10);
		const ids = page.books.map((b) => b.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
