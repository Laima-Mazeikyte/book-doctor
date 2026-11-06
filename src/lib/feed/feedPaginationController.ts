import {
	FEED_BATCH_BROWSE_DWELL_MS,
	FEED_PREFETCH_RUNWAY_SECONDS,
	FEED_REQUEST_BATCH_SIZE,
	FEED_MAX_CONSECUTIVE_EMPTY_APPENDS
} from './constants';

export type FeedPaginationPhase = 'idle' | 'creditPending' | 'loading' | 'cooldown' | 'exhausted';

export type FeedPaginationState = {
	phase: FeedPaginationPhase;
	batchStartIndex: number;
	batchSize: number;
	batchMountedAt: number;
	lastRequestCreatedAt: number;
	consecutiveEmptyAppends: number;
	manualLoadPending: boolean;
};

export type FeedPaginationEvent =
	| { type: 'ENTER_FEED'; batchStartIndex: number; batchSize: number; now: number }
	| { type: 'RESET' }
	| {
			type: 'BROWSE_PROGRESS';
			maxVisibleIndex: number;
			columns: number;
			remainingRows: number;
			viewportRows: number;
			rowsPerSecond: number;
			automaticAllowed: boolean;
			now: number;
	  }
	| { type: 'MANUAL_LOAD'; now: number }
	| { type: 'LOAD_STARTED'; now: number }
	| { type: 'LOAD_DEFERRED' }
	| { type: 'REQUEST_CREATED'; now: number }
	| { type: 'LOAD_COMPLETED'; appendedCount: number; batchStartIndex: number; now: number }
	| { type: 'LOAD_FAILED'; now: number }
	| { type: 'COOLDOWN_BLOCKED'; remainingMs: number; now: number }
	| { type: 'COOLDOWN_ELAPSED'; now: number };

export type FeedPaginationCommand =
	| { type: 'REQUEST_LOAD' }
	| { type: 'SCHEDULE_COOLDOWN_RETRY'; delayMs: number }
	| { type: 'CLEAR_COOLDOWN_RETRY' };

export function initialFeedPaginationState(): FeedPaginationState {
	return {
		phase: 'idle',
		batchStartIndex: 0,
		batchSize: 0,
		batchMountedAt: 0,
		lastRequestCreatedAt: 0,
		consecutiveEmptyAppends: 0,
		manualLoadPending: false
	};
}

export function feedRequestCooldownRemaining(
	state: FeedPaginationState,
	now: number,
	cooldownMs: number
) {
	return Math.max(0, cooldownMs - (now - state.lastRequestCreatedAt));
}

/** A single decision based on the visible grid, rather than a second bottom-sentinel gate. */
export function transitionFeedPagination(
	state: FeedPaginationState,
	event: FeedPaginationEvent
): { state: FeedPaginationState; commands: FeedPaginationCommand[] } {
	switch (event.type) {
		case 'RESET':
			return { state: initialFeedPaginationState(), commands: [{ type: 'CLEAR_COOLDOWN_RETRY' }] };
		case 'ENTER_FEED':
			return {
				state: armBatch(state, event.batchStartIndex, event.batchSize, event.now),
				commands: [{ type: 'CLEAR_COOLDOWN_RETRY' }]
			};
		case 'BROWSE_PROGRESS': {
			if (state.phase !== 'creditPending') return { state, commands: [] };
			const batchRows = Math.ceil(
				Math.min(state.batchSize, FEED_REQUEST_BATCH_SIZE) / Math.max(1, event.columns)
			);
			// Keep two viewport heights available, or seven seconds at recent speed.
			// Never request before entering the newest batch or while over 60% of it remains.
			const runwayRows = Math.min(
				Math.ceil(batchRows * 0.6),
				Math.max(
					2,
					Math.ceil(event.viewportRows * 2),
					Math.ceil(event.rowsPerSecond * FEED_PREFETCH_RUNWAY_SECONDS)
				)
			);
			const ready =
				state.manualLoadPending ||
				(event.automaticAllowed &&
					event.now - state.batchMountedAt >= FEED_BATCH_BROWSE_DWELL_MS &&
					event.maxVisibleIndex >= state.batchStartIndex &&
					event.remainingRows <= runwayRows);
			return { state, commands: ready ? [{ type: 'REQUEST_LOAD' }] : [] };
		}
		case 'MANUAL_LOAD':
			if (state.phase === 'loading' || state.phase === 'cooldown') return { state, commands: [] };
			return { state: { ...state, manualLoadPending: true }, commands: [{ type: 'REQUEST_LOAD' }] };
		case 'LOAD_STARTED':
			return {
				state: { ...state, phase: 'loading' },
				commands: [{ type: 'CLEAR_COOLDOWN_RETRY' }]
			};
		case 'LOAD_DEFERRED':
		case 'COOLDOWN_ELAPSED':
			// The route measures again and checks visibility/checkpoint before any retry.
			return { state: { ...state, phase: 'creditPending' }, commands: [] };
		case 'REQUEST_CREATED':
			return { state: { ...state, lastRequestCreatedAt: event.now }, commands: [] };
		case 'LOAD_COMPLETED': {
			if (event.appendedCount > 0)
				return {
					state: armBatch(state, event.batchStartIndex, event.appendedCount, event.now),
					commands: [{ type: 'CLEAR_COOLDOWN_RETRY' }]
				};
			const consecutiveEmptyAppends = state.consecutiveEmptyAppends + 1;
			return {
				state: {
					...state,
					consecutiveEmptyAppends,
					manualLoadPending: false,
					phase:
						consecutiveEmptyAppends >= FEED_MAX_CONSECUTIVE_EMPTY_APPENDS
							? 'exhausted'
							: 'creditPending'
				},
				commands: []
			};
		}
		case 'LOAD_FAILED':
			return {
				state: { ...state, phase: 'exhausted', manualLoadPending: false },
				commands: [{ type: 'CLEAR_COOLDOWN_RETRY' }]
			};
		case 'COOLDOWN_BLOCKED':
			return {
				state: { ...state, phase: 'cooldown' },
				commands: [{ type: 'SCHEDULE_COOLDOWN_RETRY', delayMs: Math.max(0, event.remainingMs) }]
			};
	}
}

function armBatch(
	state: FeedPaginationState,
	batchStartIndex: number,
	batchSize: number,
	now: number
): FeedPaginationState {
	return {
		...state,
		phase: 'creditPending',
		batchStartIndex: Math.max(0, batchStartIndex),
		batchSize: Math.max(0, batchSize),
		batchMountedAt: now,
		consecutiveEmptyAppends: 0,
		manualLoadPending: false
	};
}
