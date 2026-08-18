import type { RankingResult } from './ranking-engine';

export type PublicationMotionIntent = 'live' | 'commit' | 'preset' | 'restore' | 'none';

export interface PublicationScheduler {
	now: () => number;
	setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
	clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface PublicationControllerOptions {
	onPublish: (result: RankingResult, intent: PublicationMotionIntent) => void;
	intervalMs?: number;
	scheduler?: PublicationScheduler;
}

interface RequestedRevision {
	revision: number;
	intent: PublicationMotionIntent;
}

function browserScheduler(): PublicationScheduler {
	return {
		now: () => performance.now(),
		setTimeout: (callback, delay) => setTimeout(callback, delay),
		clearTimeout: (timer) => clearTimeout(timer)
	};
}

/**
 * Transactional result publication for live gestures and discrete lens actions.
 *
 * A request is registered before the ranking client pumps it. That is important for
 * synchronous fallback: the result callback can run inside request(), but it still sees
 * the same latest-revision watermark as an asynchronous worker result.
 */
export class PublicationController {
	private readonly onPublish: PublicationControllerOptions['onPublish'];
	private readonly intervalMs: number;
	private readonly scheduler: PublicationScheduler;
	private epoch = 0;
	private latestRequestedRevision = 0;
	private minimumRevision = 0;
	private lastPublicationAt = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private timerToken = 0;
	private pending: RankingResult | null = null;
	private pendingEpoch = 0;
	private currentRequest: RequestedRevision | null = null;

	constructor(options: PublicationControllerOptions) {
		this.onPublish = options.onPublish;
		this.intervalMs = options.intervalMs ?? 33;
		this.scheduler = options.scheduler ?? browserScheduler();
	}

	getEpoch(): number {
		return this.epoch;
	}

	getLatestRequestedRevision(): number {
		return this.latestRequestedRevision;
	}

	getMinimumRevision(): number {
		return this.minimumRevision;
	}

	/**
	 * Register the revision at the allocation boundary, before ranking work is pumped.
	 * A newer request immediately makes every older queued result ineligible.
	 */
	registerRequest(revision: number, intent: PublicationMotionIntent): void {
		if (!Number.isInteger(revision) || revision <= 0) return;
		if (revision < this.latestRequestedRevision) return;
		this.latestRequestedRevision = revision;
		this.minimumRevision = Math.max(this.minimumRevision, revision);
		this.currentRequest = { revision, intent };
		this.pending = null;
		this.pendingEpoch = this.epoch;
		this.clearTimer();
	}

	/** Cancel all draft publication work at a gesture or state boundary. */
	invalidate(resetThrottle = true): void {
		this.epoch += 1;
		this.clearTimer();
		this.pending = null;
		this.pendingEpoch = this.epoch;
		this.currentRequest = null;
		if (resetThrottle) this.lastPublicationAt = 0;
		this.minimumRevision = Math.max(this.minimumRevision, this.latestRequestedRevision + 1);
	}

	/** A new lifecycle starts its revision namespace from zero. */
	reset(): void {
		this.epoch += 1;
		this.clearTimer();
		this.pending = null;
		this.pendingEpoch = this.epoch;
		this.lastPublicationAt = 0;
		this.latestRequestedRevision = 0;
		this.minimumRevision = 0;
		this.currentRequest = null;
	}

	/** Publish a known immutable snapshot, such as the starting snapshot on Escape. */
	publishKnownSnapshot(result: RankingResult, intent: PublicationMotionIntent): void {
		this.publish(result, intent, true);
	}

	receive(result: RankingResult, activeGesture: boolean): void {
		if (!this.isEligible(result)) return;
		const epoch = this.epoch;
		if (!activeGesture) {
			this.publish(result);
			return;
		}
		const elapsed = this.scheduler.now() - this.lastPublicationAt;
		if (elapsed >= this.intervalMs && this.timer === null) {
			this.publish(result);
			return;
		}
		this.pending = result;
		this.pendingEpoch = epoch;
		if (this.timer === null) {
			const timerToken = ++this.timerToken;
			const scheduledRevision = result.revision;
			this.timer = this.scheduler.setTimeout(
				() => {
					if (this.timerToken !== timerToken) return;
					this.timer = null;
					const pending = this.pending;
					if (
						pending &&
						pending.revision === scheduledRevision &&
						this.pendingEpoch === epoch &&
						this.epoch === epoch &&
						this.isEligible(pending)
					) {
						this.publish(pending);
					} else if (pending?.revision !== this.latestRequestedRevision) {
						this.pending = null;
					}
				},
				Math.max(0, this.intervalMs - Math.max(0, elapsed))
			);
		}
	}

	destroy(): void {
		this.invalidate(true);
		this.latestRequestedRevision = Number.MAX_SAFE_INTEGER;
		this.minimumRevision = Number.MAX_SAFE_INTEGER;
	}

	private isEligible(result: RankingResult): boolean {
		return Boolean(
			this.currentRequest &&
			result.revision === this.latestRequestedRevision &&
			result.revision >= this.minimumRevision &&
			this.currentRequest.revision === result.revision
		);
	}

	private publish(
		result: RankingResult,
		intentOverride?: PublicationMotionIntent,
		force = false
	): void {
		if (!force && !this.isEligible(result)) return;
		this.clearTimer();
		this.pending = null;
		this.pendingEpoch = this.epoch;
		const intent = intentOverride ?? this.currentRequest?.intent ?? 'none';
		if (!force) this.currentRequest = null;
		this.lastPublicationAt = this.scheduler.now();
		this.onPublish(result, intent);
	}

	private clearTimer(): void {
		this.timerToken += 1;
		if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
		this.timer = null;
	}
}
