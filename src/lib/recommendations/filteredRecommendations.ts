export const FILTER_DIMENSIONS = [
	{ key: 'spice', label: 'Romance intimacy', low: 'Sweet', high: 'Explicit' },
	{ key: 'vocabulary', label: 'Vocabulary', low: 'Conversational', high: 'Scholarly' },
	{ key: 'granularity', label: 'Description', low: 'Minimalist', high: 'Transportive' },
	{ key: 'emotion', label: 'Emotional tone', low: 'Uplifting', high: 'Tragic' },
	{ key: 'violence', label: 'Violence', low: 'Peaceful', high: 'Brutal' },
	{ key: 'intended_age', label: 'Intended age', low: 'Toddler', high: 'Mature YA' },
	{ key: 'period', label: 'Setting period', low: 'Antiquity', high: 'Future' },
	{ key: 'political', label: 'Political outlook', low: 'Far left', high: 'Far right' },
	{ key: 'entry_barrier', label: 'Background knowledge', low: 'Universal', high: 'Referential' },
	{ key: 'pace', label: 'Story focus', low: 'Pure action', high: 'Introspective' },
	{ key: 'narrative', label: 'Narrative style', low: 'Classic', high: 'Deconstructed' },
	{ key: 'atmosphere', label: 'Atmosphere', low: 'Cozy', high: 'Oppressive' },
	{ key: 'originality', label: 'Originality', low: 'Conventional', high: 'Unique' },
	{ key: 'depth', label: 'Thematic depth', low: 'Literal', high: 'Philosophical' },
	{
		key: 'discussion_potential',
		label: 'Discussion potential',
		low: 'Unambiguous',
		high: 'Divisive'
	},
	{ key: 'hierarchy_focus', label: 'Social position', low: 'Outcast', high: 'Ruling elite' },
	{
		key: 'factual',
		label: 'Factual approach',
		low: 'Highly subjective',
		high: 'Strictly objective'
	}
] as const;

export type FilterDimension = (typeof FILTER_DIMENSIONS)[number]['key'];
export type Bounds = { min?: number; max?: number };
export type TagSelection = { any_of?: string[]; all_of?: string[] };
export type RecommendationFilters = {
	genres?: TagSelection;
	keywords?: TagSelection;
	type?: ('Fiction' | 'Nonfiction')[];
	authors?: string[];
	dimensions?: Partial<Record<FilterDimension, Bounds>>;
	pages?: Bounds;
	year?: Bounds;
	popularity_percentile?: Bounds;
	average_rating_percentile?: Bounds;
};

export type RangeDraft = { min: string; max: string };
export type DimensionDraft = { enabled: boolean; min: number; max: number };
export type FilterDraft = {
	genres: string[];
	genreMode: 'any_of' | 'all_of';
	keywords: string[];
	keywordMode: 'any_of' | 'all_of';
	types: ('Fiction' | 'Nonfiction')[];
	authors: string[];
	pages: RangeDraft;
	year: RangeDraft;
	popularity: RangeDraft;
	averageRating: RangeDraft;
	dimensions: Record<FilterDimension, DimensionDraft>;
};

export function emptyFilterDraft(): FilterDraft {
	return {
		genres: [],
		genreMode: 'any_of',
		keywords: [],
		keywordMode: 'any_of',
		types: [],
		authors: [],
		pages: { min: '', max: '' },
		year: { min: '', max: '' },
		popularity: { min: '', max: '' },
		averageRating: { min: '', max: '' },
		dimensions: Object.fromEntries(
			FILTER_DIMENSIONS.map(({ key }) => [key, { enabled: false, min: 0, max: 1 }])
		) as Record<FilterDimension, DimensionDraft>
	};
}

function cleanSelection(values: string[], name: string): string[] {
	const cleaned = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
	if (cleaned.length > 200) throw new Error(`Choose no more than 200 ${name}.`);
	return cleaned;
}

