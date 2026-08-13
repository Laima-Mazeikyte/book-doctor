import { decodeConnectionBlock, reorientRecord } from './decode';
import { bucketUrl, type Release } from './release';
import type { AuthorIndex } from './authors';
import {
	hasConnections,
	isMapped,
	STATUS_ONE_SIDED_OTHER_TO_SELF,
	STATUS_ONE_SIDED_SELF_TO_OTHER,
	STATUS_OPPOSING,
	type Author,
	type Connection,
	type ConnectionRecord
} from './types';

/**
 * Connection access with in-memory caching.
 *
 * The cache is keyed by **bucket**, not by author: one bucket file holds the blocks of
 * roughly 35 authors, so a reader exploring a neighbourhood usually gets later authors for
 * free. Buckets run to 705 KB at the largest, and a single author's block can itself be
 * 300 KB, so fetching the whole bucket to read one slice costs little over fetching that
 * slice alone — which is why the format needs no HTTP Range support.
 *
 * Nothing is fetched until an author is selected.
 */
export class ConnectionStore {
	private readonly buckets = new Map<number, ArrayBuffer>();
	private readonly inFlight = new Map<number, Promise<ArrayBuffer>>();

	constructor(private readonly release: Release) {}

	/** True when the author's bucket is already resident, so callers can skip loading states. */
	has(author: Author): boolean {
		return author.connectionBucket !== null && this.buckets.has(author.connectionBucket);
	}

	/**
	 * Every retained pair incident to this author.
	 *
	 * An author with no connection block resolves to empty without a request — that is the
	 * artifact's own representation of "no retained pairs", so unlike the retired per-author
	 * shard format there is no 404 to interpret. A 404 here means a broken release.
	 */
	async records(author: Author): Promise<ConnectionRecord[]> {
		if (!hasConnections(author)) return [];
		const bucket = await this.bucket(author.connectionBucket as number);
		return decodeConnectionBlock(
			bucket,
			author.connectionOffset as number,
			author.connectionBytes as number
		);
	}

	private async bucket(id: number): Promise<ArrayBuffer> {
		const cached = this.buckets.get(id);
		if (cached) return cached;

		const pending = this.inFlight.get(id);
		if (pending) return pending;

		const request = fetch(bucketUrl(this.release, id))
			.then(async (response) => {
				if (!response.ok) {
					throw new Error(`Connection bucket ${id} request failed with ${response.status}.`);
				}
				const buffer = await response.arrayBuffer();
				this.buckets.set(id, buffer);
				this.inFlight.delete(id);
				return buffer;
			})
			.catch((error) => {
				this.inFlight.delete(id);
				throw error;
			});

		this.inFlight.set(id, request);
		return request;
	}
}

