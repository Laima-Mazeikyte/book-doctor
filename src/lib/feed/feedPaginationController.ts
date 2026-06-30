import {
	FEED_BATCH_BROWSE_DWELL_MS,
	FEED_BATCH_PROGRESS_FULL,
	FEED_BATCH_PROGRESS_NEAR_BOTTOM,
	FEED_MAX_CONSECUTIVE_EMPTY_APPENDS
} from '$lib/feed/constants';

export type FeedPaginationPhase =
	| 'idle'
	| 'creditPending'
	| 'readyToPrefetch'
	| 'loading'
	| 'cooldown'
	| 'exhausted';

export type FeedPaginationState = {
	phase: FeedPaginationPhase;
	batchStartIndex: number;
	batchSize: number;
	batchMountedAt: number;
	maxSeenIndex: number;
	lastRequestCreatedAt: number;
	consecutiveEmptyAppends: number;
	sentinelWantsLoad: boolean;
};

export type FeedPaginationEvent =
	| { type: 'ENTER_FEED'; batchStartIndex: number; batchSize: number; now: number }
	| { type: 'RESET' }
	| { type: 'BROWSE_PROGRESS'; maxSeenIndex: number; nearBottom: boolean; columns: number; now: number }
	| { type: 'SENTINEL_PREFETCH'; now: number }
	| { type: 'SENTINEL_BOTTOM'; now: number }
	| { type: 'MANUAL_LOAD'; now: number }
	| { type: 'LOAD_STARTED'; now: number }
	| { type: 'REQUEST_CREATED'; now: number }
	| { type: 'LOAD_COMPLETED'; appendedCount: number; batchStartIndex: number; now: number }
	| { type: 'LOAD_FAILED'; now: number }
	| { type: 'COOLDOWN_BLOCKED'; remainingMs: number; now: number }
	| { type: 'COOLDOWN_ELAPSED'; now: number };

export type FeedPaginationCommand =
	| { type: 'REQUEST_LOAD' }
	| { type: 'SCHEDULE_COOLDOWN_RETRY'; delayMs: number }
	| { type: 'CLEAR_COOLDOWN_RETRY' };

export type FeedPaginationTransition = {
	state: FeedPaginationState;
	commands: FeedPaginationCommand[];
};

export function initialFeedPaginationState(): FeedPaginationState {
	return {
		phase: 'idle',
		batchStartIndex: 0,
		batchSize: 0,
		batchMountedAt: 0,
		maxSeenIndex: -1,
		lastRequestCreatedAt: 0,
		consecutiveEmptyAppends: 0,
		sentinelWantsLoad: false
	};
}

export function feedRequestCooldownRemaining(
	state: FeedPaginationState,
	now: number,
	cooldownMs: number
): number {
	return Math.max(0, cooldownMs - (now - state.lastRequestCreatedAt));
}

export function transitionFeedPagination(
	state: FeedPaginationState,
	event: FeedPaginationEvent
): FeedPaginationTransition {
	switch (event.type) {
		case 'RESET':
			return { state: initialFeedPaginationState(), commands: [{ type: 'CLEAR_COOLDOWN_RETRY' }] };

		case 'ENTER_FEED':
			return {
				state: armBatch(state, event.batchStartIndex, event.batchSize, event.now),
				commands: [{ type: 'CLEAR_COOLDOWN_RETRY' }]
			};

		case 'BROWSE_PROGRESS':
			return {
				state: applyBrowseProgress(state, event),
				commands: []
			};

		case 'SENTINEL_PREFETCH':
		case 'SENTINEL_BOTTOM':
			return sentinelWantsLoad(state);

		case 'MANUAL_LOAD':
			return {
				state: { ...state, phase: 'readyToPrefetch', sentinelWantsLoad: true },
				commands: [{ type: 'CLEAR_COOLDOWN_RETRY' }, { type: 'REQUEST_LOAD' }]
			};

		case 'LOAD_STARTED':
			return {
				state: { ...state, phase: 'loading', sentinelWantsLoad: false },
				commands: [{ type: 'CLEAR_COOLDOWN_RETRY' }]
			};

		case 'REQUEST_CREATED':
			return {
				state: { ...state, lastRequestCreatedAt: event.now },
				commands: []
			};

		case 'LOAD_COMPLETED':
			return loadCompleted(state, event);

		case 'LOAD_FAILED':
			return {
				state: { ...state, phase: 'exhausted', sentinelWantsLoad: false },
				commands: [{ type: 'CLEAR_COOLDOWN_RETRY' }]
			};

		case 'COOLDOWN_BLOCKED':
			return {
				state: { ...state, phase: 'cooldown', sentinelWantsLoad: true },
				commands: [{ type: 'SCHEDULE_COOLDOWN_RETRY', delayMs: Math.max(0, event.remainingMs) }]
			};

		case 'COOLDOWN_ELAPSED': {
			const next = { ...state, phase: 'readyToPrefetch' as const };
			return {
				state: next,
				commands: state.sentinelWantsLoad ? [{ type: 'REQUEST_LOAD' }] : []
			};
		}
	}
}

