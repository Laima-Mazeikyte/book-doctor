import type { Book, RatingValue } from '$lib/types/book';
import type { Point3D } from '$lib/lab/orbit';
import type { AuthorIndex } from './authors';
import { isMapped, type MappedAuthor } from './types';

export type PersonalRatingCategory = 'loved' | 'hated' | 'neutral';

export interface RatedBook {
	book: Book;
	rating: RatingValue;
}

export interface PersonalAuthorRating {
	average: number;
	count: number;
	category: PersonalRatingCategory;
}

/** The browser-facing subset of one `private.author_map_nodes` row. */
export interface PersonalMapNode {
	authorId: number;
	localRadius: number;
}

/** The browser-facing subset of one `private.author_map_neighbors` row. */
export interface PersonalMapNeighbor {
	authorId: number;
	neighborAuthorId: number;
	neighborRank: number;
	neighborDistance: number;
}

/**
 * Release-scoped fixed-map inputs for out-of-sample placement.
 *
 * Supabase can eventually return this shape for just the user's rated authors. Until that
 * endpoint exists, `buildPersonalMapNeighborhood` derives the identical rank-20 geometry from
 * the already-loaded, published coordinates.
 */
export interface PersonalMapNeighborhood {
	nodes: ReadonlyMap<number, PersonalMapNode>;
	neighbors: ReadonlyMap<number, readonly PersonalMapNeighbor[]>;
}

const DEFAULT_NEIGHBOR_COUNT = 20;
const PRIOR_BOOK_COUNT = 2;
const MAX_NORMALIZED_DISTANCE = 3;
const HATE_REPULSION_STRENGTH = 2.5;
const MIN_LOCAL_RADIUS = 1e-9;

function categoryForAverage(average: number): PersonalRatingCategory {
	if (average >= 4) return 'loved';
	if (average <= 2) return 'hated';
	return 'neutral';
}

/**
 * Aggregate the current user's ratings by the exact full author field used by the map release.
 *
 * The catalog and release currently carry the same author string, so deliberately do not use
 * normalised-name matching or split multi-author fields here. That keeps a personal overlay from
 * silently merging authors that the map treats as distinct.
 */
export function aggregatePersonalAuthorRatings(
	index: AuthorIndex,
	ratedBooks: RatedBook[]
): Map<number, PersonalAuthorRating> {
	const authorByExactName = new Map<string, (typeof index.authors)[number]>();
	for (const author of index.authors) {
		if (!authorByExactName.has(author.name)) authorByExactName.set(author.name, author);
	}

	const totals = new Map<number, { sum: number; count: number }>();
	for (const { book, rating } of ratedBooks) {
		const author = authorByExactName.get(book.author);
		if (!author || !isMapped(author)) continue;
		const current = totals.get(author.id) ?? { sum: 0, count: 0 };
		current.sum += rating;
		current.count += 1;
		totals.set(author.id, current);
	}

	return new Map(
		[...totals.entries()].map(([authorId, { sum, count }]) => {
			const average = sum / count;
			return [authorId, { average, count, category: categoryForAverage(average) }];
		})
	);
}

