import { expect, it } from 'vitest';
import { get } from 'svelte/store';
import { createFeedBrowsingSession } from './feedBrowsingSession';
import { createRateFeedController } from './rateFeedController';

const ids = (count: number, start = 0) =>
	Array.from({ length: count }, (_, i) => `book-${start + i}`);

it('counts unique visible books, caps tracking at 100, and ignores revisits', () => {
	const session = createFeedBrowsingSession();
	session.observe(ids(20));
	session.observe(ids(20));
	expect(get(session)).toEqual({ encountered: 20, checkpoint: false });
	session.observe(ids(90, 20));
	expect(get(session)).toEqual({ encountered: 100, checkpoint: true });
	session.observe(ids(50, 110));
	expect(get(session).encountered).toBe(100);
});

it('resumes after feedback without counting the cards already on screen again', () => {
	const session = createFeedBrowsingSession();
	session.observe(ids(100));
	session.observe(ids(5, 100));
	session.interact();
	session.observe(ids(5, 100));
	expect(get(session)).toEqual({ encountered: 0, checkpoint: false });
	session.observe(ids(5, 105));
	expect(get(session).encountered).toBe(5);
});

it('retains the counter across route entries but resets for an account change or reload', () => {
	const controller = createRateFeedController({
		readLatest: async () => {
			throw new Error('Unexpected read');
		}
	});
	controller.setOwner('a');
	const entry = controller.enter();
	controller.browsing.observe(ids(100));
	controller.leave(entry);
	controller.enter();
	expect(get(controller.browsing).checkpoint).toBe(true);
	controller.setOwner('b');
	expect(get(controller.browsing).encountered).toBe(0);
	controller.browsing.observe(ids(100));
	controller.destroy();
	const reloaded = createFeedBrowsingSession();
	expect(get(reloaded).checkpoint).toBe(false);
});
