export interface PerformanceBudget {
	interactiveFrameMs: number;
	finalRankingMs: number;
	pickMs: number;
	settleMs: number;
}

export const PROMINENCE_PERFORMANCE_BUDGET: PerformanceBudget = {
	interactiveFrameMs: 16.7,
	finalRankingMs: 100,
	pickMs: 50,
	settleMs: 100
};

export type ProminenceTimingName =
	| 'pointer'
	| 'lens-derivation'
	| 'url-serialization'
	| 'worker-request'
	| 'worker-rank'
	| 'worker-deserialization'
	| 'immediate-ranking'
	| 'reactive-update'
	| 'row-measure'
	| 'flip-setup'
	| 'layout'
	| 'canvas'
	| 'settlement'
	| 'pick';

let timingSequence = 0;

function timingEnabled(): boolean {
	if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return false;
	try {
		return Boolean(import.meta.env?.DEV || import.meta.env?.MODE === 'test');
	} catch {
		return false;
	}
}

/** Lightweight User Timing hooks; production builds do not create marks or measures. */
export function prominenceTimingMark(name: ProminenceTimingName): string | null {
	if (!timingEnabled()) return null;
	const mark = `author-prominence:${name}:${timingSequence++}`;
	performance.mark(mark);
	return mark;
}

export function prominenceTimingMeasure(
	name: ProminenceTimingName,
	startMark: string | null
): void {
	if (!startMark || !timingEnabled() || typeof performance.measure !== 'function') return;
	try {
		performance.measure(`author-prominence:${name}`, startMark);
	} catch {
		// A cleared browser timeline must never affect the interaction itself.
	}
}

export function withProminenceTiming<T>(name: ProminenceTimingName, work: () => T): T {
	const start = prominenceTimingMark(name);
	try {
		return work();
	} finally {
		prominenceTimingMeasure(name, start);
	}
}

export interface PerformanceSample {
	kind: 'camera' | 'ranking' | 'selection' | 'dimensions' | 'population' | 'pick';
	duration: number;
	longTask: boolean;
}

export interface PerformanceSummary {
	count: number;
	p50: number;
	p95: number;
	maximum: number;
	longTasks: number;
}

function percentile(values: number[], fraction: number): number {
	if (values.length === 0) return 0;
	const sorted = values.slice().sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
	return sorted[index] ?? 0;
}

/** Summarise the same samples used by the release performance harness. */
export function performanceSummary(samples: PerformanceSample[]): PerformanceSummary {
	const durations = samples.map((sample) => sample.duration);
	return {
		count: samples.length,
		p50: percentile(durations, 0.5),
		p95: percentile(durations, 0.95),
		maximum: durations.length ? Math.max(...durations) : 0,
		longTasks: samples.filter((sample) => sample.longTask).length
	};
}

/** Small, allocation-light recorder used in development and automated budget tests. */
export class ProminencePerformanceRecorder {
	private readonly samples: PerformanceSample[] = [];
	private maxSamples = 240;

	record(kind: PerformanceSample['kind'], start: number, end: number): void {
		const duration = Math.max(0, end - start);
		this.samples.push({ kind, duration, longTask: duration > 50 });
		if (this.samples.length > this.maxSamples) this.samples.shift();
	}

	snapshot(): PerformanceSample[] {
		return this.samples.map((sample) => ({ ...sample }));
	}

	violations(budget = PROMINENCE_PERFORMANCE_BUDGET): PerformanceSample[] {
		return this.samples.filter((sample) => {
			if (sample.longTask) return true;
			if (sample.kind === 'pick') return sample.duration > budget.pickMs;
			if (sample.kind === 'ranking') return sample.duration > budget.finalRankingMs;
			return sample.duration > budget.interactiveFrameMs;
		});
	}
}
