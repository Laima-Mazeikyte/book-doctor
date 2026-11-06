import { describe, expect, it } from 'vitest';
import {
	buildRecommendationFilters,
	draftFromFilters,
	emptyFilterDraft,
	isFilteredRequest,
	describeFilters,
	draftFromStartingBookUrl,
	startingBookPath,
	savedSearchPath,
	relativeDimensionLabel
} from './filteredRecommendations';

describe('filtered recommendation payloads', () => {
	it('uses descriptive discovery URLs and keeps database identity out of starting links', () => {
		expect(startingBookPath('the-hunger-games-suzanne-collins', 'less-violence')).toBe(
			'/discover?from=the-hunger-games-suzanne-collins&change=less-violence'
		);
		expect(savedSearchPath(123)).toBe('/discover?search=123');
		expect(
			draftFromStartingBookUrl(
				new URL('https://unread.world/discover?from=unknown&change=less-violence')
			).seedBookId
		).toBe('');
		expect(() => startingBookPath(undefined)).toThrow('Missing public book slug');
	});
	it('preserves every simultaneous operator in both categories through editing and retries', () => {
		const filters = {
			genres: { all_of: ['Fantasy'], any_of: ['Romance', 'Mystery'], none_of: ['Urban Fantasy'] },
			keywords: { all_of: ['Found Family'], any_of: ['Heist'], none_of: ['War'] }
		};
		expect(buildRecommendationFilters(draftFromFilters(filters))).toEqual(filters);
		expect(describeFilters(filters)).toContain('Require all: Fantasy');
		expect(describeFilters(filters)).toContain('At least one: Romance, Mystery');
		expect(describeFilters(filters)).toContain('Exclude: Urban Fantasy');
		expect(describeFilters(filters)).toContain('Exclude: War');
	});

	it('supports exclusions alone, keeps exact case and does not expand or reject contradictory tags', () => {
		const filters = {
			genres: { all_of: ['Fantasy'], none_of: ['Fantasy', 'fantasy'] },
			keywords: { none_of: ['Found Family'] }
		};
		expect(buildRecommendationFilters(draftFromFilters(filters))).toEqual(filters);
		expect(
			buildRecommendationFilters(
				draftFromFilters({ genres: { none_of: ['Fantasy'], all_of: [], any_of: [] }, keywords: {} })
			)
		).toEqual({ genres: { none_of: ['Fantasy'] } });
	});

	it.each(['all_of', 'any_of', 'none_of'] as const)(
		'enforces the existing 200-label limit on %s',
		(operator) => {
			const draft = emptyFilterDraft();
			draft.genres[operator] = Array.from({ length: 201 }, (_, i) => `Genre ${i}`);
			expect(() => buildRecommendationFilters(draft)).toThrow(/no more than 200/);
		}
	);
	it('omits every inactive selector and bound', () => {
		expect(buildRecommendationFilters(emptyFilterDraft())).toEqual({});
		expect(isFilteredRequest({})).toBe(false);
	});

	it('submits exact tags, matching rules, and only enabled dimensions', () => {
		const draft = emptyFilterDraft();
		draft.genres.all_of = [' Africa ', 'Africa'];
		draft.keywords.any_of = ['Enemies to Lovers'];
		draft.types = ['Fiction'];
		draft.dimensions.violence = { enabled: true, min: '0', max: '0.25' };
		draft.dimensions.depth = { enabled: false, min: '0', max: '1' };
		draft.popularity.min = '80';
		expect(buildRecommendationFilters(draft)).toEqual({
			genres: { all_of: ['Africa'] },
			keywords: { any_of: ['Enemies to Lovers'] },
			type: ['Fiction'],
			dimensions: { violence: { min: 0, max: 0.25 } },
			popularity_percentile: { min: 80 }
		});
	});

	it('treats an enabled full dimension range as active and restores submitted filters', () => {
		const filters = { dimensions: { pace: { min: 0, max: 1 } }, year: { max: 2020 } };
		const draft = draftFromFilters(filters);
		expect(draft.dimensions.pace.enabled).toBe(true);
		expect(buildRecommendationFilters(draft)).toEqual(filters);
	});

	it('rejects reversed ranges and numeric strings that are not finite numbers', () => {
		const draft = emptyFilterDraft();
		draft.pages = { min: '400', max: '200' };
		expect(() => buildRecommendationFilters(draft)).toThrow(/minimum cannot exceed/);
		draft.pages = { min: 'NaN', max: '' };
		expect(() => buildRecommendationFilters(draft)).toThrow(/valid page count/);
	});

	it.each(['min', 'max'] as const)(
		'rejects a blank characteristic %s instead of coercing it to zero',
		(bound) => {
			const draft = draftFromFilters({ dimensions: { violence: { min: 0, max: 1 } } });
			draft.dimensions.violence[bound] = '';
			expect(() => buildRecommendationFilters(draft)).toThrow('Enter both bounds for violence.');
		}
	);

	it('summarizes presets and custom bounds distinctly, preserving matching rules', () => {
		expect(
			describeFilters({
				year: { min: 2020 },
				pages: { max: 299 },
				dimensions: { violence: { min: 0, max: 0.33 } }
			})
		).toBe('Since 2020 · Under 300 pages · Violence: Minimal');
		expect(
			describeFilters({
				year: { max: 1999 },
				pages: { min: 501 },
				dimensions: { violence: { min: 0.67, max: 1 } }
			})
		).toBe('Before 2000 · Over 500 pages · Violence: Graphic');
		expect(
			describeFilters({
				year: { min: 1981, max: 2010 },
				pages: { min: 175 },
				popularity_percentile: { max: 45 },
				average_rating_percentile: { min: 80 },
				dimensions: { pace: { min: 0.12, max: 0.4 } }
			})
		).toBe(
			'Publication year: 1981–2010 · Page count: at least 175 · Popularity percentile: at most 45 · Top 20% by reader rating · Story focus: 0.12–0.4'
		);
	});
});

