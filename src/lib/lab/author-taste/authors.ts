import {
	hasConnections,
	isMapped,
	MAP_STATE_MAPPED,
	subcommunityKey,
	type Author,
	type Community,
	type GenreShare,
	type MappedAuthor,
	type Subcommunity
} from './types';

/**
 * Author index: decoding, name search, and community lookup.
 *
 * `authors.json` ships compact row arrays whose order is declared by its own `columns`
 * header, and the artifact guarantees `author_id === row index` — the id is implicit rather
 * than stored, so it is never read from a field.
 *
 * Columns are resolved **by name**, never by fixed position. A rebuild of this release
 * inserted `subcommunity_id` at index 5 and shifted every later column by one; a positional
 * decoder would have kept parsing without error and silently read map states as book counts.
 * Resolving by name turns that class of change into either a clean success or a loud failure.
 *
 * There is deliberately no spatial grid. Only 7,911 of the 34,397 authors carry coordinates,
 * and picking happens in screen space after the perspective projection, where a world-space
 * index cannot help.
 */

/** Combining marks left behind by NFKD decomposition. */
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * Resolve a compact payload's declared column names to positions.
 *
 * `required` columns throw when absent. `optional` ones resolve to -1, which the readers
 * below turn into a documented default — that is how a column the frontend can live without
 * (a nested grouping, say) stays additive rather than breaking older releases.
 */
function columnLookup(
	columns: string[],
	label: string,
	required: string[],
	optional: string[] = []
): Record<string, number> {
	const at: Record<string, number> = {};
	for (const name of required) {
		const index = columns.indexOf(name);
		if (index < 0) {
			throw new Error(`${label} is missing the required column "${name}".`);
		}
		at[name] = index;
	}
	for (const name of optional) at[name] = columns.indexOf(name);
	return at;
}

export interface AuthorIndex {
	authors: Author[];
	byId: Map<number, Author>;
	/**
	 * Keyed by normalised name. Community and subcommunity profiles cite their representative
	 * authors by name rather than id, so this is what turns those citations back into authors.
	 * First occurrence wins on the rare duplicate name.
	 */
	byName: Map<string, Author>;
	/** Authors with coordinates — the population the map draws. */
	mapped: MappedAuthor[];
	/** Authors with a connection block — overlaps `mapped` but is neither a subset nor a superset. */
	connected: Author[];
	genres: string[];
	communities: Community[];
	communityById: Map<number, Community>;
	/** Nested groups, keyed by `subcommunityKey(communityId, subcommunityId)`. */
	subcommunities: Subcommunity[];
	subcommunityByKey: Map<string, Subcommunity>;
	subcommunitiesByCommunity: Map<number, Subcommunity[]>;
	unassignedColor: string;
	bounds: Bounds3D;
}

export interface Bounds3D {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
	minZ: number;
	maxZ: number;
}