function sentinelWantsLoad(state: FeedPaginationState): FeedPaginationTransition {
	const next = { ...state, sentinelWantsLoad: true };
	if (state.phase !== 'readyToPrefetch') {
		return { state: next, commands: [] };
	}
	return { state: next, commands: [{ type: 'REQUEST_LOAD' }] };
}

function armBatch(
	state: FeedPaginationState,
	batchStartIndex: number,
	batchSize: number,
	now: number
): FeedPaginationState {
	const safeStart = Math.max(0, batchStartIndex);
	const safeSize = Math.max(0, batchSize);
	return {
		...state,
		phase: safeSize > 0 ? 'creditPending' : 'readyToPrefetch',
		batchStartIndex: safeStart,
		batchSize: safeSize,
		batchMountedAt: now,
		maxSeenIndex: safeStart - 1,
		consecutiveEmptyAppends: 0,
		sentinelWantsLoad: false
	};
}

function applyBrowseProgress(
	state: FeedPaginationState,
	event: Extract<FeedPaginationEvent, { type: 'BROWSE_PROGRESS' }>
): FeedPaginationState {
	if (state.phase !== 'creditPending' || state.batchSize <= 0) return state;

	const maxSeenIndex = Math.max(state.maxSeenIndex, event.maxSeenIndex);
	const next = { ...state, maxSeenIndex };
	if (event.now - state.batchMountedAt < FEED_BATCH_BROWSE_DWELL_MS) return next;

	const progress = batchProgressByRows({
		batchStartIndex: state.batchStartIndex,
		batchSize: state.batchSize,
		maxSeenIndex,
		columns: event.columns
	});
	const hasCredit =
		progress >= FEED_BATCH_PROGRESS_FULL ||
		(event.nearBottom && progress >= FEED_BATCH_PROGRESS_NEAR_BOTTOM);

	return hasCredit ? { ...next, phase: 'readyToPrefetch' } : next;
}

function loadCompleted(
	state: FeedPaginationState,
	event: Extract<FeedPaginationEvent, { type: 'LOAD_COMPLETED' }>
): FeedPaginationTransition {
	if (event.appendedCount > 0) {
		return {
			state: armBatch(state, event.batchStartIndex, event.appendedCount, event.now),
			commands: [{ type: 'CLEAR_COOLDOWN_RETRY' }]
		};
	}

	const consecutiveEmptyAppends = state.consecutiveEmptyAppends + 1;
	const exhausted = consecutiveEmptyAppends >= FEED_MAX_CONSECUTIVE_EMPTY_APPENDS;
	return {
		state: {
			...state,
			phase: exhausted ? 'exhausted' : 'readyToPrefetch',
			consecutiveEmptyAppends,
			sentinelWantsLoad: !exhausted
		},
		commands: []
	};
}

function batchProgressByRows(args: {
	batchStartIndex: number;
	batchSize: number;
	maxSeenIndex: number;
	columns: number;
}): number {
	if (args.batchSize <= 0) return 0;
	const columns = Math.max(1, Math.floor(args.columns) || 1);
	const seenItems = Math.max(0, args.maxSeenIndex - args.batchStartIndex + 1);
	const seenRows = Math.ceil(Math.min(seenItems, args.batchSize) / columns);
	const totalRows = Math.ceil(args.batchSize / columns);
	return totalRows > 0 ? seenRows / totalRows : 0;
}
