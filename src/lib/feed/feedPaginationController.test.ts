import { describe, expect, it } from 'vitest';
import {
	initialFeedPaginationState,
	transitionFeedPagination,
	feedRequestCooldownRemaining,
	type FeedPaginationEvent
} from './feedPaginationController';

const enter = (start = 0, size = 50) =>
	transitionFeedPagination(initialFeedPaginationState(), {
		type: 'ENTER_FEED',
		batchStartIndex: start,
		batchSize: size,
		now: 1000
	}).state;
const progress = (
	overrides: Partial<Extract<FeedPaginationEvent, { type: 'BROWSE_PROGRESS' }>> = {}
) => ({
	type: 'BROWSE_PROGRESS' as const,
	maxVisibleIndex: 24,
	columns: 5,
	remainingRows: 5,
	viewportRows: 2.5,
	rowsPerSecond: 0,
	automaticAllowed: true,
	now: 3000,
	...overrides
});

describe('feed pagination scheduling', () => {
	it('starts with browsing required and waits for dwell even at the bottom', () => {
		const state = enter();
		expect(state.phase).toBe('creditPending');
		expect(
			transitionFeedPagination(
				state,
				progress({ maxVisibleIndex: 49, remainingRows: 0, now: 2999 })
			).commands
		).toEqual([]);
	});
	it('requests with browsing runway without needing a bottom sentinel', () => {
		expect(transitionFeedPagination(enter(), progress()).commands).toEqual([
			{ type: 'REQUEST_LOAD' }
		]);
	});
	it('does not start while too many rows remain', () => {
		expect(transitionFeedPagination(enter(), progress({ remainingRows: 8 })).commands).toEqual([]);
	});
	it('adapts to speed but caps anticipation at 60% of the new batch', () => {
		const mobile = enter();
		const fast = progress({
			columns: 2,
			maxVisibleIndex: 19,
			remainingRows: 15,
			viewportRows: 2,
			rowsPerSecond: 10
		});
		expect(transitionFeedPagination(mobile, { ...fast, rowsPerSecond: 0 }).commands).toEqual([]);
		expect(transitionFeedPagination(mobile, fast).commands).toEqual([{ type: 'REQUEST_LOAD' }]);
		expect(transitionFeedPagination(mobile, { ...fast, remainingRows: 16 }).commands).toEqual([]);
	});
	it('requires the newest batch to enter the viewport, even on short batches', () => {
		expect(
			transitionFeedPagination(enter(50, 3), progress({ maxVisibleIndex: 49, remainingRows: 0 }))
				.commands
		).toEqual([]);
		expect(
			transitionFeedPagination(enter(50, 3), progress({ maxVisibleIndex: 50, remainingRows: 0 }))
				.commands
		).toEqual([{ type: 'REQUEST_LOAD' }]);
	});
	it('never automatically loads at the checkpoint', () => {
		expect(
			transitionFeedPagination(enter(), progress({ automaticAllowed: false, remainingRows: 0 }))
				.commands
		).toEqual([]);
	});
	it('manual Load more bypasses dwell and checkpoint for one batch', () => {
		const manual = transitionFeedPagination(enter(), { type: 'MANUAL_LOAD', now: 1100 });
		expect(manual.commands).toEqual([{ type: 'REQUEST_LOAD' }]);
		const appended = transitionFeedPagination(manual.state, {
			type: 'LOAD_COMPLETED',
			appendedCount: 50,
			batchStartIndex: 50,
			now: 4000
		});
		expect(appended.state.manualLoadPending).toBe(false);
		expect(
			transitionFeedPagination(
				appended.state,
				progress({ automaticAllowed: false, now: 7000, maxVisibleIndex: 99, remainingRows: 0 })
			).commands
		).toEqual([]);
	});
	it('does not issue another request during generation, cooldown, or an error', () => {
		for (const phase of ['loading', 'cooldown', 'exhausted'] as const) {
			expect(transitionFeedPagination({ ...enter(), phase }, progress()).commands).toEqual([]);
		}
		for (const phase of ['loading', 'cooldown'] as const) {
			expect(
				transitionFeedPagination({ ...enter(), phase }, { type: 'MANUAL_LOAD', now: 3000 }).commands
			).toEqual([]);
		}
	});
	it('reassesses foreground/checkpoint after cooldown instead of blindly retrying', () => {
		const blocked = transitionFeedPagination(enter(), {
			type: 'COOLDOWN_BLOCKED',
			remainingMs: 500,
			now: 3000
		});
		expect(blocked.commands).toEqual([{ type: 'SCHEDULE_COOLDOWN_RETRY', delayMs: 500 }]);
		const elapsed = transitionFeedPagination(blocked.state, {
			type: 'COOLDOWN_ELAPSED',
			now: 3500
		});
		expect(elapsed.commands).toEqual([]);
		expect(
			transitionFeedPagination(elapsed.state, progress({ automaticAllowed: false })).commands
		).toEqual([]);
	});
	it('preserves manual intent if browsing pauses before a job starts', () => {
		let state = transitionFeedPagination(enter(), { type: 'MANUAL_LOAD', now: 1100 }).state;
		state = transitionFeedPagination(state, { type: 'LOAD_DEFERRED' }).state;
		expect(transitionFeedPagination(state, progress({ automaticAllowed: false })).commands).toEqual(
			[{ type: 'REQUEST_LOAD' }]
		);
	});
	it('arms a new dwell on every append and stops after repeated empty responses', () => {
		const result = transitionFeedPagination(enter(), {
			type: 'LOAD_COMPLETED',
			appendedCount: 12,
			batchStartIndex: 50,
			now: 4000
		});
		expect(result.state).toMatchObject({
			batchStartIndex: 50,
			batchSize: 12,
			batchMountedAt: 4000,
			phase: 'creditPending'
		});
		let state = result.state;
		for (let i = 0; i < 2; i++)
			state = transitionFeedPagination(state, {
				type: 'LOAD_COMPLETED',
				appendedCount: 0,
				batchStartIndex: 62,
				now: 6000
			}).state;
		expect(state.phase).toBe('exhausted');
		expect(transitionFeedPagination(state, { type: 'MANUAL_LOAD', now: 7000 }).commands).toEqual([
			{ type: 'REQUEST_LOAD' }
		]);
	});
	it('keeps insertion cooldown and clears state on reset', () => {
		const created = transitionFeedPagination(enter(), { type: 'REQUEST_CREATED', now: 3000 }).state;
		expect(feedRequestCooldownRemaining(created, 3500, 2000)).toBe(1500);
		expect(transitionFeedPagination(created, { type: 'RESET' }).state).toEqual(
			initialFeedPaginationState()
		);
	});
});