function distance(a: Point3D, b: Point3D): number {
	return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Build the same directed Euclidean k-neighborhood exported for Supabase.
 *
 * Only requested source authors are evaluated, so this is O(rated authors x map authors) rather
 * than rebuilding the full 7,911-author graph in the browser. Ties follow author id, matching the
 * deterministic ordering in `exportAuthorMapNeighborhood.py`.
 */
export function buildPersonalMapNeighborhood(
	index: AuthorIndex,
	authorIds: Iterable<number>,
	k = DEFAULT_NEIGHBOR_COUNT
): PersonalMapNeighborhood {
	const nodes = new Map<number, PersonalMapNode>();
	const neighbors = new Map<number, PersonalMapNeighbor[]>();
	const neighborCount = Math.min(Math.max(0, Math.trunc(k)), Math.max(0, index.mapped.length - 1));

	for (const authorId of new Set(authorIds)) {
		const source = index.byId.get(authorId);
		if (!source || !isMapped(source)) continue;

		const nearest = index.mapped
			.filter((candidate) => candidate.id !== source.id)
			.map((candidate) => ({
				authorId: candidate.id,
				distance: distance(source, candidate)
			}))
			.sort((a, b) => a.distance - b.distance || a.authorId - b.authorId)
			.slice(0, neighborCount);

		const localRadius = Math.max(nearest.at(-1)?.distance ?? MIN_LOCAL_RADIUS, MIN_LOCAL_RADIUS);
		nodes.set(authorId, { authorId, localRadius });
		neighbors.set(
			authorId,
			nearest.map((neighbor, offset) => ({
				authorId,
				neighborAuthorId: neighbor.authorId,
				neighborRank: offset + 1,
				neighborDistance: neighbor.distance
			}))
		);
	}

	return { nodes, neighbors };
}

interface PreferenceAnchor {
	author: MappedAuthor;
	weight: number;
	localRadius: number;
}

/**
 * Empirical-Bayes-style shrinkage toward the neutral score of 3.
 *
 * A single book remains useful but cannot carry the same confidence as several books. The bounded
 * reliability term prevents prolific authors from overwhelming the user's other preferences.
 */
function preferenceWeight(rating: PersonalAuthorRating): number {
	const reliability = rating.count / (rating.count + PRIOR_BOOK_COUNT);
	return Math.abs(rating.average - 3) * reliability;
}

function robustAttraction(candidate: MappedAuthor, anchor: PreferenceAnchor): number {
	const normalized = Math.min(
		distance(candidate, anchor.author) / anchor.localRadius,
		MAX_NORMALIZED_DISTANCE
	);
	return normalized * normalized;
}

function localRepulsion(candidate: MappedAuthor, anchor: PreferenceAnchor): number {
	const normalized = distance(candidate, anchor.author) / anchor.localRadius;
	return Math.exp(-0.5 * normalized * normalized);
}

/**
 * Place the user against the fixed published map without interpreting its global axes.
 *
 * Loved authors define the eligible region: candidates are the loved landmarks themselves and
 * their local rank-k neighbors. The winner minimizes a confidence-weighted, capped local-distance
 * loss. Hated authors add a bounded Gaussian penalty only near their own neighborhoods, so they
 * can push the marker locally but can never project it to an invented "opposite" side of PaCMAP.
 * Neutral or mixed authors are display-only. With no loved anchor there is not enough positive
 * information to identify a taste location, so no center is returned.
 */
export function personalTasteCenter(
	index: AuthorIndex,
	personalRatings: ReadonlyMap<number, PersonalAuthorRating>,
	providedNeighborhood?: PersonalMapNeighborhood
): Point3D | null {
	if (personalRatings.size === 0) return null;

	const neighborhood =
		providedNeighborhood ?? buildPersonalMapNeighborhood(index, personalRatings.keys());
	const loved: PreferenceAnchor[] = [];
	const hated: PreferenceAnchor[] = [];

	for (const [authorId, rating] of personalRatings) {
		if (rating.category === 'neutral') continue;
		const author = index.byId.get(authorId);
		const node = neighborhood.nodes.get(authorId);
		if (!author || !isMapped(author) || !node) continue;
		const anchor = {
			author,
			weight: preferenceWeight(rating),
			localRadius: Math.max(node.localRadius, MIN_LOCAL_RADIUS)
		};
		if (anchor.weight <= 0) continue;
		if (rating.category === 'loved') loved.push(anchor);
		else hated.push(anchor);
	}

	if (loved.length === 0) return null;

	const candidateIds = new Set<number>();
	for (const anchor of loved) {
		candidateIds.add(anchor.author.id);
		for (const neighbor of neighborhood.neighbors.get(anchor.author.id) ?? []) {
			candidateIds.add(neighbor.neighborAuthorId);
		}
	}

	const totalLovedWeight = loved.reduce((sum, anchor) => sum + anchor.weight, 0);
	const totalHatedWeight = hated.reduce((sum, anchor) => sum + anchor.weight, 0);
	const repulsionScale =
		totalHatedWeight > 0
			? HATE_REPULSION_STRENGTH * Math.min(1, totalHatedWeight / totalLovedWeight)
			: 0;

	let best: MappedAuthor | null = null;
	let bestScore = Number.POSITIVE_INFINITY;
	let bestRawLovedDistance = Number.POSITIVE_INFINITY;

	for (const candidateId of candidateIds) {
		const candidate = index.byId.get(candidateId);
		if (!candidate || !isMapped(candidate)) continue;

		const attraction =
			loved.reduce((sum, anchor) => sum + anchor.weight * robustAttraction(candidate, anchor), 0) /
			totalLovedWeight;
		const repulsion =
			totalHatedWeight > 0
				? hated.reduce(
						(sum, anchor) => sum + anchor.weight * localRepulsion(candidate, anchor),
						0
					) / totalHatedWeight
				: 0;
		const score = attraction + repulsionScale * repulsion;
		const rawLovedDistance = loved.reduce(
			(sum, anchor) => sum + anchor.weight * distance(candidate, anchor.author),
			0
		);

		if (
			score < bestScore - Number.EPSILON ||
			(Math.abs(score - bestScore) <= Number.EPSILON &&
				(rawLovedDistance < bestRawLovedDistance - Number.EPSILON ||
					(Math.abs(rawLovedDistance - bestRawLovedDistance) <= Number.EPSILON &&
						candidate.id < (best?.id ?? Number.POSITIVE_INFINITY))))
		) {
			best = candidate;
			bestScore = score;
			bestRawLovedDistance = rawLovedDistance;
		}
	}

	return best ? { x: best.x, y: best.y, z: best.z } : null;
}
