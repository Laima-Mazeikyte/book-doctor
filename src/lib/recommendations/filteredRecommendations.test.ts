import { describe, expect, it } from 'vitest';
import {
	buildRecommendationFilters,
	draftFromFilters,
	emptyFilterDraft,
	isFilteredRequest
} from './filteredRecommendations';

describe('filtered recommendation payloads', () => {
	it('omits every inactive selector and bound', () => {
		expect(buildRecommendationFilters(emptyFilterDraft())).toEqual({});
		expect(isFilteredRequest({})).toBe(false);
	});

	it('submits exact tags, matching rules, and only enabled dimensions', () => {
		const draft = emptyFilterDraft();
		draft.genres = [' Africa ', 'Africa'];
		draft.genreMode = 'all_of';
		draft.keywords = ['Enemies to Lovers'];
		draft.types = ['Fiction'];
		draft.dimensions.violence = { enabled: true, min: 0, max: 0.25 };
		draft.dimensions.depth = { enabled: false, min: 0, max: 1 };
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
});
