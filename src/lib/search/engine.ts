import { Index } from 'flexsearch';

import type {
	ExportChunk,
	SearchBookDocument,
	SearchIndexField,
	SearchIndexManifest,
	SearchResultPage
} from './types';

type SearchScoreEntry = {
	score: number;
	positions: Partial<Record<SearchIndexField, number>>;
};

const FIELD_OPTIONS = {
	title: {
		tokenize: 'forward',
		encoder: 'LatinBalance',
		resolution: 9,
		cache: 100
	},
	author: {
		tokenize: 'forward',
		encoder: 'LatinBalance',
		resolution: 9,
		cache: 100
	},
	keyword: {
		tokenize: 'strict',
		encoder: 'LatinBalance',
		resolution: 7,
		cache: 100
	}
} as const;

function createFieldIndex(field: SearchIndexField): Index {
	return new Index({
		...FIELD_OPTIONS[field],
		fastupdate: false
	});
}

function sortLoadedFields(fields: Iterable<SearchIndexField>): SearchIndexField[] {
	const order: SearchIndexField[] = ['title', 'author', 'keyword'];
	return order.filter((field) => Array.from(fields).includes(field));
}

function boostForDocument(field: SearchIndexField, document: SearchBookDocument, query: string): number {
	const normalizedQuery = query.toLowerCase();

	if (field === 'title') {
		const title = document.title.toLowerCase();
		if (title === normalizedQuery) return 6;
		if (title.startsWith(normalizedQuery)) return 3;
		if (title.includes(normalizedQuery)) return 1;
		return 0;
	}

	if (field === 'author') {
		const author = document.author.toLowerCase();
		if (author === normalizedQuery) return 4;
		if (author.startsWith(normalizedQuery)) return 2;
		if (author.includes(normalizedQuery)) return 0.5;
		return 0;
	}

	const haystack = [
		document.summary ?? '',
		document.year ?? '',
		document.type ?? '',
		...(document.genres ?? [])
	]
		.join(' ')
		.toLowerCase();

	return haystack.includes(normalizedQuery) ? 0.5 : 0;
}

export class SearchEngine {
	private readonly documents = new Map<string, SearchBookDocument>();
	private readonly indexes: Partial<Record<SearchIndexField, Index>> = {};
	private readonly loadedFields = new Set<SearchIndexField>();

	constructor(private readonly manifest: SearchIndexManifest, documents: SearchBookDocument[]) {
		for (const document of documents) {
			this.documents.set(String(document.id), document);
		}
	}

	importField(field: SearchIndexField, chunks: ExportChunk[]): void {
		if (this.loadedFields.has(field)) return;

		const index = createFieldIndex(field);

		for (const [key, data] of chunks) {
			index.import(key, data);
		}

		this.indexes[field] = index;
		this.loadedFields.add(field);
	}

	getLoadedFields(): SearchIndexField[] {
		return sortLoadedFields(this.loadedFields);
	}

	search(query: string, offset: number, limit: number): SearchResultPage {
		const trimmedQuery = query.trim();
		if (!trimmedQuery) {
			return {
				books: [],
				nextOffset: 0,
				hasMore: false,
				source: 'flexsearch',
				loadedFields: this.getLoadedFields()
			};
		}

		const candidateLimit = Math.max(100, offset + limit * 4);
		const scores = new Map<string, SearchScoreEntry>();

		for (const field of this.getLoadedFields()) {
			const index = this.indexes[field];
			if (!index) continue;

			const ids = index.search(trimmedQuery, { limit: candidateLimit });
			const weight = this.manifest.fields[field].weight;

			ids.forEach((id, position) => {
				const normalizedId = String(id);
				const document = this.documents.get(normalizedId);
				if (!document) return;

				const existing = scores.get(normalizedId) ?? {
					score: 0,
					positions: {}
				};

				existing.positions[field] = position;
				existing.score += weight * ((candidateLimit - position) / candidateLimit);
				existing.score += boostForDocument(field, document, trimmedQuery);

				scores.set(normalizedId, existing);
			});
		}

		const ranked = Array.from(scores.entries())
			.sort((a, b) => {
				if (b[1].score !== a[1].score) {
					return b[1].score - a[1].score;
				}

				const left = this.documents.get(a[0]);
				const right = this.documents.get(b[0]);
				return (left?.title ?? '').localeCompare(right?.title ?? '');
			})
			.map(([id]) => this.documents.get(id))
			.filter((document): document is SearchBookDocument => Boolean(document));

		const start = offset;
		const end = offset + limit;
		const books = ranked.slice(start, end);

		return {
			books,
			nextOffset: end,
			hasMore: ranked.length > end,
			source: 'flexsearch',
			loadedFields: this.getLoadedFields()
		};
	}
}
