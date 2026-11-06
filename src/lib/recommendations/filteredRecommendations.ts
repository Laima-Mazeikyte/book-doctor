export const FILTER_DIMENSIONS = [
	{ key: 'spice', label: 'Sexual content', low: 'None', high: 'Explicit' },
	{ key: 'vocabulary', label: 'Language complexity', low: 'Accessible', high: 'Demanding' },
	{ key: 'granularity', label: 'Descriptive richness', low: 'Understated', high: 'Elaborate' },
	{ key: 'emotion', label: 'Emotional tone', low: 'Uplifting', high: 'Tragic' },
	{ key: 'violence', label: 'Violence', low: 'Minimal', high: 'Graphic' },
	{ key: 'intended_age', label: 'Target reader age', low: 'Young children', high: 'Adult' },
	{ key: 'period', label: 'Story time period', low: 'Ancient past', high: 'Future' },
	{ key: 'political', label: 'Political leaning', low: 'Left', high: 'Right' },
	{
		key: 'entry_barrier',
		label: 'Required background knowledge',
		low: 'Little',
		high: 'Extensive'
	},
	{ key: 'pace', label: 'Story focus', low: 'Action-driven', high: 'Introspective' },
	{ key: 'narrative', label: 'Narrative structure', low: 'Conventional', high: 'Experimental' },
	{ key: 'atmosphere', label: 'Atmosphere', low: 'Comforting', high: 'Oppressive' },
	{ key: 'originality', label: 'Originality', low: 'Familiar', high: 'Unconventional' },
	{ key: 'depth', label: 'Thematic focus', low: 'Literal', high: 'Philosophical' },
	{
		key: 'discussion_potential',
		label: 'Potential for debate',
		low: 'Clear-cut',
		high: 'Debatable'
	},
	{ key: 'hierarchy_focus', label: 'Social focus', low: 'Society’s margins', high: 'Ruling elite' },
	{
		key: 'factual',
		label: 'Perspective',
		low: 'Subjective',
		high: 'Objective'
	}
] as const;

export type FilterDimension = (typeof FILTER_DIMENSIONS)[number]['key'];
export type Bounds = { min?: number; max?: number };
export const TAG_OPERATORS = ['all_of', 'any_of', 'none_of'] as const;
export type TagOperator = (typeof TAG_OPERATORS)[number];
export type TagSelection = Partial<Record<TagOperator, string[]>>;
export type TagDraft = Record<TagOperator, string[]>;

