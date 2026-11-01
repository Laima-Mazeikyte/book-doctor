import type { BookDistinctions, RankingDistinction } from './distinctions';
import { bookCharacteristics, characteristicsFromLabels } from './characteristics';
import type { CharacteristicRow } from './characteristics';

export interface BookAward {
	tier: 1 | 2 | 3 | 4 | 5;
	name: string;
	status: 'winner' | 'nominee';
	year: number | null;
}

export const BOOK_RANKING_SELECT = 'book_ranking, author_ranking';
export const BOOK_KEYWORD_SELECT = Array.from({ length: 10 }, (_, i) => `keyword${i + 1}`).join(
	', '
);

export function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function rankingBand(rank: number, population: number): string | null {
	for (const [band, share] of [
		['top_0_1_percent', 0.001],
		['top_1_percent', 0.01],
		['top_5_percent', 0.05],
		['top_10_percent', 0.1]
	] as const) {
		if (rank <= population * share) return band;
	}
	return null;
}

/** Optional evidence is validated independently; it never invents a badge. */
export function storedDistinction(
	value: unknown,
	subject: 'book' | 'author'
): RankingDistinction | null {
	if (!object(value)) return null;
	const { rank, population_count: population, version, band, series_title: series } = value;
	if (
		typeof rank !== 'number' ||
		!Number.isSafeInteger(rank) ||
		rank < 1 ||
		typeof population !== 'number' ||
		!Number.isSafeInteger(population) ||
		population < rank ||
		typeof version !== 'string' ||
		!version.trim() ||
		version.length > 200 ||
		band !== rankingBand(rank, population)
	)
		return null;
	const percent = { top_0_1_percent: 0.1, top_1_percent: 1, top_5_percent: 5, top_10_percent: 10 }[
		band as string
	];
	if (!percent) return null;
	return {
		percent: percent as RankingDistinction['percent'],
		subject,
		rank,
		populationCount: population,
		version,
		...(subject === 'book' && typeof series === 'string' && series.trim()
			? { seriesTitle: series }
			: {})
	};
}

export function storedDistinctions(row: {
	book_ranking?: unknown;
	author_ranking?: unknown;
}): BookDistinctions {
	return {
		book: storedDistinction(row.book_ranking, 'book'),
		author: storedDistinction(row.author_ranking, 'author')
	};
}

export function normalizeKeywords(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [
		...new Set(
			value
				.filter((item): item is string => typeof item === 'string' && item.length <= 2000)
				.map((item) => item.trim())
				.filter(Boolean)
		)
	].slice(0, 10);
}

/** No award matching, inheritance, or deduplication: the backend supplies the final list. */
export function normalizeAwards(value: unknown): BookAward[] {
	if (!Array.isArray(value)) return [];
	return value
		.flatMap((entry): BookAward[] => {
			if (
				!object(entry) ||
				typeof entry.name !== 'string' ||
				!entry.name.trim() ||
				typeof entry.tier !== 'number' ||
				![1, 2, 3, 4, 5].includes(entry.tier) ||
				!['winner', 'nominee'].includes(entry.status as string)
			)
				return [];
			if (
				entry.year !== null &&
				(typeof entry.year !== 'number' ||
					!Number.isInteger(entry.year) ||
					entry.year < -2147483648 ||
					entry.year > 2147483647)
			)
				return [];
			const year = entry.year as number | null;
			return [
				{
					tier: entry.tier as BookAward['tier'],
					name: entry.name.trim(),
					status: entry.status as BookAward['status'],
					year
				}
			];
		})
		.sort(
			(a, b) =>
				a.tier - b.tier ||
				Number(a.status === 'nominee') - Number(b.status === 'nominee') ||
				(b.year ?? -Infinity) - (a.year ?? -Infinity) ||
				a.name.localeCompare(b.name, 'en')
		);
}

/** Persist canonical metadata without trusting arbitrary cache labels/descriptions. */
export function cachedBookAnnotations(value: Record<string, unknown>) {
	const distinctions = object(value.distinctions) ? value.distinctions : {};
	const restore = (entry: unknown, subject: 'book' | 'author') => {
		if (!object(entry)) return null;
		const result = storedDistinction(
			{
				rank: entry.rank,
				population_count: entry.populationCount,
				version: entry.version,
				band:
					typeof entry.rank === 'number' && typeof entry.populationCount === 'number'
						? rankingBand(entry.rank, entry.populationCount)
						: null,
				series_title: entry.seriesTitle
			},
			subject
		);
		return result?.percent === entry.percent && entry.subject === subject ? result : null;
	};
	return {
		...(value.characteristics !== undefined
			? { characteristics: characteristicsFromLabels(value.characteristics) }
			: {}),
		...(value.keywords !== undefined ? { keywords: normalizeKeywords(value.keywords) } : {}),
		...(value.distinctions !== undefined
			? {
					distinctions: {
						book: restore(distinctions.book, 'book'),
						author: restore(distinctions.author, 'author')
					}
				}
			: {})
	};
}

export function catalogAnnotations(
	row: CharacteristicRow & { book_ranking?: unknown; author_ranking?: unknown; awards?: unknown }
) {
	const fields = row as Record<string, unknown>;
	return {
		...('pace_value' in row ||
		'vocabulary_value' in row ||
		'depth_value' in row ||
		'originality_value' in row ||
		'discussion_potential_value' in row ||
		'violence_value' in row ||
		'spice_value' in row ||
		'atmosphere_value' in row ||
		'entry_barrier_value' in row
			? { characteristics: bookCharacteristics(row).labels }
			: {}),
		...('keyword1' in row
			? {
					keywords: normalizeKeywords(
						Array.from({ length: 10 }, (_, i) => fields[`keyword${i + 1}`])
					)
				}
			: {}),
		...('book_ranking' in row || 'author_ranking' in row
			? { distinctions: storedDistinctions(row) }
			: {}),
		...('awards' in row ? { awards: row.awards === null ? null : normalizeAwards(row.awards) } : {})
	};
}
