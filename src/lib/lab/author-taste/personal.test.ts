import { describe, expect, it } from 'vitest';
import {
	aggregatePersonalAuthorRatings,
	buildPersonalMapNeighborhood,
	personalTasteCenter,
	type PersonalMapNeighborhood,
	type RatedBook
} from './personal';
import type { AuthorIndex } from './authors';
import type { Author } from './types';

function author(id: number, name: string, coords: [number, number, number] | null): Author {
	return {
		id,
		name,
		x: coords?.[0] ?? null,
		y: coords?.[1] ?? null,
		z: coords?.[2] ?? null,
		communityId: 0,
		subcommunityId: -1,
		mapState: coords ? 4 : 0,
		bookCount: 1,
		genre: 'Other',
		connectionPairCount: 0,
		selectedOutDegree: 0,
		selectedInDegree: 0,
		reliableOneSidedOutDegree: 0,
		reliableOneSidedInDegree: 0,
		sampleTitles: [],
		connectionBucket: null,
		connectionOffset: null,
		connectionBytes: null,
		searchKey: name.toLowerCase()
	};
}

function book(authorName: string, id: string): RatedBook['book'] {
	return { id, book_id: id, title: id, author: authorName };
}

function indexFor(...authors: Author[]): AuthorIndex {
	return {
		authors,
		byId: new Map(authors.map((entry) => [entry.id, entry])),
		mapped: authors.filter((entry) => entry.mapState === 4) as AuthorIndex['mapped'],
		connected: [],
		byName: new Map(),
		genres: [],
		communities: [],
		communityById: new Map(),
		subcommunities: [],
		subcommunityByKey: new Map(),
		subcommunitiesByCommunity: new Map(),
		unassignedColor: '#777',
		bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 }
	};
}

function neighborhood(
	nodes: Array<[number, number]>,
	neighbors: Array<[number, number, number]>
): PersonalMapNeighborhood {
	return {
		nodes: new Map(nodes.map(([authorId, localRadius]) => [authorId, { authorId, localRadius }])),
		neighbors: new Map(
			nodes.map(([authorId]) => [
				authorId,
				neighbors
					.filter(([sourceId]) => sourceId === authorId)
					.map(([sourceId, neighborAuthorId, neighborDistance], index) => ({
						authorId: sourceId,
						neighborAuthorId,
						neighborRank: index + 1,
						neighborDistance
					}))
			])
		)
	};
}

describe('personal author ratings', () => {
	it('matches exact author fields, aggregates ratings, and ignores unmapped authors', () => {
		const jane = author(0, 'Jane Austen', [1, 2, 3]);
		const unmapped = author(1, 'Unmapped Author', null);
		const index = indexFor(jane, unmapped);

		const ratings: RatedBook[] = [
			{ book: book('Jane Austen', 'one'), rating: 5 },
			{ book: book('Jane Austen', 'two'), rating: 3 },
			{ book: book('Jane', 'partial-match'), rating: 1 },
			{ book: book('Unmapped Author', 'unmapped'), rating: 1 }
		];

		expect(aggregatePersonalAuthorRatings(index, ratings)).toEqual(
			new Map([[0, { average: 4, count: 2, category: 'loved' }]])
		);
	});

	it('derives deterministic local neighborhoods from the fixed published coordinates', () => {
		const index = indexFor(
			author(0, 'Origin', [0, 0, 0]),
			author(1, 'Near', [1, 0, 0]),
			author(2, 'Tie with higher id', [-1, 0, 0]),
			author(3, 'Far', [4, 0, 0])
		);

		const result = buildPersonalMapNeighborhood(index, [0], 2);
		expect(result.nodes.get(0)?.localRadius).toBe(1);
		expect(result.neighbors.get(0)).toEqual([
			{ authorId: 0, neighborAuthorId: 1, neighborRank: 1, neighborDistance: 1 },
			{ authorId: 0, neighborAuthorId: 2, neighborRank: 2, neighborDistance: 1 }
		]);
	});

	it('does not invent a location from neutral or negative evidence alone', () => {
		const first = author(0, 'First', [0, 0, 0]);
		const second = author(1, 'Second', [2, 4, 6]);
		const index = indexFor(first, second);
		const neutral = aggregatePersonalAuthorRatings(index, [
			{ book: book('First', 'one'), rating: 3 },
			{ book: book('Second', 'two'), rating: 3 }
		]);
		const hated = aggregatePersonalAuthorRatings(index, [
			{ book: book('First', 'one'), rating: 1 }
		]);

		expect(personalTasteCenter(index, neutral)).toBeNull();
		expect(personalTasteCenter(index, hated)).toBeNull();
	});

	it('keeps a one-sided reading history at its loved landmark instead of a global-map vector', () => {
		const classic = author(0, 'Classic', [0, 0, 0]);
		const nearbyClassic = author(1, 'Nearby classic', [1, 0, 0]);
		const crime = author(2, 'Crime', [100, 0, 0]);
		const index = indexFor(classic, nearbyClassic, crime);
		const ratings = aggregatePersonalAuthorRatings(index, [
			{ book: book('Classic', 'classic'), rating: 5 }
		]);
		const localMap = neighborhood([[0, 1]], [[0, 1, 1]]);

		expect(personalTasteCenter(index, ratings, localMap)).toEqual({ x: 0, y: 0, z: 0 });
	});

	it('lets hated authors push locally without making remote map regions eligible', () => {
		const left = author(0, 'Left option', [0, 0, 0]);
		const loved = author(1, 'Loved', [1, 0, 0]);
		const right = author(2, 'Right option', [2, 0, 0]);
		const hated = author(3, 'Hated', [0, 0, 0]);
		const remote = author(4, 'Remote', [100, 0, 0]);
		const index = indexFor(left, loved, right, hated, remote);
		const ratings = aggregatePersonalAuthorRatings(index, [
			{ book: book('Loved', 'loved'), rating: 5 },
			{ book: book('Hated', 'hated'), rating: 1 }
		]);
		const localMap = neighborhood(
			[
				[1, 1],
				[3, 1]
			],
			[
				[1, 0, 1],
				[1, 2, 1]
			]
		);

		expect(personalTasteCenter(index, ratings, localMap)).toEqual({ x: 2, y: 0, z: 0 });
	});

	it('uses only the union of loved local neighborhoods as placement candidates', () => {
		const classicA = author(0, 'Classic A', [0, 0, 0]);
		const classicB = author(1, 'Classic B', [1, 0, 0]);
		const suspense = author(2, 'Suspense', [50, 0, 0]);
		const index = indexFor(classicA, classicB, suspense);
		const ratings = aggregatePersonalAuthorRatings(index, [
			{ book: book('Classic A', 'a'), rating: 5 },
			{ book: book('Classic B', 'b'), rating: 4 }
		]);
		const localMap = neighborhood(
			[
				[0, 1],
				[1, 1]
			],
			[
				[0, 1, 1],
				[1, 0, 1]
			]
		);

		const center = personalTasteCenter(index, ratings, localMap);
		expect(center?.x).toBeLessThanOrEqual(1);
		expect(center?.x).not.toBe(suspense.x);
	});
});
