import { describe, expect, it, vi } from 'vitest';
import {
	comparePair,
	composeDefaultOrder,
	connectionStrength,
	isOneSided,
	loadNeighbourhood
} from './client';
import type { ConnectionStore } from './client';
import type { AuthorIndex } from './authors';
import type { Author, Connection, ConnectionRecord, DirectionEstimate } from './types';

function estimate(overrides: Partial<DirectionEstimate> = {}): DirectionEstimate {
	return {
		selected: true,
		selectionFoldCount: 5,
		rateDifference: 0.1,
		ciLower: 0.05,
		ciUpper: 0.15,
		logOddsRatio: 0.4,
		evidenceScore: 0.3,
		negLog10Q: 4,
		likeRate: 0.6,
		baselineRate: 0.5,
		...overrides
	};
}

function record(overrides: Partial<ConnectionRecord> = {}): ConnectionRecord {
	return {
		otherId: 2,
		pairId: 77,
		status: 1,
		selfSign: 1,
		self: estimate(),
		reverse: estimate(),
		asymmetry: { difference: 0.15, ciLower: 0.12, ciUpper: 0.18, negLog10Q: 3 },
		...overrides
	};
}

function author(id: number, overrides: Partial<Author> = {}): Author {
	return {
		id,
		name: `Author ${id}`,
		x: 0,
		y: 0,
		z: 0,
		communityId: 0,
		subcommunityId: 0,
		mapState: 4,
		bookCount: 3,
		genre: 'Literary Fiction',
		connectionPairCount: 1,
		selectedOutDegree: 1,
		selectedInDegree: 1,
		reliableOneSidedOutDegree: 0,
		reliableOneSidedInDegree: 0,
		sampleTitles: [],
		connectionBucket: 0,
		connectionOffset: 0,
		connectionBytes: 108,
		searchKey: `author ${id}`,
		...overrides
	};
}

/** A store stubbed with per-author record lists, counting how often each is read. */
function stubStore(byAuthor: Record<number, ConnectionRecord[]>) {
	const records = vi.fn(async (a: Author) => byAuthor[a.id] ?? []);
	return { store: { records } as unknown as ConnectionStore, records };
}

