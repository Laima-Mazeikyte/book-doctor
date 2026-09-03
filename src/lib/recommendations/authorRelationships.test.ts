import { describe, expect, it } from 'vitest';
import {
	buildAuthorRelationshipAuthorsByBookId,
	buildCleanLikedAuthorSet,
	filterAuthorRelationshipAuthors,
	normalizeAuthorRelationshipEvidence
} from './authorRelationships';

describe('normalizeAuthorRelationshipEvidence', () => {
	it('turns SQL NULL into an empty list and retains ordered string entries', () => {
		expect(normalizeAuthorRelationshipEvidence(null)).toEqual([]);
		expect(normalizeAuthorRelationshipEvidence(['First', 42, null, 'Second'])).toEqual([
			'First',
			'Second'
		]);
	});
});

describe('buildAuthorRelationshipAuthorsByBookId', () => {
	it('preserves backend order and keeps the newest row for duplicate books', () => {
		expect(
			buildAuthorRelationshipAuthorsByBookId([
				{
					book_id: 'book-1',
					author_relationship_evidence: ['Newest first', 'Newest second']
				},
				{
					book_id: 'book-1',
					author_relationship_evidence: ['Older evidence']
				},
				{ book_id: 'book-2', author_relationship_evidence: null }
			])
		).toEqual({
			'book-1': ['Newest first', 'Newest second'],
			'book-2': []
		});
	});
});

describe('buildCleanLikedAuthorSet', () => {
	const rated = (author: string, rating: 1 | 2 | 3 | 4 | 5) => ({
		book: { author },
		rating
	});

	it('qualifies an author with an explicit 4 or 5 rating', () => {
		expect(buildCleanLikedAuthorSet([rated('Liked author', 4)])).toEqual(new Set(['Liked author']));
	});

	it('excludes an author with any explicit 1 through 3 rating', () => {
		expect(buildCleanLikedAuthorSet([rated('Mixed author', 5), rated('Mixed author', 2)])).toEqual(
			new Set()
		);
	});

	it('excludes an author without an explicit rating', () => {
		expect(filterAuthorRelationshipAuthors(['Unrated author'], new Set())).toEqual([]);
	});
});

describe('filterAuthorRelationshipAuthors', () => {
	it('returns at most the first three surviving candidates', () => {
		expect(
			filterAuthorRelationshipAuthors(
				['First', 'Second', 'Third', 'Fourth', 'Fifth'],
				new Set(['First', 'Second', 'Third', 'Fourth', 'Fifth'])
			)
		).toEqual(['First', 'Second', 'Third']);
	});
});