export function emptyTagDraft(): TagDraft {
	return { all_of: [], any_of: [], none_of: [] };
}
export type RecommendationFilters = {
	seed_book_id?: string;
	relative_dimensions?: Partial<Record<FilterDimension, number>>;
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
export type DimensionDraft = RangeDraft & { enabled: boolean };
export type RangePreset = { label: string; min?: string; max?: string };

export const YEAR_PRESETS: RangePreset[] = [
	{ label: 'Any year' },
	{ label: 'Since 2020', min: '2020' },
	{ label: 'Since 2000', min: '2000' },
	{ label: 'Before 2000', max: '1999' }
];
export const PAGE_PRESETS: RangePreset[] = [
	{ label: 'Any length' },
	{ label: 'Under 300 pages', max: '299' },
	{ label: '300–500 pages', min: '300', max: '500' },
	{ label: 'Over 500 pages', min: '501' }
];
export const POPULARITY_PRESETS: RangePreset[] = [
	{ label: 'Any popularity' },
	{ label: 'Most popular 30%', min: '70' },
	{ label: 'Least popular 30%', max: '30' }
];
export const RATING_PRESETS: RangePreset[] = [
	{ label: 'Any rating' },
	{ label: 'Top 20% by reader rating', min: '80' },
	{ label: 'Top 10% by reader rating', min: '90' }
];
export type FilterDraft = {
	seedBookId: string;
	relativeDimensions: Partial<Record<FilterDimension, number>>;
	genres: TagDraft;
	keywords: TagDraft;
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
		seedBookId: '',
		relativeDimensions: {},
		genres: emptyTagDraft(),
		keywords: emptyTagDraft(),
		types: [],
		authors: [],
		pages: { min: '', max: '' },
		year: { min: '', max: '' },
		popularity: { min: '', max: '' },
		averageRating: { min: '', max: '' },
		dimensions: Object.fromEntries(
			FILTER_DIMENSIONS.map(({ key }) => [key, { enabled: false, min: '0', max: '1' }])
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
	if (draft.seedBookId) {
		if (!isStartingBookId(draft.seedBookId)) throw new Error('Choose a valid starting book.');
		filters.seed_book_id = draft.seedBookId;
	}
	const relative: NonNullable<RecommendationFilters['relative_dimensions']> = {};
	for (const [key, value] of Object.entries(draft.relativeDimensions)) {
		if (
			!FILTER_DIMENSIONS.some((dimension) => dimension.key === key) ||
			typeof value !== 'number' ||
			!Number.isFinite(value) ||
			value === 0 ||
			Math.abs(value) > 1
		)
			throw new Error('Choose a valid change from the starting book.');
		relative[key as FilterDimension] = value;
	}
	if (Object.keys(relative).length) {
		if (!filters.seed_book_id) throw new Error('Choose a starting book before adjusting it.');
		filters.relative_dimensions = relative;
	}
	const genres = buildTagSelection(draft.genres, 'genres');
	const keywords = buildTagSelection(draft.keywords, 'keywords');
	const authors = cleanSelection(draft.authors, 'authors');
	if (genres) filters.genres = genres;
	if (keywords) filters.keywords = keywords;
	if (authors.length) filters.authors = authors;
	if (draft.types.length) filters.type = [...new Set(draft.types)];

	const dimensions: NonNullable<RecommendationFilters['dimensions']> = {};
	for (const { key, label } of FILTER_DIMENSIONS) {
		const range = draft.dimensions[key];
		if (!range.enabled) continue;
		if (!range.min.trim() || !range.max.trim())
			throw new Error(`Enter both bounds for ${label.toLowerCase()}.`);
		dimensions[key] = rangeFromDraft(range, label.toLowerCase(), { min: 0, max: 1 })!;
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

function buildTagSelection(value: TagDraft, name: string): TagSelection | undefined {
	const selection: TagSelection = {};
	for (const operator of TAG_OPERATORS) {
		const labels = cleanSelection(value[operator], name);
		if (labels.length) selection[operator] = labels;
	}
	return Object.keys(selection).length ? selection : undefined;
}

function selector(value: unknown): TagDraft {
	const draft = emptyTagDraft();
	if (!value || typeof value !== 'object' || Array.isArray(value)) return draft;
	const record = value as TagSelection;
	for (const operator of TAG_OPERATORS) {
		const labels = record[operator];
		if (Array.isArray(labels))
			draft[operator] = labels.filter((label): label is string => typeof label === 'string');
	}
	return draft;
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
	draft.seedBookId = typeof filters.seed_book_id === 'string' ? filters.seed_book_id : '';
	if (filters.relative_dimensions && typeof filters.relative_dimensions === 'object') {
		draft.relativeDimensions = { ...filters.relative_dimensions };
	}
	draft.genres = selector(filters.genres);
	draft.keywords = selector(filters.keywords);
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
			min: String(typeof bounds.min === 'number' ? bounds.min : 0),
			max: String(typeof bounds.max === 'number' ? bounds.max : 1)
		};
	}
	return draft;
}

export function describeFilters(value: unknown, seedTitles: Record<string, string> = {}): string {
	if (!isFilteredRequest(value)) return 'Overall recommendations';
	const filters = value as RecommendationFilters;
	const labels: string[] = [];
	if (filters.seed_book_id)
		labels.push(`Starting from ${seedTitles[filters.seed_book_id] ?? 'a book'}`);
	if (filters.relative_dimensions) {
		for (const { key } of FILTER_DIMENSIONS) {
			const delta = filters.relative_dimensions[key];
			if (typeof delta === 'number' && delta !== 0) {
				labels.push(relativeDimensionLabel(key, delta));
			}
		}
	}
	labels.push(...describeTagSelection(filters.genres), ...describeTagSelection(filters.keywords));
	if (filters.type) labels.push(...filters.type);
	if (filters.authors) labels.push(...filters.authors);
	if (filters.year) labels.push(describeRange(filters.year, YEAR_PRESETS, 'Publication year'));
	if (filters.pages) labels.push(describeRange(filters.pages, PAGE_PRESETS, 'Page count'));
	if (filters.popularity_percentile)
		labels.push(
			describeRange(filters.popularity_percentile, POPULARITY_PRESETS, 'Popularity percentile')
		);
	if (filters.average_rating_percentile)
		labels.push(
			describeRange(filters.average_rating_percentile, RATING_PRESETS, 'Reader rating percentile')
		);
	if (filters.dimensions) {
		for (const { key, label, low, high } of FILTER_DIMENSIONS) {
			const bounds = filters.dimensions[key];
			if (!bounds) continue;
			const { min = 0, max = 1 } = bounds;
			const choice =
				min === 0 && max === 0.33
					? low
					: min === 0.33 && max === 0.67
						? 'In between'
						: min === 0.67 && max === 1
							? high
							: `${min}–${max}`;
			labels.push(`${label}: ${choice}`);
		}
	}
	return labels.join(' · ') || 'Filtered recommendations';
}

function describeRange(bounds: Bounds, presets: RangePreset[], label: string): string {
	const preset = presets.find(
		(item) =>
			(item.min ?? '') === (bounds.min === undefined ? '' : String(bounds.min)) &&
			(item.max ?? '') === (bounds.max === undefined ? '' : String(bounds.max))
	);
	if (preset) return preset.label;
	if (bounds.min !== undefined && bounds.max !== undefined)
		return `${label}: ${bounds.min}–${bounds.max}`;
	if (bounds.min !== undefined) return `${label}: at least ${bounds.min}`;
	if (bounds.max !== undefined) return `${label}: at most ${bounds.max}`;
	return `${label}: any recorded value`;
}

export function describeTagSelection(value: TagSelection | undefined): string[] {
	if (!value) return [];
	const groups = selector(value);
	const labels: Record<TagOperator, string> = {
		all_of: 'Require all',
		any_of: 'At least one',
		none_of: 'Exclude'
	};
	return TAG_OPERATORS.flatMap((operator) =>
		groups[operator].length ? [`${labels[operator]}: ${groups[operator].join(', ')}`] : []
	);
}

export function isStartingBookId(value: string): boolean {
	return /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(value);
}

const relativeLabels: Record<FilterDimension, readonly [string, string]> = {
	spice: ['Less explicit', 'More explicit'],
	vocabulary: ['More accessible language', 'More complex language'],
	granularity: ['Sparser description', 'Richer description'],
	emotion: ['More uplifting', 'More tragic'],
	violence: ['Less violence', 'More violence'],
	intended_age: ['Younger audience', 'Older audience'],
	period: ['Earlier setting', 'Later setting'],
	political: ['Further left', 'Further right'],
	entry_barrier: ['Less background knowledge', 'More background knowledge'],
	pace: ['More action-driven', 'More introspective'],
	narrative: ['More conventional narrative', 'More experimental narrative'],
	atmosphere: ['Less oppressive', 'More oppressive'],
	originality: ['More familiar', 'More unconventional'],
	depth: ['More literal', 'More philosophical'],
	discussion_potential: ['Less debatable', 'More debatable'],
	hierarchy_focus: ['Toward outsiders', 'Toward ruling elites'],
	factual: ['More subjective', 'More objective']
};

export function relativeDimensionLabel(key: FilterDimension, delta: number): string {
	return relativeLabels[key][delta < 0 ? 0 : 1];
}

export const STARTING_BOOK_MODIFIERS = {
	'less-violence': { relative_dimensions: { violence: -0.15 } },
	'more-action-driven': { relative_dimensions: { pace: -0.15 } },
	'more-complex-language': { relative_dimensions: { vocabulary: 0.15 } },
	'least-popular-30': { popularity_percentile: { max: 30 } }
} satisfies Record<string, Omit<RecommendationFilters, 'seed_book_id'>>;

export function startingBookPath(
	slug: string | undefined,
	modifier?: keyof typeof STARTING_BOOK_MODIFIERS
): `/discover?${string}` {
	if (!slug) throw new Error('Missing public book slug');
	const params = new URLSearchParams({ from: slug });
	if (modifier) params.set('change', modifier);
	return `/discover?${params}`;
}

export function savedSearchPath(id: string | number): `/discover?${string}` {
	return `/discover?${new URLSearchParams({ search: String(id) })}`;
}

/** Resolve the public slug first; only catalog ULIDs enter recommendation payloads. */
export function draftFromStartingBookUrl(url: URL, bookId = ''): FilterDraft {
	if (!url.searchParams.get('from') || !isStartingBookId(bookId)) return emptyFilterDraft();
	const modifier = url.searchParams.get('change') ?? '';
	const changes = Object.hasOwn(STARTING_BOOK_MODIFIERS, modifier)
		? STARTING_BOOK_MODIFIERS[modifier as keyof typeof STARTING_BOOK_MODIFIERS]
		: {};
	return draftFromFilters({ seed_book_id: bookId, ...changes });
}
