import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import RecommendationAuthorRelationships from './RecommendationAuthorRelationships.svelte';

it('renders the label and plain author names when candidates are present', async () => {
	const rendered = render(RecommendationAuthorRelationships, {
		authors: ['Brandon Sanderson', 'Robert Jordan', 'Robin Hobb']
	});

	await expect
		.element(rendered.getByText('Because you liked books by:', { exact: false }))
		.toBeVisible();
	await expect
		.element(rendered.getByText('Brandon Sanderson, Robert Jordan, Robin Hobb'))
		.toBeVisible();

	rendered.unmount();
});

it('renders nothing for an empty author list', () => {
	const rendered = render(RecommendationAuthorRelationships, { authors: [] });

	expect(document.querySelector('.recommendation-author-relationships')).toBeNull();
	rendered.unmount();
});
