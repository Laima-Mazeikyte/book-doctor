import { describe, expect, it } from 'vitest';
import {
	availability,
	buildAuthorIndex,
	decodeCommunities,
	decodeSubcommunities,
	searchAuthors,
	subcommunityMembers,
	type AuthorIndexInput
} from './authors';
import { hasConnections, isMapped, subcommunityKey, type Community } from './types';

const GENRES = ['Literary Fiction', 'Fantasy', 'Other'];

const COMMUNITIES: Community[] = [
	{
		id: 0,
		size: 2,
		label: 'Literary Classics & Ideas',
		labelComponents: ['Literary Fiction', 'Philosophy'],
		dominantGenre: 'Literary Fiction',
		dominantGenreFraction: 0.5,
		representativeAuthors: ['A Writer'],
		color: '#4477AA'
	}
];

/**
 * The release's live column order, with `subcommunity_id` at index 5. Declared once so the
 * fixtures below stay honest about what the artifact actually ships.
 */
const COLUMNS = [
	'author',
	'x',
	'y',
	'z',
	'community_id',
	'subcommunity_id',
	'map_state',
	'book_count',
	'dominant_genre_index',
	'connection_pair_count',
	'selected_out_degree',
	'selected_in_degree',
	'reliable_one_sided_out_degree',
	'reliable_one_sided_in_degree',
	'sample_titles',
	'connection_bucket',
	'connection_offset',
	'connection_bytes'
];

/**
 * A row in the artifact's declared column order. Mirrors the real shapes the release
 * produces: mapped authors carry coordinates, unmapped ones carry nulls, and the connection
 * index is null for the 25k authors with no retained pairs.
 */
function row(
	name: string,
	options: {
		coords?: [number, number, number] | null;
		communityId?: number;
		subcommunityId?: number;
		mapState?: number;
		connectionPairCount?: number;
		genreIndex?: number;
		connection?: [number, number, number] | null;
	} = {}
): unknown[] {
	const coords = options.coords ?? null;
	const connection = options.connection ?? null;
	return [
		name,
		coords?.[0] ?? null,
		coords?.[1] ?? null,
		coords?.[2] ?? null,
		options.communityId ?? -1,
		options.subcommunityId ?? -1,
		options.mapState ?? 0,
		3,
		options.genreIndex ?? 0,
		options.connectionPairCount ?? 5,
		2,
		1,
		0,
		0,
		['A Title'],
		connection?.[0] ?? null,
		connection?.[1] ?? null,
		connection?.[2] ?? null
	];
}

function build(rows: unknown[][], overrides: Partial<AuthorIndexInput> = {}) {
	return buildAuthorIndex({
		rows,
		columns: COLUMNS,
		genres: GENRES,
		communities: COMMUNITIES,
		subcommunities: [],
		unassignedColor: '#777777',
		...overrides
	});
}