function rangeFromDraft(
	value: RangeDraft,
	name: string,
	limits: { min?: number; max?: number; integer?: boolean }
): Bounds | undefined {
	const rawMin = value.min.trim();
	const rawMax = value.max.trim();
	if (!rawMin && !rawMax) return undefined;
	const min = rawMin ? Number(rawMin) : undefined;
	const max = rawMax ? Number(rawMax) : undefined;
	for (const bound of [min, max]) {
		if (bound === undefined) continue;
		if (!Number.isFinite(bound) || (limits.integer && !Number.isInteger(bound))) {
			throw new Error(`Enter a valid ${name}.`);
		}
		if (
			(limits.min !== undefined && bound < limits.min) ||
			(limits.max !== undefined && bound > limits.max)
		) {
			throw new Error(
				`${name} must be between ${limits.min ?? 0} and ${limits.max ?? 'the maximum'}.`
			);
		}
	}
	if (min !== undefined && max !== undefined && min > max) {
		throw new Error(`${name} minimum cannot exceed its maximum.`);
	}
	return { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
}

export function buildRecommendationFilters(draft: FilterDraft): RecommendationFilters {
	const filters: RecommendationFilters = {};
	const genres = cleanSelection(draft.genres, 'genres');
	const keywords = cleanSelection(draft.keywords, 'keywords');
	const authors = cleanSelection(draft.authors, 'authors');
	if (genres.length) filters.genres = { [draft.genreMode]: genres };
	if (keywords.length) filters.keywords = { [draft.keywordMode]: keywords };
	if (authors.length) filters.authors = authors;
	if (draft.types.length) filters.type = [...new Set(draft.types)];

	const dimensions: NonNullable<RecommendationFilters['dimensions']> = {};
	for (const { key } of FILTER_DIMENSIONS) {
		const range = draft.dimensions[key];
		if (!range.enabled) continue;
		if (
			!Number.isFinite(range.min) ||
			!Number.isFinite(range.max) ||
			range.min < 0 ||
			range.max > 1 ||
			range.min > range.max
		) {
			throw new Error(`Enter a valid ${key.replaceAll('_', ' ')} range.`);
		}
		dimensions[key] = { min: range.min, max: range.max };
	}
	if (Object.keys(dimensions).length) filters.dimensions = dimensions;

	filters.pages = rangeFromDraft(draft.pages, 'page count', { min: 1, integer: true });
	filters.year = rangeFromDraft(draft.year, 'publication year', { min: 1, integer: true });
	filters.popularity_percentile = rangeFromDraft(draft.popularity, 'popularity percentile', {
		min: 0,
		max: 100
	});
	filters.average_rating_percentile = rangeFromDraft(draft.averageRating, 'rating percentile', {
		min: 0,
		max: 100
	});
	for (const key of [
		'pages',
		'year',
		'popularity_percentile',
		'average_rating_percentile'
	] as const) {
		if (filters[key] === undefined) delete filters[key];
	}
	return filters;
}

export function isFilteredRequest(value: unknown): value is RecommendationFilters {
	return (
		!!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
	);
}

function selector(value: unknown): { values: string[]; mode: 'any_of' | 'all_of' } {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return { values: [], mode: 'any_of' };
	}
	const record = value as TagSelection;
	if (Array.isArray(record.all_of) && record.all_of.length) {
		return {
			values: record.all_of.filter((entry): entry is string => typeof entry === 'string'),
			mode: 'all_of'
		};
	}
	return {
		values: Array.isArray(record.any_of)
			? record.any_of.filter((entry): entry is string => typeof entry === 'string')
			: [],
		mode: 'any_of'
	};
}

function fromBounds(value: unknown): RangeDraft {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return { min: '', max: '' };
	const bounds = value as Bounds;
	return {
		min: typeof bounds.min === 'number' ? String(bounds.min) : '',
		max: typeof bounds.max === 'number' ? String(bounds.max) : ''
	};
}

export function draftFromFilters(value: unknown): FilterDraft {
	const draft = emptyFilterDraft();
	if (!isFilteredRequest(value)) return draft;
	const filters = value as RecommendationFilters;
	const genres = selector(filters.genres);
	const keywords = selector(filters.keywords);
	draft.genres = genres.values;
	draft.genreMode = genres.mode;
	draft.keywords = keywords.values;
	draft.keywordMode = keywords.mode;
	draft.types = Array.isArray(filters.type)
		? filters.type.filter(
				(item): item is 'Fiction' | 'Nonfiction' => item === 'Fiction' || item === 'Nonfiction'
			)
		: [];
	draft.authors = Array.isArray(filters.authors)
		? filters.authors.filter((item): item is string => typeof item === 'string')
		: [];
	draft.pages = fromBounds(filters.pages);
	draft.year = fromBounds(filters.year);
	draft.popularity = fromBounds(filters.popularity_percentile);
	draft.averageRating = fromBounds(filters.average_rating_percentile);
	for (const { key } of FILTER_DIMENSIONS) {
		const bounds = filters.dimensions?.[key];
		if (!bounds) continue;
		draft.dimensions[key] = {
			enabled: true,
			min: typeof bounds.min === 'number' ? bounds.min : 0,
			max: typeof bounds.max === 'number' ? bounds.max : 1
		};
	}
	return draft;
}

export function describeFilters(value: unknown): string {
	if (!isFilteredRequest(value)) return 'Overall recommendations';
	const filters = value as RecommendationFilters;
	const labels: string[] = [];
	if (filters.genres) labels.push(...(filters.genres.all_of ?? filters.genres.any_of ?? []));
	if (filters.keywords) labels.push(...(filters.keywords.all_of ?? filters.keywords.any_of ?? []));
	if (filters.type) labels.push(...filters.type);
	if (filters.authors) labels.push(...filters.authors);
	if (filters.year) labels.push('Publication year');
	if (filters.pages) labels.push('Length');
	if (filters.popularity_percentile) labels.push('Popularity');
	if (filters.average_rating_percentile) labels.push('Reader rating');
	if (filters.dimensions) {
		for (const { key, label } of FILTER_DIMENSIONS) {
			if (filters.dimensions[key]) labels.push(label);
		}
	}
	return labels.join(' · ') || 'Filtered recommendations';
}