describe('comparePair', () => {
	const a = author(1);
	const b = author(2);

	it('returns the record from the first author when it carries the pair', () => {
		const mine = record({ otherId: 2 });
		const { store } = stubStore({ 1: [mine] });
		return expect(comparePair(store, a, b)).resolves.toMatchObject({ pairId: 77, status: 1 });
	});

	it('flips the partner record when the first author has no block', () => {
		const theirs = record({ otherId: 1, status: 2, self: estimate({ rateDifference: 0.2 }) });
		const { store } = stubStore({ 2: [theirs] });
		const unindexed = author(1, { connectionBucket: null, connectionBytes: null });

		return comparePair(store, unindexed, b).then((result) => {
			expect(result?.otherId).toBe(1);
			// Their self → other becomes our reverse, and the one-sided verdict flips with it.
			expect(result?.status).toBe(3);
			expect(result?.reverse.rateDifference).toBeCloseTo(0.2, 5);
		});
	});

	it('returns null when neither endpoint retained the pair', () => {
		const { store } = stubStore({});
		return expect(comparePair(store, a, b)).resolves.toBeNull();
	});

	/*
	 * The regression this exists for. The endpoint whose verdict runs other → self carries no
	 * asymmetry; without recovery the panel reported "no measurable gap" for exactly the pairs
	 * whose gap is best established.
	 */
	/*
	 * The artifact now negates the opposite orientation into each copy itself, and an absent
	 * gap means neither orientation has one. So an absent gap stays absent — reaching into the
	 * partner for it would only invent a number the release declined to state.
	 */
	it('leaves an absent asymmetry absent rather than borrowing the partner', () => {
		const mine = record({ otherId: 2, status: 3, asymmetry: null });
		const theirs = record({
			otherId: 1,
			status: 2,
			asymmetry: { difference: 0.15, ciLower: 0.12, ciUpper: 0.18, negLog10Q: 3 }
		});
		const { store } = stubStore({ 1: [mine], 2: [theirs] });

		return comparePair(store, a, b).then((result) => {
			expect(result?.status).toBe(3);
			expect(result?.asymmetry).toBeNull();
		});
	});

	it('keeps each orientation own independently estimated gap', () => {
		const mine = record({
			otherId: 2,
			asymmetry: { difference: 0.112, ciLower: -0.005, ciUpper: 0.229, negLog10Q: 1 }
		});
		const { store } = stubStore({ 1: [mine], 2: [record({ otherId: 1 })] });

		// Not replaced by the partner's, which for reciprocal pairs is a separate estimate.
		return comparePair(store, a, b).then((result) => {
			expect(result?.asymmetry?.difference).toBeCloseTo(0.112, 5);
		});
	});

	it('recovers the reverse fold count from the partner', () => {
		const mine = record({
			otherId: 2,
			status: 3,
			self: estimate({ selectionFoldCount: 0 }),
			reverse: estimate({ selectionFoldCount: null })
		});
		const theirs = record({
			otherId: 1,
			status: 2,
			self: estimate({ selectionFoldCount: 5 }),
			reverse: estimate({ selectionFoldCount: null })
		});
		const { store, records } = stubStore({ 1: [mine], 2: [theirs] });

		return comparePair(store, a, b).then((result) => {
			// 0 of 5 for this direction, 5 of 5 for the reverse — the pair that drives the verdict.
			expect(result?.self.selectionFoldCount).toBe(0);
			expect(result?.reverse.selectionFoldCount).toBe(5);
			expect(records).toHaveBeenCalledTimes(2);
		});
	});

	it('does not read the partner when nothing is missing', () => {
		const mine = record({ otherId: 2 });
		const { store, records } = stubStore({ 1: [mine], 2: [record({ otherId: 1 })] });

		return comparePair(store, a, b).then(() => {
			expect(records).toHaveBeenCalledTimes(1);
		});
	});

	it('leaves the reverse fold count unknown when the partner has no block', () => {
		const mine = record({
			otherId: 2,
			status: 3,
			reverse: estimate({ selectionFoldCount: null })
		});
		const { store } = stubStore({ 1: [mine] });
		const unindexedPartner = author(2, { connectionBucket: null, connectionBytes: null });

		return comparePair(store, a, unindexedPartner).then((result) => {
			expect(result?.reverse.selectionFoldCount).toBeNull();
		});
	});
});

describe('connectionStrength', () => {
	it('takes the stronger of the two directions', () => {
		const value = connectionStrength(
			record({
				self: estimate({ evidenceScore: 0.2 }),
				reverse: estimate({ evidenceScore: 0.9 })
			})
		);
		expect(value).toBeCloseTo(0.9, 5);
	});
});

describe('isOneSided', () => {
	it('is true for exactly the two oriented verdicts', () => {
		expect([0, 1, 2, 3, 4].map((s) => isOneSided(record({ status: s as 0 })))).toEqual([
			false,
			false,
			true,
			true,
			false
		]);
	});
});

