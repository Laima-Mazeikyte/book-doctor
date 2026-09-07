import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import RecommendationDimensionMatches from './RecommendationDimensionMatches.svelte';
import { DIMENSION_KEYS, type DimensionMatch } from '$lib/recommendations/dimensionMatches';
import { t } from '$lib/copy';

const copyValues = {
	spice: [
		'gentle relationships',
		'reserved romance',
		'light spice',
		'on-page intimacy',
		'explicit intimacy'
	],
	vocabulary: [
		'conversational prose',
		'accessible prose',
		'expressive prose',
		'layered prose',
		'scholarly prose'
	],
	pace: [
		'action-driven stories',
		'plot-driven stories',
		'balanced storytelling',
		'character-driven stories',
		'introspective storytelling'
	],
	originality: [
		'traditional storytelling',
		'recognizable patterns',
		'fresh storytelling',
		'distinctive storytelling',
		'original storytelling'
	],
	violence: [
		'idea-driven storytelling',
		'event-driven storytelling',
		'intense action',
		'graphic scenes',
		'brutal scenes'
	],
	depth: [
		'straightforward storytelling',
		'layered themes',
		'abstract ideas',
		'philosophical ideas'
	],
	discussion_potential: ['moral clarity', 'moral complexity', 'debatable themes']
} as const;

it('renders approved sentences using the book score', async () => {
	const rendered = render(RecommendationDimensionMatches, {
		matches: [
			{ dimension_key: 'spice', candidate_raw_score: 0 },
			{ dimension_key: 'originality', candidate_raw_score: 0.7 },
			{ dimension_key: 'violence', candidate_raw_score: 0.3 }
		]
	});
	for (const phrase of [
		'gentle relationships',
		'distinctive storytelling',
		'event-driven storytelling'
	]) {
		await expect
			.element(rendered.getByText(`Matches your interest in ${phrase}`, { exact: true }))
			.toBeVisible();
	}
	expect(document.querySelectorAll('.recommendation-dimension-matches li')).toHaveLength(3);
	rendered.unmount();
});

it('resolves every mapped copy key to approved text', () => {
	for (const dimension_key of DIMENSION_KEYS) {
		for (const [index, phrase] of copyValues[dimension_key].entries()) {
			const path = `recommendations.dimensionMatches.values.${dimension_key}.${index}`;
			expect(t(path)).toBe(phrase);
		}
	}
});

it('normalizes before limiting and preserves the supplied order', async () => {
	const rendered = render(RecommendationDimensionMatches, {
		matches: [
			{ dimension_key: 'emotion', candidate_raw_score: 0.5 },
			{ dimension_key: 'spice', candidate_raw_score: 0 },
			{ dimension_key: 'spice', candidate_raw_score: 0.8 },
			{ dimension_key: 'pace', candidate_raw_score: 0.2 },
			{ dimension_key: 'depth', candidate_raw_score: 0.9 },
			{ dimension_key: 'violence', candidate_raw_score: 0.3 }
		] as unknown as DimensionMatch[]
	});

	expect(
		[...document.querySelectorAll('.recommendation-dimension-matches li')].map((item) =>
			item.textContent?.trim()
		)
	).toEqual([
		'Matches your interest in gentle relationships',
		'Matches your interest in plot-driven stories',
		'Matches your interest in philosophical ideas'
	]);
	expect(document.querySelectorAll('.recommendation-dimension-matches li')).toHaveLength(3);
	rendered.unmount();
});

it.each([undefined, []])('renders nothing for missing or empty matches (%s)', (matches) => {
	const rendered = render(RecommendationDimensionMatches, { matches });
	expect(document.querySelector('.recommendation-dimension-matches')).toBeNull();
	rendered.unmount();
});
