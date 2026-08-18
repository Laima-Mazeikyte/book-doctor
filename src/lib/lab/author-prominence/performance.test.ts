import { describe, expect, it } from 'vitest';
import {
	performanceSummary,
	PROMINENCE_PERFORMANCE_BUDGET,
	ProminencePerformanceRecorder
} from './performance';

describe('prominence performance instrumentation', () => {
	it('records interactive and picking budgets without hiding long tasks', () => {
		const recorder = new ProminencePerformanceRecorder();
		recorder.record('camera', 0, 12);
		recorder.record('pick', 20, 71);
		recorder.record('camera', 80, 141);
		const violations = recorder.violations();
		expect(violations.map((sample) => sample.kind)).toEqual(['pick', 'camera']);
		expect(PROMINENCE_PERFORMANCE_BUDGET.interactiveFrameMs).toBeLessThan(17);
	});

	it('reports p50, p95, maximum, and long-task counts for production traces', () => {
		const summary = performanceSummary([
			{ kind: 'camera', duration: 8, longTask: false },
			{ kind: 'camera', duration: 12, longTask: false },
			{ kind: 'camera', duration: 19, longTask: false },
			{ kind: 'camera', duration: 61, longTask: true }
		]);
		expect(summary).toEqual({ count: 4, p50: 12, p95: 61, maximum: 61, longTasks: 1 });
	});
});
