import type { Book } from '$lib/types/book';

export const FLAVOR_KEYS = [
	'overall',
	'palate_cleanser',
	'something_different',
	'hidden_gems',
	'shorter_read',
	'authors_you_love',
	'go_deeper',
	'worth_discussing',
	'newer_releases',
	'lighter'
] as const;
export type FlavorKey = (typeof FLAVOR_KEYS)[number];
export type FlavorEvidence = {
	reference_book_id?: string;
	dimension?: string;
	reference_value?: number;
	candidate_value?: number;
	[key: string]: unknown;
};
export type FlavorItem = {
	book_id: string;
	rank: number;
	score?: number;
	liked_book_precedent_ids?: unknown;
	author_relationship_evidence?: unknown;
	dimension_matches?: unknown;
	flavor_evidence?: FlavorEvidence;
};
export type FlavorGroup = { key: FlavorKey; reason: string; items: FlavorItem[] };
export type FlavorGroups = { version: 'flavors_v1'; groups: FlavorGroup[] };
export type HydratedFlavorGroup = FlavorGroup & { books: Book[] };

/** Reject malformed completed payloads instead of showing an empty success. */
export function parseFlavorGroups(value: unknown): FlavorGroups {
	if (!value || typeof value !== 'object') throw new Error('Missing grouped recommendations');
	const payload = value as FlavorGroups;
	if (
		payload.version !== 'flavors_v1' ||
		!Array.isArray(payload.groups) ||
		payload.groups.length !== FLAVOR_KEYS.length
	)
		throw new Error('Invalid grouped recommendations');
	const seen = new Set<string>();
	payload.groups.forEach((group, index) => {
		if (
			!group ||
			group.key !== FLAVOR_KEYS[index] ||
			typeof group.reason !== 'string' ||
			!Array.isArray(group.items) ||
			group.items.length > (index === 0 ? 7 : 2)
		)
			throw new Error('Invalid recommendation group');
		group.items.forEach((item, itemIndex) => {
			if (
				!item ||
				typeof item.book_id !== 'string' ||
				!item.book_id.trim() ||
				item.rank !== itemIndex + 1 ||
				seen.has(item.book_id)
			)
				throw new Error('Invalid recommendation group item');
			seen.add(item.book_id);
		});
	});
	return payload;
}

export function hydrateFlavorGroups(payload: FlavorGroups, books: Book[]): HydratedFlavorGroup[] {
	const byId = new Map(books.map((book) => [book.book_id, book]));
	return payload.groups.map((group) => ({
		...group,
		books: group.items.flatMap((item) => {
			const book = byId.get(item.book_id);
			return book ? [book] : [];
		})
	}));
}