describe('buildAuthorIndex', () => {
	it('assigns ids from the row index rather than a stored field', () => {
		const index = build([row('First'), row('Second'), row('Third')]);
		expect(index.authors.map((a) => a.id)).toEqual([0, 1, 2]);
		expect(index.byId.get(1)?.name).toBe('Second');
	});

	/*
	 * The two populations overlap without nesting. Conflating them is the mistake the UI most
	 * needs to avoid: 1,240 authors in the real release have evidence but no coordinates, and
	 * 258 sit on the map with no retained pairs.
	 */
	it('separates the mapped population from the connected one', () => {
		const index = build([
			row('Both', { coords: [1, 2, 3], mapState: 4, connection: [0, 0, 108] }),
			row('Connections only', { mapState: 2, connection: [1, 0, 108] }),
			row('Map only', { coords: [4, 5, 6], mapState: 4 }),
			row('Neither', { mapState: 0 })
		]);

		expect(index.mapped.map((a) => a.name)).toEqual(['Both', 'Map only']);
		expect(index.connected.map((a) => a.name)).toEqual(['Both', 'Connections only']);
		expect(index.authors.map(availability)).toEqual([
			'both',
			'connectionsOnly',
			'mapOnly',
			'neither'
		]);
	});

	it('treats a zero-byte connection block as no connections', () => {
		const index = build([row('Empty', { mapState: 1, connection: [3, 240, 0] })]);
		expect(hasConnections(index.authors[0])).toBe(false);
		expect(index.connected).toHaveLength(0);
	});

	it('keeps bucket zero and offset zero distinct from absent', () => {
		const index = build([row('At origin', { mapState: 2, connection: [0, 0, 108] })]);
		const author = index.authors[0];
		expect(author.connectionBucket).toBe(0);
		expect(author.connectionOffset).toBe(0);
		expect(hasConnections(author)).toBe(true);
	});

	it('rejects a mapped author with an incomplete coordinate triple', () => {
		const broken = row('Half mapped', { mapState: 4 });
		broken[1] = 1.5;
		broken[2] = null;
		expect(() => build([broken])).toThrow(/incomplete coordinate/);
	});

	it('rejects a row with too few columns', () => {
		expect(() => build([[1, 2, 3]])).toThrow(/expected 18/);
	});

	/*
	 * The regression this whole approach exists for. A rebuild of this release inserted
	 * `subcommunity_id` at index 5, shifting ten later columns; a positional decoder kept
	 * parsing and silently read map states as book counts. Resolving by name must make column
	 * order irrelevant.
	 */
	it('reads columns by name, not position', () => {
		const shuffled = ['connection_pair_count', 'author', 'map_state', 'x', 'y', 'z'];
		const rest = COLUMNS.filter((name) => !shuffled.includes(name));
		const columns = [...shuffled, ...rest];

		const source = row('Reordered', { coords: [1, 2, 3], mapState: 4, connectionPairCount: 4242 });
		const reordered = columns.map((name) => source[COLUMNS.indexOf(name)]);

		const index = build([reordered], { columns });
		const author = index.authors[0];
		expect(author.name).toBe('Reordered');
		expect(author.connectionPairCount).toBe(4242);
		expect(author.mapState).toBe(4);
		expect(author.x).toBe(1);
		expect(index.mapped).toHaveLength(1);
	});

	it('rejects a payload missing a required column instead of guessing', () => {
		const columns = COLUMNS.filter((name) => name !== 'map_state');
		expect(() => build([row('Anyone')], { columns })).toThrow(/required column "map_state"/);
	});

	it('treats an absent subcommunity column as every author unassigned', () => {
		const columns = COLUMNS.filter((name) => name !== 'subcommunity_id');
		const source = row('Older release', { coords: [1, 2, 3], mapState: 4, communityId: 0 });
		const trimmed = columns.map((name) => source[COLUMNS.indexOf(name)]);

		const index = build([trimmed], { columns });
		expect(index.authors[0].subcommunityId).toBe(-1);
		expect(index.authors[0].communityId).toBe(0);
	});

	it('computes bounds over the mapped population only', () => {
		const index = build([
			row('A', { coords: [-2, 0, 1], mapState: 4 }),
			row('B', { coords: [5, 3, -4], mapState: 4 }),
			row('Unmapped', { mapState: 2, connection: [0, 0, 108] })
		]);
		expect(index.bounds).toEqual({ minX: -2, maxX: 5, minY: 0, maxY: 3, minZ: -4, maxZ: 1 });
	});

	it('falls back to the last genre when the index is out of range', () => {
		const index = build([row('Odd', { genreIndex: 99 })]);
		expect(index.authors[0].genre).toBe('Other');
	});

	it('narrows mapped authors to a drawable coordinate triple', () => {
		const index = build([row('Drawable', { coords: [1, 2, 3], mapState: 4 })]);
		expect(isMapped(index.authors[0])).toBe(true);
		expect(index.mapped[0].x).toBe(1);
	});
});

describe('searchAuthors', () => {
	const index = build([
		row('Ursula K. Le Guin', { connectionPairCount: 500 }),
		row('Guinevere Small', { connectionPairCount: 10 }),
		row('Guinevere Large', { connectionPairCount: 900 }),
		row('Unrelated Name', { connectionPairCount: 5000 })
	]);

	it('ranks prefix matches above interior ones', () => {
		const results = searchAuthors(index, 'guin', 10).map((a) => a.name);
		// Both Guineveres start with the needle; Le Guin only contains it.
		expect(results.slice(0, 2)).toEqual(['Guinevere Large', 'Guinevere Small']);
		expect(results[2]).toBe('Ursula K. Le Guin');
	});

	it('ranks by retained connection evidence within a tier', () => {
		const results = searchAuthors(index, 'guinevere', 10).map((a) => a.name);
		expect(results).toEqual(['Guinevere Large', 'Guinevere Small']);
	});

	it('ignores case, accents and punctuation', () => {
		const accented = build([row('Émile Zola')]);
		expect(searchAuthors(accented, 'emile', 5)).toHaveLength(1);
		expect(searchAuthors(accented, 'EMILE ZOLA', 5)).toHaveLength(1);
	});

	it('returns nothing for an empty or punctuation-only query', () => {
		expect(searchAuthors(index, '   ', 5)).toEqual([]);
		expect(searchAuthors(index, '!!!', 5)).toEqual([]);
	});
});