const seed = '01KR2ADTFG9DJ85AS30MZFHJG6';

describe('starting-book recommendation filters', () => {
	it('accepts a seed alone and preserves signed changes with absolute filters on restore', () => {
		const minimal = { seed_book_id: seed };
		expect(buildRecommendationFilters(draftFromFilters(minimal))).toEqual(minimal);
		const combined = {
			seed_book_id: seed,
			relative_dimensions: { violence: -0.15, vocabulary: 0.1, pace: 0.25 },
			dimensions: { violence: { min: 0, max: 0.3 } },
			type: ['Nonfiction'],
			genres: { all_of: ['History'] }
		};
		expect(buildRecommendationFilters(draftFromFilters(combined))).toEqual(combined);
		expect(describeFilters(combined, { [seed]: 'The Hunger Games' })).toContain(
			'Starting from The Hunger Games'
		);
		expect(describeFilters(combined)).toContain('More introspective');
	});

	it.each([0, null, '0.15', Number.NaN, Infinity, -1.01, 1.01])(
		'rejects invalid relative change %s',
		(value) => {
			const draft = draftFromFilters({
				seed_book_id: seed,
				relative_dimensions: { violence: value }
			});
			expect(() => buildRecommendationFilters(draft)).toThrow(/valid change/);
		}
	);

	it('requires a canonical public ULID and a seed for all relative changes', () => {
		expect(() =>
			buildRecommendationFilters(draftFromFilters({ seed_book_id: 'uuid-not-public-id' }))
		).toThrow(/valid starting book/);
		expect(() =>
			buildRecommendationFilters(draftFromFilters({ relative_dimensions: { pace: -0.15 } }))
		).toThrow(/Choose a starting book/);
		expect(() =>
			buildRecommendationFilters(
				draftFromFilters({ seed_book_id: seed, relative_dimensions: { unknown: 0.2 } })
			)
		).toThrow(/valid change/);
	});

	it('carries quick links to the correct relative direction without copying URL inputs into the request', () => {
		const slug = 'the-hunger-games-suzanne-collins';
		const filters = (modifier?: Parameters<typeof startingBookPath>[1]) =>
			buildRecommendationFilters(
				draftFromStartingBookUrl(
					new URL(startingBookPath(slug, modifier), 'https://unread.world'),
					seed
				)
			);
		expect(filters()).toEqual({ seed_book_id: seed });
		expect(filters('more-action-driven')).toEqual({
			seed_book_id: seed,
			relative_dimensions: { pace: -0.15 }
		});
		expect(filters('less-violence')).toEqual({
			seed_book_id: seed,
			relative_dimensions: { violence: -0.15 }
		});
		expect(filters('more-complex-language')).toEqual({
			seed_book_id: seed,
			relative_dimensions: { vocabulary: 0.15 }
		});
		expect(filters('least-popular-30')).toEqual({
			seed_book_id: seed,
			popularity_percentile: { max: 30 }
		});
		expect(relativeDimensionLabel('pace', 0.15)).toBe('More introspective');
		expect(relativeDimensionLabel('pace', -0.15)).toBe('More action-driven');
		expect(
			buildRecommendationFilters(
				draftFromStartingBookUrl(
					new URL(`https://unread.world/discover?from=${slug}&change=__proto__&user_id=ignored`),
					seed
				)
			)
		).toEqual({ seed_book_id: seed });
	});
});
