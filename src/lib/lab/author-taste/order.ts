import {
	STATUS_ONE_SIDED_OTHER_TO_SELF,
	STATUS_ONE_SIDED_SELF_TO_OTHER,
	STATUS_OPPOSING,
	type Connection
} from './types';

export function isOneSided(record: Connection['record']): boolean {
	return (
		record.status === STATUS_ONE_SIDED_SELF_TO_OTHER ||
		record.status === STATUS_ONE_SIDED_OTHER_TO_SELF
	);
}

/** Rarest first: a one-way verdict, then opposing, then reciprocal, then unsettled. */
export function statusRank(connection: Connection): number {
	if (isOneSided(connection.record)) return 0;
	if (connection.record.status === STATUS_OPPOSING) return 1;
	if (connection.record.status === 1) return 2;
	return 3;
}

/** The opening aperture is fixed so every larger aperture is a prefix extension. */
export const DEFAULT_CONNECTION_LIMIT = 10;

/** At most this many notable rows are held back for the opening view. */
const NOTABLE_TAIL = 4;

/**
 * The opening view: the strongest relationships, with a few notable ones added at the end.
 *
 * Leading with one-way and opposing verdicts sounds right — they are the rarest thing in the
 * release — but it fills the whole first screen with results that are rare rather than strong,
 * and buries the associations that actually characterise the author. Ranking purely by
 * strength has the opposite failure: with thousands of reciprocal pairs, a handful of one-way
 * verdicts never surface at all. So most rows come from the top of the strength ranking, and
 * up to `NOTABLE_TAIL` notable results that missed that cut are appended below it. The opening
 * view is deliberately fixed at ten rows: the table can reveal more of this same order without
 * replacing a row that was already visible.
 */
export function composeDefaultOrder(connections: Connection[]): Connection[] {
	const strengthOrder = [...connections];
	const notable = strengthOrder.filter((connection) => statusRank(connection) <= 1);
	const ordered: Connection[] = [];
	const seen = new Set<number>();
	let strengthIndex = 0;
	let notableIndex = 0;

	const appendStrength = (): boolean => {
		while (strengthIndex < strengthOrder.length) {
			const connection = strengthOrder[strengthIndex++];
			if (seen.has(connection.other.id)) continue;
			seen.add(connection.other.id);
			ordered.push(connection);
			return true;
		}
		return false;
	};

	const appendNotable = (): boolean => {
		while (notableIndex < notable.length) {
			const connection = notable[notableIndex++];
			if (seen.has(connection.other.id)) continue;
			seen.add(connection.other.id);
			ordered.push(connection);
			return true;
		}
		return false;
	};

	// Match the former ten-row opening view, but make its composition independent of the
	// requested aperture. If the notable tail is exhausted early, fill the remainder from the
	// strength order.
	const reserve = Math.min(NOTABLE_TAIL, notable.length, Math.floor(DEFAULT_CONNECTION_LIMIT / 3));
	const strengthHead = DEFAULT_CONNECTION_LIMIT - reserve;
	while (ordered.length < strengthHead && appendStrength()) {
		// Keep the strongest relationships in their existing order.
	}
	while (ordered.length < DEFAULT_CONNECTION_LIMIT && appendNotable()) {
		// Add rare one-way and opposing relationships without duplicating the strength head.
	}
	while (ordered.length < DEFAULT_CONNECTION_LIMIT && appendStrength()) {
		// A short notable list should not make a populated table look artificially short.
	}

	// Continue the same order for larger apertures. Two strength rows followed by one unseen
	// notable row keeps the notable relationships visible without allowing them to dominate; once
	// that pool is empty, the remaining strength order is appended naturally.
	while (ordered.length < strengthOrder.length) {
		let added = false;
		if (appendStrength()) added = true;
		if (appendStrength()) added = true;
		if (appendNotable()) added = true;
		if (!added) break;
	}

	return ordered;
}