describe('decodeCommunities', () => {
	it('maps columns by name rather than position', () => {
		const columns = [
			'color',
			'community_id',
			'label',
			'size',
			'dominant_genre',
			'dominant_genre_fraction',
			'representative_authors'
		];
		const [community] = decodeCommunities(
			[['#AABBCC', 4, 'Community 5 · Fantasy–leaning', 677, 'Fantasy', 0.35, ['Neil Gaiman']]],
			columns
		);
		expect(community).toEqual({
			id: 4,
			size: 677,
			label: 'Community 5 · Fantasy–leaning',
			labelComponents: [],
			dominantGenre: 'Fantasy',
			dominantGenreFraction: 0.35,
			representativeAuthors: ['Neil Gaiman'],
			color: '#AABBCC'
		});
	});

	it('reads the curated label components the rebuild added', () => {
		const [community] = decodeCommunities(
			[[0, 1992, 'Literary Classics & Ideas', ['Literary Fiction', 'Philosophy'], '#4477AA']],
			['community_id', 'size', 'label', 'label_components', 'color']
		);
		expect(community.label).toBe('Literary Classics & Ideas');
		expect(community.labelComponents).toEqual(['Literary Fiction', 'Philosophy']);
	});

	it('rejects a payload missing the identifying columns', () => {
		expect(() => decodeCommunities([[1]], ['size'])).toThrow(/community_id/);
	});
});

describe('decodeSubcommunities', () => {
	const COLUMNS = [
		'community_id',
		'subcommunity_id',
		'size',
		'label',
		'label_components',
		'label_method',
		'parent_label',
		'genre_composition',
		'representative_authors'
	];

	const rows = [
		[
			0,
			0,
			957,
			'Literary Fiction · Group 1',
			['Literary Fiction'],
			'broad_genre_composition_v1',
			'Literary Classics & Ideas',
			[{ genre: 'Literary Fiction', count: 645, fraction: 0.674 }],
			['Margaret Atwood']
		],
		[
			1,
			0,
			690,
			'Literary Fiction & Romance',
			['Literary Fiction', 'Romance'],
			'broad_genre_composition_v1',
			'Crime, Suspense & Mainstream Fiction',
			[{ genre: 'Literary Fiction', count: 364, fraction: 0.528 }],
			['Fredrik Backman']
		]
	];

	it('decodes the pair identity and genre composition', () => {
		const [first] = decodeSubcommunities(rows, COLUMNS);
		expect(first.communityId).toBe(0);
		expect(first.id).toBe(0);
		expect(first.parentLabel).toBe('Literary Classics & Ideas');
		expect(first.genreComposition[0].genre).toBe('Literary Fiction');
	});

	/*
	 * Subcommunity ids repeat across parents — both fixtures above are id 0. Anything that
	 * keys on the id alone collapses them, which is why the key is the pair.
	 */
	it('keeps same-numbered children of different parents distinct', () => {
		const decoded = decodeSubcommunities(rows, COLUMNS);
		expect(decoded[0].id).toBe(decoded[1].id);
		expect(new Set(decoded.map((s) => subcommunityKey(s.communityId, s.id))).size).toBe(2);
	});

	it('rejects a payload missing the pair columns', () => {
		expect(() => decodeSubcommunities([[1]], ['size', 'label'])).toThrow(/community_id/);
	});
});

describe('subcommunityMembers', () => {
	it('filters on both ids, never the nested one alone', () => {
		const index = build(
			[
				row('A', { coords: [0, 0, 0], mapState: 4, communityId: 0, subcommunityId: 0 }),
				row('B', { coords: [1, 1, 1], mapState: 4, communityId: 1, subcommunityId: 0 }),
				row('C', { coords: [2, 2, 2], mapState: 4, communityId: 0, subcommunityId: 1 })
			],
			{
				subcommunities: decodeSubcommunities(
					[
						[0, 0, 1, 'Zero of zero'],
						[1, 0, 1, 'Zero of one']
					],
					['community_id', 'subcommunity_id', 'size', 'label']
				)
			}
		);

		// Group 0 exists in both communities; asking for one must not return the other's.
		expect(subcommunityMembers(index, 0, 0).map((a) => a.name)).toEqual(['A']);
		expect(subcommunityMembers(index, 1, 0).map((a) => a.name)).toEqual(['B']);
		expect(index.subcommunityByKey.get(subcommunityKey(1, 0))?.label).toBe('Zero of one');
		expect(index.subcommunitiesByCommunity.get(0)).toHaveLength(1);
	});

	it('excludes unmapped authors, which have no position to frame', () => {
		const index = build([
			row('Unmapped', { mapState: 2, communityId: 0, subcommunityId: 0, connection: [0, 0, 108] })
		]);
		expect(subcommunityMembers(index, 0, 0)).toEqual([]);
	});
});