/** Strip case, accents and punctuation so "O'Brien" and "obrien" both match. */
export function normaliseName(value: string): string {
	return value
		.normalize('NFKD')
		.replace(DIACRITICS, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function nullableNumber(value: unknown): number | null {
	return typeof value === 'number' ? value : null;
}

export interface AuthorIndexInput {
	rows: unknown[][];
	/** The payload's own declared column order. */
	columns: string[];
	genres: string[];
	communities: Community[];
	subcommunities: Subcommunity[];
	unassignedColor: string;
}

export function buildAuthorIndex({
	rows,
	columns,
	genres,
	communities,
	subcommunities,
	unassignedColor
}: AuthorIndexInput): AuthorIndex {
	const at = columnLookup(
		columns,
		'authors.json',
		[
			'author',
			'x',
			'y',
			'z',
			'community_id',
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
		],
		['subcommunity_id']
	);

	const authors: Author[] = new Array(rows.length);
	const byId = new Map<number, Author>();
	const byName = new Map<string, Author>();
	const mapped: MappedAuthor[] = [];
	const connected: Author[] = [];

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		if (row.length < columns.length) {
			throw new Error(
				`authors.json row ${i} has ${row.length} fields, expected ${columns.length}.`
			);
		}
		const name = row[at.author] as string;
		const genreIndex = row[at.dominant_genre_index] as number;
		const author: Author = {
			id: i,
			name,
			x: nullableNumber(row[at.x]),
			y: nullableNumber(row[at.y]),
			z: nullableNumber(row[at.z]),
			communityId: row[at.community_id] as number,
			// A release without the nested level reads as "every author unassigned", which is what
			// -1 already means everywhere else.
			subcommunityId: at.subcommunity_id < 0 ? -1 : (row[at.subcommunity_id] as number),
			mapState: row[at.map_state] as number,
			bookCount: row[at.book_count] as number,
			genre: genres[genreIndex] ?? genres[genres.length - 1] ?? 'Other',
			connectionPairCount: (row[at.connection_pair_count] as number) ?? 0,
			selectedOutDegree: (row[at.selected_out_degree] as number) ?? 0,
			selectedInDegree: (row[at.selected_in_degree] as number) ?? 0,
			reliableOneSidedOutDegree: (row[at.reliable_one_sided_out_degree] as number) ?? 0,
			reliableOneSidedInDegree: (row[at.reliable_one_sided_in_degree] as number) ?? 0,
			sampleTitles: (row[at.sample_titles] as string[]) ?? [],
			connectionBucket: nullableNumber(row[at.connection_bucket]),
			connectionOffset: nullableNumber(row[at.connection_offset]),
			connectionBytes: nullableNumber(row[at.connection_bytes]),
			searchKey: normaliseName(name)
		};
		authors[i] = author;
		byId.set(i, author);
		if (!byName.has(author.searchKey)) byName.set(author.searchKey, author);
		if (author.mapState === MAP_STATE_MAPPED) {
			// A half-null coordinate triple would silently project to the origin and drop a point
			// in the middle of the cloud, so the invariant is checked rather than trusted. Past
			// this guard the narrowing `isMapped` performs is sound for every mapped author.
			if (author.x === null || author.y === null || author.z === null) {
				throw new Error(`Author ${i} is mapped but has an incomplete coordinate triple.`);
			}
			mapped.push(author as MappedAuthor);
		}
		if (hasConnections(author)) connected.push(author);
	}

	const subcommunitiesByCommunity = new Map<number, Subcommunity[]>();
	for (const subcommunity of subcommunities) {
		const siblings = subcommunitiesByCommunity.get(subcommunity.communityId);
		if (siblings) siblings.push(subcommunity);
		else subcommunitiesByCommunity.set(subcommunity.communityId, [subcommunity]);
	}
	for (const siblings of subcommunitiesByCommunity.values()) {
		siblings.sort((a, b) => b.size - a.size);
	}

	return {
		authors,
		byId,
		byName,
		mapped,
		connected,
		genres,
		communities,
		communityById: new Map(communities.map((community) => [community.id, community])),
		subcommunities,
		subcommunityByKey: new Map(
			subcommunities.map((s) => [subcommunityKey(s.communityId, s.id), s])
		),
		subcommunitiesByCommunity,
		unassignedColor,
		bounds: boundsOf(mapped)
	};
}

export function boundsOf(authors: Author[]): Bounds3D {
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	let minZ = Infinity;
	let maxZ = -Infinity;
	for (const author of authors) {
		if (!isMapped(author)) continue;
		if (author.x < minX) minX = author.x;
		if (author.x > maxX) maxX = author.x;
		if (author.y < minY) minY = author.y;
		if (author.y > maxY) maxY = author.y;
		if (author.z < minZ) minZ = author.z;
		if (author.z > maxZ) maxZ = author.z;
	}
	if (!Number.isFinite(minX)) {
		return { minX: -1, maxX: 1, minY: -1, maxY: 1, minZ: -1, maxZ: 1 };
	}
	return { minX, maxX, minY, maxY, minZ, maxZ };
}

export function decodeCommunities(rows: unknown[][], columns: string[]): Community[] {
	const at = columnLookup(
		columns,
		'communities.json',
		['community_id', 'label', 'color'],
		[
			'size',
			'label_components',
			'dominant_genre',
			'dominant_genre_fraction',
			'representative_authors'
		]
	);
	const read = <T>(row: unknown[], key: string, fallback: T): T =>
		at[key] < 0 ? fallback : ((row[at[key]] as T) ?? fallback);

	return rows.map((row) => ({
		id: row[at.community_id] as number,
		size: read(row, 'size', 0),
		label: row[at.label] as string,
		labelComponents: read<string[]>(row, 'label_components', []),
		dominantGenre: read(row, 'dominant_genre', ''),
		dominantGenreFraction: read(row, 'dominant_genre_fraction', 0),
		representativeAuthors: read<string[]>(row, 'representative_authors', []),
		color: row[at.color] as string
	}));
}

export function decodeSubcommunities(rows: unknown[][], columns: string[]): Subcommunity[] {
	const at = columnLookup(
		columns,
		'subcommunities.json',
		['community_id', 'subcommunity_id', 'label'],
		['size', 'label_components', 'parent_label', 'genre_composition', 'representative_authors']
	);
	const read = <T>(row: unknown[], key: string, fallback: T): T =>
		at[key] < 0 ? fallback : ((row[at[key]] as T) ?? fallback);

	return rows.map((row) => ({
		communityId: row[at.community_id] as number,
		id: row[at.subcommunity_id] as number,
		size: read(row, 'size', 0),
		label: row[at.label] as string,
		labelComponents: read<string[]>(row, 'label_components', []),
		parentLabel: read(row, 'parent_label', ''),
		genreComposition: read<GenreShare[]>(row, 'genre_composition', []),
		representativeAuthors: read<string[]>(row, 'representative_authors', [])
	}));
}

/** The colour an author's point takes: its community's, or grey when unassigned. */
export function authorColor(index: AuthorIndex, author: Author): string {
	return index.communityById.get(author.communityId)?.color ?? index.unassignedColor;
}

/**
 * Author search over 34k names. Prefix matches rank above interior matches, and
 * authors with more retained connection evidence rank above isolated authors within each tier
 * — with this many one-book authors, raw substring order is close to useless.
 */
export function searchAuthors(index: AuthorIndex, query: string, limit = 12): Author[] {
	const needle = normaliseName(query);
	if (!needle) return [];

	const prefix: Author[] = [];
	const interior: Author[] = [];

	for (const author of index.authors) {
		if (author.searchKey.startsWith(needle)) {
			prefix.push(author);
		} else if (author.searchKey.includes(needle)) {
			interior.push(author);
		}
		// Cheap early exit once both tiers are comfortably over the limit.
		if (prefix.length >= limit * 4 && interior.length >= limit * 4) break;
	}

	const byConnectionEvidence = (a: Author, b: Author) =>
		b.connectionPairCount - a.connectionPairCount ||
		b.selectedOutDegree + b.selectedInDegree - (a.selectedOutDegree + a.selectedInDegree) ||
		a.searchKey.localeCompare(b.searchKey) ||
		a.id - b.id;
	prefix.sort(byConnectionEvidence);
	interior.sort(byConnectionEvidence);
	return [...prefix, ...interior].slice(0, limit);
}

/**
 * Well-connected authors that have paired evidence to show — used to seed the page before the
 * reader has picked anyone.
 */
export function landmarkAuthors(index: AuthorIndex, count: number): Author[] {
	return [...index.connected]
		.sort(
			(a, b) =>
				b.connectionPairCount - a.connectionPairCount ||
				b.selectedOutDegree + b.selectedInDegree - (a.selectedOutDegree + a.selectedInDegree) ||
				a.searchKey.localeCompare(b.searchKey) ||
				a.id - b.id
		)
		.slice(0, count);
}

/**
 * Authors carrying at least one reliably one-sided relationship, busiest first. This is
 * the headline population of the release: 1,262 pairs across the catalogue where the
 * evidence supports influence running one way and not back.
 */
export function oneSidedAuthors(index: AuthorIndex, count: number): Author[] {
	return index.connected
		.filter((a) => a.reliableOneSidedOutDegree + a.reliableOneSidedInDegree > 0)
		.sort(
			(a, b) =>
				b.reliableOneSidedOutDegree +
					b.reliableOneSidedInDegree -
					(a.reliableOneSidedOutDegree + a.reliableOneSidedInDegree) ||
				b.connectionPairCount - a.connectionPairCount ||
				a.searchKey.localeCompare(b.searchKey) ||
				a.id - b.id
		)
		.slice(0, count);
}

/** Mapped members of one community, for framing the camera on it. */
export function communityMembers(index: AuthorIndex, communityId: number): Author[] {
	return index.mapped.filter((author) => author.communityId === communityId);
}

/**
 * Mapped members of one nested group. Both ids are required because `subcommunityId` is only
 * unique inside its parent — filtering on it alone would sweep up group 0 of every community.
 */
export function subcommunityMembers(
	index: AuthorIndex,
	communityId: number,
	subcommunityId: number
): Author[] {
	return index.mapped.filter(
		(author) => author.communityId === communityId && author.subcommunityId === subcommunityId
	);
}

/**
 * Which of the three states an author is in. The map population and the connection
 * population overlap without nesting — 1,240 authors have evidence but no coordinates and
 * 258 sit on the map with no retained pairs — so a single "assessable" flag cannot describe
 * an author and search results say which case applies before the reader clicks.
 */
export type AuthorAvailability = 'both' | 'connectionsOnly' | 'mapOnly' | 'neither';

export function availability(author: Author): AuthorAvailability {
	const onMap = author.mapState === MAP_STATE_MAPPED;
	const connected = hasConnections(author);
	if (onMap && connected) return 'both';
	if (connected) return 'connectionsOnly';
	if (onMap) return 'mapOnly';
	return 'neither';
}