function mapDistance(a: Author, b: Author): number | null {
	if (!isMapped(a) || !isMapped(b)) return null;
	return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * The pair record for two authors, oriented `a → b` as `self`.
 *
 * Both directions and the asymmetry test live in one record, so this needs a single
 * bucket. When `a` has no block of its own we read `b`'s and flip the record, which covers
 * the 1,240 authors that carry evidence without being indexed themselves.
 *
 * `null` means the pair was never retained — distinct from a retained pair whose
 * directionality is `unresolved`, and it must never be presented as "no relationship".
 */
export async function comparePair(
	store: ConnectionStore,
	a: Author,
	b: Author
): Promise<ConnectionRecord | null> {
	if (hasConnections(a)) {
		const found = (await store.records(a)).find((record) => record.otherId === b.id);
		if (found) return withPartnerFacts(store, found, a, b);
	}
	if (hasConnections(b)) {
		const found = (await store.records(b)).find((record) => record.otherId === a.id);
		if (found) return withPartnerFacts(store, reorientRecord(found, a.id), a, b);
	}
	return null;
}

/**
 * Complete a record from the partner's copy of the same pair.
 *
 * The discovery fold count is stored per *oriented* claim, and each copy holds only its own
 * `self → other` version — measured on this release the two copies disagree for roughly two
 * thirds of pairs. Without this the reverse direction reads as "not recorded" beside a
 * verdict that plainly depended on it.
 *
 * The asymmetry gap no longer needs recovering: the artifact now negates the opposite
 * orientation's estimate into each copy itself, and documents `NaN` as meaning neither
 * orientation has one — in which case the partner has nothing to offer either.
 *
 * Costs at most one extra bucket, only when the fold count is missing and the partner is
 * indexed.
 */
async function withPartnerFacts(
	store: ConnectionStore,
	record: ConnectionRecord,
	a: Author,
	b: Author
): Promise<ConnectionRecord> {
	if (record.reverse.selectionFoldCount !== null || !hasConnections(b)) return record;

	const found = (await store.records(b)).find((other) => other.otherId === a.id);
	if (!found) return record;
	const partner = reorientRecord(found, a.id);

	return {
		...record,
		reverse: {
			...record.reverse,
			selectionFoldCount: partner.reverse.selectionFoldCount
		}
	};
}

/**
 * Rank a connection for display.
 *
 * The stronger of the two directions' evidence scores, which is already the
 * empirical-Bayes shrunken effect floored at zero — thinly-evidenced pairs are shrunk
 * toward zero upstream, so this ordering prefers relationships that are both large and
 * well-measured without the frontend reconstructing an interval to do it.
 */
export function connectionStrength(record: ConnectionRecord): number {
	return Math.max(record.self.evidenceScore, record.reverse.evidenceScore);
}

export function isOneSided(record: ConnectionRecord): boolean {
	return (
		record.status === STATUS_ONE_SIDED_SELF_TO_OTHER ||
		record.status === STATUS_ONE_SIDED_OTHER_TO_SELF
	);
}

export interface Neighbourhood {
	/** Every retained pair incident to the focus author, strongest first. Not truncated — the
	 * table sorts, filters and slices, and it cannot do that over a pre-cut list. */
	connections: Connection[];
}

/**
 * The retained relationships around one author, strongest first.
 *
 * No threshold argument: selection happened upstream under the manifest's fixed rule, and
 * every record present here passed it. The limit is a legibility choice about how many
 * rows to draw, not a claim about which relationships count.
 */
export async function loadNeighbourhood(
	store: ConnectionStore,
	index: AuthorIndex,
	focus: Author
): Promise<Neighbourhood> {
	const records = await store.records(focus);

	const connections: Connection[] = [];

	for (const record of records) {
		const other = index.byId.get(record.otherId);
		// A record naming an author outside the index would be a broken release, but dropping
		// it costs one row rather than the whole panel.
		if (!other) continue;
		connections.push({ record, other, mapDistance: mapDistance(focus, other) });
	}

	connections.sort((a, b) => connectionStrength(b.record) - connectionStrength(a.record));

	return {
		connections
	};
}

/** Rarest first: a one-way verdict, then opposing, then reciprocal, then unsettled. */
export function statusRank(connection: Connection): number {
	if (isOneSided(connection.record)) return 0;
	if (connection.record.status === STATUS_OPPOSING) return 1;
	if (connection.record.status === 1) return 2;
	return 3;
}

/** At most this many notable rows are held back for the tail of the default view. */
const NOTABLE_TAIL = 4;

/**
 * The opening view: the strongest relationships, with a few notable ones added at the end.
 *
 * Leading with one-way and opposing verdicts sounds right — they are the rarest thing in the
 * release — but it fills the whole first screen with results that are rare rather than strong,
 * and buries the associations that actually characterise the author. Ranking purely by
 * strength has the opposite failure: with thousands of reciprocal pairs, a handful of one-way
 * verdicts never surface at all. So most rows come from the top of the strength ranking, and
 * up to `NOTABLE_TAIL` notable results that missed that cut are appended below it.
 */
export function composeDefaultOrder(connections: Connection[], limit: number): Connection[] {
	const notable = connections.filter((connection) => statusRank(connection) <= 1);
	if (notable.length === 0) return connections.slice(0, limit);

	// Never give away more than a third of the view, and never crowd out a short list.
	const reserve = Math.min(NOTABLE_TAIL, notable.length, Math.floor(limit / 3));
	const head = connections.slice(0, Math.max(0, limit - reserve));
	const shown = new Set(head.map((connection) => connection.other.id));
	const tail = notable.filter((connection) => !shown.has(connection.other.id)).slice(0, reserve);

	return [...head, ...tail];
}

/**
 * Surprise heuristic: a strong affinity between authors who sit far apart on the map.
 * Proximity means shared readers, so a long affinity edge is a genuine crossover rather
 * than a restatement of where the two already sit.
 *
 * The threshold is a fraction of the layout's own diagonal rather than an absolute
 * distance, because these coordinates are PaCMAP output and carry no fixed scale.
 */
export const SURPRISING_DISTANCE_FRACTION = 0.28;

export function isSurprising(connection: Connection, diagonal: number): boolean {
	if (connection.mapDistance === null) return false;
	if (connection.record.self.rateDifference <= 0) return false;
	return connection.mapDistance >= diagonal * SURPRISING_DISTANCE_FRACTION;
}
