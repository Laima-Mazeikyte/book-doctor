import { describe, expect, it } from 'vitest';
import {
	initialFeedPaginationState,
	transitionFeedPagination,
	type FeedPaginationCommand,
	type FeedPaginationState
} from './feedPaginationController';

function transition(state: FeedPaginationState, event: Parameters<typeof transitionFeedPagination>[1]) {
	return transitionFeedPagination(state, event).state;
}

function commands(state: FeedPaginationState, event: Parameters<typeof transitionFeedPagination>[1]) {
	return transitionFeedPagination(state, event).commands;
}

describe('feedPaginationController', () => {
	it('enters creditPending when a feed batch is armed', () => {
		const state = transition(initialFeedPaginationState(), {
			type: 'ENTER_FEED',
			batchStartIndex: 100,
			batchSize: 50,
			now: 1000
		});

		expect(state.phase).toBe('creditPending');
		expect(state.batchStartIndex).toBe(100);
		expect(state.batchSize).toBe(50);
		expect(state.maxSeenIndex).toBe(99);
	});

	it('does not grant browse credit before dwell time passes', () => {
		let state = transition(initialFeedPaginationState(), {
			type: 'ENTER_FEED',
			batchStartIndex: 0,
			batchSize: 50,
			now: 1000
		});

		state = transition(state, {
			type: 'BROWSE_PROGRESS',
			maxSeenIndex: 49,
			nearBottom: true,
			columns: 5,
			now: 2500
		});

		expect(state.phase).toBe('creditPending');
	});

	it('grants browse credit after enough row progress and dwell', () => {
		let state = transition(initialFeedPaginationState(), {
			type: 'ENTER_FEED',
			batchStartIndex: 0,
			batchSize: 50,
			now: 1000
		});

		state = transition(state, {
			type: 'BROWSE_PROGRESS',
			maxSeenIndex: 24,
			nearBottom: false,
			columns: 5,
			now: 3100
		});

		expect(state.phase).toBe('readyToPrefetch');
	});

	it('grants browse credit with lower progress near the bottom', () => {
		let state = transition(initialFeedPaginationState(), {
			type: 'ENTER_FEED',
			batchStartIndex: 100,
			batchSize: 50,
			now: 1000
		});

		state = transition(state, {
			type: 'BROWSE_PROGRESS',
			maxSeenIndex: 114,
			nearBottom: true,
			columns: 5,
			now: 3100
		});

		expect(state.phase).toBe('readyToPrefetch');
	});

	it('requests a load only when ready to prefetch', () => {
		const pending = transition(initialFeedPaginationState(), {
			type: 'ENTER_FEED',
			batchStartIndex: 0,
			batchSize: 50,
			now: 1000
		});
		expect(commands(pending, { type: 'SENTINEL_PREFETCH', now: 3200 })).toEqual([]);

		const ready = transition(pending, {
			type: 'BROWSE_PROGRESS',
			maxSeenIndex: 24,
			nearBottom: false,
			columns: 5,
			now: 3200
		});
		expect(commands(ready, { type: 'SENTINEL_PREFETCH', now: 3300 })).toEqual([
			{ type: 'REQUEST_LOAD' }
		] satisfies FeedPaginationCommand[]);
	});

	it('manual load bypasses browse credit', () => {
		const pending = transition(initialFeedPaginationState(), {
			type: 'ENTER_FEED',
			batchStartIndex: 0,
			batchSize: 50,
			now: 1000
		});

		const result = transitionFeedPagination(pending, { type: 'MANUAL_LOAD', now: 1200 });

		expect(result.state.phase).toBe('readyToPrefetch');
		expect(result.commands).toContainEqual({ type: 'REQUEST_LOAD' });
	});

	it('schedules a cooldown retry and requests after cooldown elapses when sentinel still wants load', () => {
		let state = transition(initialFeedPaginationState(), {
			type: 'ENTER_FEED',
			batchStartIndex: 0,
			batchSize: 50,
			now: 1000
		});
		state = transition(state, {
			type: 'BROWSE_PROGRESS',
			maxSeenIndex: 24,
			nearBottom: false,
			columns: 5,
			now: 3200
		});
		state = transition(state, { type: 'SENTINEL_BOTTOM', now: 3300 });

		const blocked = transitionFeedPagination(state, {
			type: 'COOLDOWN_BLOCKED',
			remainingMs: 500,
			now: 3300
		});
		expect(blocked.state.phase).toBe('cooldown');
		expect(blocked.commands).toEqual([{ type: 'SCHEDULE_COOLDOWN_RETRY', delayMs: 500 }]);

		const elapsed = transitionFeedPagination(blocked.state, {
			type: 'COOLDOWN_ELAPSED',
			now: 3800
		});
		expect(elapsed.state.phase).toBe('readyToPrefetch');
		expect(elapsed.commands).toEqual([{ type: 'REQUEST_LOAD' }]);
	});

	it('stops auto-pagination after repeated empty appends', () => {
		let state = transition(initialFeedPaginationState(), {
			type: 'ENTER_FEED',
			batchStartIndex: 0,
			batchSize: 50,
			now: 1000
		});

		state = transition(state, {
			type: 'LOAD_COMPLETED',
			appendedCount: 0,
			batchStartIndex: 50,
			now: 2000
		});
		expect(state.phase).toBe('readyToPrefetch');

		state = transition(state, {
			type: 'LOAD_COMPLETED',
			appendedCount: 0,
			batchStartIndex: 50,
			now: 3000
		});
		expect(state.phase).toBe('exhausted');
	});

	it('partial appends arm a new browse-credit batch instead of exhausting', () => {
		let state = transition(initialFeedPaginationState(), {
			type: 'ENTER_FEED',
			batchStartIndex: 0,
			batchSize: 50,
			now: 1000
		});

		state = transition(state, {
			type: 'LOAD_COMPLETED',
			appendedCount: 12,
			batchStartIndex: 50,
			now: 3000
		});

		expect(state.phase).toBe('creditPending');
		expect(state.batchStartIndex).toBe(50);
		expect(state.batchSize).toBe(12);
		expect(state.consecutiveEmptyAppends).toBe(0);
	});
});
