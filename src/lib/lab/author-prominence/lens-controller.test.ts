import { describe, expect, it } from 'vitest';
import {
	beginLensGesture,
	cancelLensGesture,
	commitLensGesture,
	updateLensGesture
} from './lens-controller';
import { defaultLens } from './lens';
import type { ProminenceManifest } from './types';

const manifest = {
	presets: [{ name: 'Balanced', weights: [0.35, 0.35, 0.3], settled: true, note: 'tested' }],
	model: { features: ['regard', 'reach', 'recognition'] }
} as ProminenceManifest;

describe('central lens gesture lifecycle', () => {
	it('begins, updates and commits one shared gesture', () => {
		const starting = defaultLens(manifest);
		const active = beginLensGesture(1, 'slider', starting, null);
		const updated = updateLensGesture(active, manifest, [0.7, 0.161538461538, 0.138461538462], 0);
		const committed = commitLensGesture(updated, manifest);
		expect(committed.gesture.status).toBe('committed');
		expect(committed.lens.displayShares).toEqual([70, 16, 14]);
	});

	it('Escape and pointer cancellation restore the immutable starting lens', () => {
		const starting = defaultLens(manifest);
		const active = updateLensGesture(
			beginLensGesture(2, 'triangle', starting, null),
			manifest,
			[0, 0, 1],
			2
		);
		const cancelled = cancelLensGesture(active);
		expect(cancelled.gesture.status).toBe('cancelled');
		expect(cancelled.lens.weights).toEqual(starting.weights);
		const ignored = updateLensGesture(cancelled.gesture, manifest, [1, 0, 0], 0);
		expect(ignored.currentDraft.weights).toEqual(starting.weights);
	});

	it('the next interaction gets a new gesture ID', () => {
		const starting = defaultLens(manifest);
		expect(beginLensGesture(3, 'slider', starting, null).id).not.toBe(
			beginLensGesture(4, 'slider', starting, null).id
		);
	});
});
