import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ConnectionTable, { type ConnectionTableSnapshot } from './ConnectionTable.svelte';
import type { Author, Connection, DirectionEstimate } from '$lib/lab/author-taste/types';

function author(id: number, name = `Author ${id}`, genre = 'Fantasy'): Author {
	return {
		id,
		name,
		x: null,
		y: null,
		z: null,
		communityId: 1,
		subcommunityId: 1,
		mapState: 0,
		bookCount: 3,
		genre,
		connectionPairCount: 12,
		selectedOutDegree: 1,
		selectedInDegree: 1,
		reliableOneSidedOutDegree: 0,
		reliableOneSidedInDegree: 0,
		sampleTitles: [],
		connectionBucket: null,
		connectionOffset: null,
		connectionBytes: null,
		searchKey: name.toLowerCase()
	};
}

function estimate(rateDifference: number): DirectionEstimate {
	return {
		selected: true,
		selectionFoldCount: 5,
		rateDifference,
		ciLower: rateDifference - 0.01,
		ciUpper: rateDifference + 0.01,
		logOddsRatio: rateDifference,
		evidenceScore: Math.abs(rateDifference),
		negLog10Q: 2,
		likeRate: 0.5 + rateDifference,
		baselineRate: 0.5
	};
}

function connection(id: number, effect: number, genre = 'Fantasy'): Connection {
	return {
		record: {
			otherId: id,
			pairId: id,
			status: 1,
			selfSign: effect >= 0 ? 1 : -1,
			self: estimate(effect),
			reverse: estimate(effect / 2),
			asymmetry: null
		},
		other: author(id, `Author ${id}`, genre),
		mapDistance: null
	};
}

it('publishes the same stable prefix that the table renders', async () => {
	const snapshots: ConnectionTableSnapshot[] = [];
	const connections = Array.from({ length: 12 }, (_, index) =>
		connection(index + 1, 0.4 - index / 100)
	);
	const rendered = render(ConnectionTable, {
		focus: author(0, 'Focus'),
		connections,
		limit: 10,
		onVisibleRowsChange: (snapshot: ConnectionTableSnapshot) => snapshots.push(snapshot),
		onCompareAuthor: () => undefined
	});

	await expect
		.element(rendered.getByRole('button', { name: 'Compare Focus and Author 10' }))
		.toBeVisible();
	await expect.poll(() => snapshots.at(-1)?.rows.length).toBe(10);
	const firstTen = snapshots.at(-1)!.rows.map((row) => row.other.id);

	await rendered.rerender({ limit: 11 });
	await expect
		.element(rendered.getByRole('button', { name: 'Compare Focus and Author 11' }))
		.toBeVisible();
	await expect.poll(() => snapshots.at(-1)?.rows.length).toBe(11);
	const next = snapshots.at(-1)!;
	expect(next.rows.slice(0, 10).map((row) => row.other.id)).toEqual(firstTen);
	expect(next.rows).toHaveLength(11);
	expect(next.filteredCount).toBe(12);
	expect(next.totalCount).toBe(12);
	expect(next.hasFilters).toBe(false);
});

it('publishes filter counts and never backfills outside the filtered prefix', async () => {
	const snapshots: ConnectionTableSnapshot[] = [];
	const connections = [
		connection(1, 0.4, 'Fantasy'),
		connection(2, 0.3, 'Mystery'),
		connection(3, 0.2, 'Fantasy'),
		connection(4, 0.1, 'Mystery')
	];
	const rendered = render(ConnectionTable, {
		focus: author(0, 'Focus'),
		connections,
		limit: 3,
		onVisibleRowsChange: (snapshot: ConnectionTableSnapshot) => snapshots.push(snapshot),
		onCompareAuthor: () => undefined
	});

	await rendered.getByLabelText('Search authors').fill('Author 3');
	await expect
		.element(rendered.getByRole('button', { name: 'Compare Focus and Author 3' }))
		.toBeVisible();
	await expect.poll(() => snapshots.at(-1)?.filteredCount).toBe(1);
	const snapshot = snapshots.at(-1)!;
	expect(snapshot.rows.map((row) => row.other.id)).toEqual([3]);
	expect(snapshot.hasFilters).toBe(true);
});
