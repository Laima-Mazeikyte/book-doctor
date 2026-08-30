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
