import { describe, expect, it } from 'vitest';
import { composeDefaultOrder, composeOneSidedFirstOrder } from './order';
import {
	STATUS_ONE_SIDED_SELF_TO_OTHER,
	STATUS_RECIPROCAL,
	type Author,
	type Connection,
	type DirectionalityStatus,
	type DirectionEstimate
} from './types';

function author(id: number): Author {
	return {
		id,
		name: `Author ${id}`,
		x: null,
		y: null,
		z: null,
		communityId: 1,
		subcommunityId: 1,
		mapState: 0,
		bookCount: 3,
		genre: 'Fantasy',
		connectionPairCount: 12,
		selectedOutDegree: 1,
		selectedInDegree: 1,
		reliableOneSidedOutDegree: 0,
		reliableOneSidedInDegree: 0,
		sampleTitles: [],
		connectionBucket: null,
		connectionOffset: null,
		connectionBytes: null,
		searchKey: `author ${id}`
	};
}

function estimate(): DirectionEstimate {
	return {
		selected: true,
		selectionFoldCount: 5,
		rateDifference: 0.2,
		ciLower: 0.1,
		ciUpper: 0.3,
		logOddsRatio: 0.2,
		evidenceScore: 0.2,
		negLog10Q: 2,
		likeRate: 0.7,
		baselineRate: 0.5
	};
}

function connection(id: number, status: DirectionalityStatus): Connection {
	return {
		record: {
			otherId: id,
			pairId: id,
			status,
			selfSign: 1,
			self: estimate(),
			reverse: estimate(),
			asymmetry: null
		},
		other: author(id),
		mapDistance: null
	};
}

describe('one-way-first opening order', () => {
	it('leads with every one-way relationship, in their incoming order', () => {
		const connections = [
			connection(1, STATUS_RECIPROCAL),
			connection(2, STATUS_ONE_SIDED_SELF_TO_OTHER),
			connection(3, STATUS_RECIPROCAL),
			connection(4, STATUS_ONE_SIDED_SELF_TO_OTHER)
		];

		const ordered = composeOneSidedFirstOrder(connections);
		expect(ordered.map((entry) => entry.other.id).slice(0, 2)).toEqual([2, 4]);
		expect(ordered).toHaveLength(connections.length);
		expect(new Set(ordered.map((entry) => entry.other.id))).toEqual(new Set([1, 2, 3, 4]));
	});

	it('falls back to the default opening view when nothing is one-way', () => {
		const connections = [connection(1, STATUS_RECIPROCAL), connection(2, STATUS_RECIPROCAL)];
		expect(composeOneSidedFirstOrder(connections)).toEqual(composeDefaultOrder(connections));
	});
});
