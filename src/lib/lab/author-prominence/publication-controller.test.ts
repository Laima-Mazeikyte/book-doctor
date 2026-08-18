import { describe, expect, it } from 'vitest';
import { PublicationController, type PublicationScheduler } from './publication-controller';
import type { RankingResult } from './ranking-engine';

function result(revision: number): RankingResult {
	return { revision } as RankingResult;
}

function fakeScheduler(): PublicationScheduler & { advance(ms: number): void } {
	let now = 0;
	let nextId = 0;
	const timers = new Map<number, { at: number; callback: () => void }>();
	return {
		now: () => now,
		setTimeout: (callback, delay) => {
			const id = ++nextId;
			timers.set(id, { at: now + delay, callback });
			return id as unknown as ReturnType<typeof setTimeout>;
		},
		// Deliberately leave callbacks queued: browser cancellation can race with delivery,
		// so the controller's epoch and watermark checks must be authoritative.
		clearTimeout: () => undefined,
		advance: (ms) => {
			now += ms;
			for (const [id, timer] of [...timers]) {
				if (timer.at <= now) {
					timers.delete(id);
					timer.callback();
				}
			}
		}
	};
}

describe('transactional ranking publication', () => {
	it('registers the request watermark before synchronous fallback can return a result', () => {
		const published: Array<[number, string]> = [];
		const controller = new PublicationController({
			onPublish: (item, intent) => published.push([item.revision, intent])
		});

		controller.registerRequest(1, 'none');
		controller.receive(result(1), false);

		expect(controller.getLatestRequestedRevision()).toBe(1);
		expect(published).toEqual([[1, 'none']]);
	});

	it('never publishes revision one after revision two has been allocated', () => {
		const scheduler = fakeScheduler();
		const published: Array<[number, string]> = [];
		const controller = new PublicationController({
			scheduler,
			onPublish: (item, intent) => published.push([item.revision, intent])
		});

		controller.registerRequest(1, 'live');
		controller.receive(result(1), true);
		controller.registerRequest(2, 'commit');
		scheduler.advance(100);
		controller.receive(result(1), false);

		expect(published).toEqual([]);
		controller.receive(result(2), false);
		expect(published).toEqual([[2, 'commit']]);
	});

	it('keeps commit, preset, and restore intents attached to their own revisions', () => {
		for (const intent of ['commit', 'preset', 'restore'] as const) {
			const scheduler = fakeScheduler();
			const published: Array<[number, string]> = [];
			const controller = new PublicationController({
				scheduler,
				onPublish: (item, actualIntent) => published.push([item.revision, actualIntent])
			});

			controller.registerRequest(1, 'live');
			controller.receive(result(1), true);
			controller.registerRequest(2, intent);
			controller.receive(result(1), false);
			controller.receive(result(2), false);

			expect(published).toEqual([[2, intent]]);
		}
	});

	it('rechecks the epoch and revision when a queued timer is delivered', () => {
		const scheduler = fakeScheduler();
		const published: number[] = [];
		const controller = new PublicationController({
			scheduler,
			onPublish: (item) => published.push(item.revision)
		});

		controller.registerRequest(1, 'live');
		controller.receive(result(1), true);
		controller.invalidate();
		controller.registerRequest(2, 'live');
		scheduler.advance(100);

		expect(published).toEqual([]);
		controller.receive(result(2), true);
		scheduler.advance(33);
		expect(published).toEqual([2]);
	});

	it('does not let an obsolete timer publish a newer pending result early', () => {
		const scheduler = fakeScheduler();
		const published: number[] = [];
		const controller = new PublicationController({
			scheduler,
			onPublish: (item) => published.push(item.revision)
		});

		controller.registerRequest(1, 'live');
		controller.receive(result(1), true);
		controller.registerRequest(2, 'live');
		controller.receive(result(2), true);
		scheduler.advance(33);

		expect(published).toEqual([2]);
	});

	it('uses one restore intent for a known Escape baseline and its confirmation request', () => {
		const published: Array<[number, string]> = [];
		const controller = new PublicationController({
			onPublish: (item, intent) => published.push([item.revision, intent])
		});

		controller.registerRequest(1, 'none');
		controller.receive(result(1), false);
		controller.invalidate();
		controller.publishKnownSnapshot(result(1), 'restore');
		controller.registerRequest(2, 'none');
		controller.receive(result(2), false);

		expect(published).toEqual([
			[1, 'none'],
			[1, 'restore'],
			[2, 'none']
		]);
	});

	it('consumes a motion intent exactly once for a revision', () => {
		const published: Array<[number, string]> = [];
		const controller = new PublicationController({
			onPublish: (item, intent) => published.push([item.revision, intent])
		});

		controller.registerRequest(1, 'preset');
		controller.receive(result(1), false);
		controller.receive(result(1), false);

		expect(published).toEqual([[1, 'preset']]);
	});
});