describe('loadNeighbourhood', () => {
	function indexOf(authors: Author[]): AuthorIndex {
		return { byId: new Map(authors.map((a) => [a.id, a])) } as unknown as AuthorIndex;
	}

	it('returns every relationship, strongest first and untruncated', () => {
		const focus = author(1);
		const others = [2, 3, 4, 5].map((id) => author(id));
		// Strength is the stronger of the two directions, so both are pinned to keep it unambiguous.
		const scored = (otherId: number, status: 0 | 1 | 2 | 4, score: number) =>
			record({
				otherId,
				status,
				self: estimate({ evidenceScore: score }),
				reverse: estimate({ evidenceScore: 0 })
			});
		const records = [scored(2, 1, 0.9), scored(3, 4, 0.1), scored(4, 2, 0.2), scored(5, 0, 0.95)];
		const { store } = stubStore({ 1: records });

		return loadNeighbourhood(store, indexOf([focus, ...others]), focus).then((result) => {
			// Sorting and filtering happen in the table, which needs the whole list to do either.
			expect(result.connections.map((c) => c.other.id)).toEqual([5, 2, 4, 3]);
			expect(result.total).toBe(4);
			expect(result.oneSidedTotal).toBe(1);
			expect(result.opposingTotal).toBe(1);
		});
	});

	it('drops a record naming an author outside the index rather than failing', () => {
		const focus = author(1);
		const known = author(2);
		const { store } = stubStore({
			1: [record({ otherId: 2 }), record({ otherId: 999 })]
		});

		return loadNeighbourhood(store, indexOf([focus, known]), focus).then((result) => {
			expect(result.connections.map((c) => c.other.id)).toEqual([2]);
			// The tally still reflects what the release actually holds.
			expect(result.total).toBe(2);
		});
	});
});

describe('composeDefaultOrder', () => {
	const connectionOf = (id: number, status: 0 | 1 | 2 | 3 | 4, score: number): Connection => ({
		record: record({ otherId: id, status, self: estimate({ evidenceScore: score }) }),
		other: author(id),
		mapDistance: null
	});

	/** Strongest first, as `loadNeighbourhood` hands them over. */
	const strongest = (count: number, status: 0 | 1 = 1) =>
		Array.from({ length: count }, (_, i) => connectionOf(100 + i, status, 1 - i / 1000));

	it('fills the view from the strength ranking when nothing is notable', () => {
		const rows = composeDefaultOrder(strongest(30), 10);
		expect(rows).toHaveLength(10);
		expect(rows.map((r) => r.other.id)).toEqual(strongest(10).map((r) => r.other.id));
	});

	/*
	 * The point of the blend. Leading with one-way results fills the first screen with the rare
	 * rather than the strong; ranking purely by strength buries them entirely.
	 */
	it('keeps the strongest at the top and appends notable results below them', () => {
		const weakOneWay = connectionOf(1, 2, 0.01);
		const weakOpposing = connectionOf(2, 4, 0.005);
		const rows = composeDefaultOrder([...strongest(30), weakOneWay, weakOpposing], 12);

		expect(rows).toHaveLength(12);
		// The first ten are still the strongest, in strength order.
		expect(rows.slice(0, 10).map((r) => r.other.id)).toEqual(strongest(10).map((r) => r.other.id));
		// The two notable ones follow, despite being the weakest in the set.
		expect(rows.slice(10).map((r) => r.other.id)).toEqual([1, 2]);
	});

	it('does not repeat a notable result that already made the strength cut', () => {
		const strongOneWay = connectionOf(1, 2, 5);
		const rows = composeDefaultOrder([strongOneWay, ...strongest(30)], 12);
		expect(rows.filter((r) => r.other.id === 1)).toHaveLength(1);
		expect(rows[0].other.id).toBe(1);
	});

	it('never gives more than a third of a small view to the tail', () => {
		const notable = [1, 2, 3, 4, 5, 6].map((id) => connectionOf(id, 2, 0.01));
		const rows = composeDefaultOrder([...strongest(20), ...notable], 6);
		expect(rows).toHaveLength(6);
		// 6 / 3 = 2 reserved, so four strength rows survive.
		expect(rows.slice(0, 4).map((r) => r.other.id)).toEqual(strongest(4).map((r) => r.other.id));
		expect(rows.slice(4)).toHaveLength(2);
	});

	it('returns everything when there is less than a full view', () => {
		expect(composeDefaultOrder(strongest(3), 24)).toHaveLength(3);
	});
});
