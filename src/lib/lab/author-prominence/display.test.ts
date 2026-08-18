import { describe, expect, it } from 'vitest';
import { buildDisplayModel, formatRelativePosition } from './display';
import type { Population, ProminenceManifest } from './types';

const manifest = {
	model: {
		features: ['regard', 'reach', 'recognition'],
		feature_labels: { regard: 'Regard', reach: 'Reach', recognition: 'Recognition' },
		feature_blurbs: { regard: 'r', reach: 'a', recognition: 'c' }
	},
	display: { top_n: 10 }
} as unknown as ProminenceManifest;
const population = {
	count: 3,
	names: ['A', 'B', 'C'],
	z: [
		Float64Array.from([1.1, -2.1, 0]),
		Float64Array.from([0, 3.01, -1]),
		Float64Array.from([-0.5, -0.5, 1.2])
	],
	hasRecognition: Uint8Array.from([0, 0, 1]),
	nBooks: new Int32Array(3),
	nReaders: new Int32Array(3),
	bestTier: new Int8Array(3),
	nAwards: new Int32Array(3),
	concentration: new Float64Array(3)
} as Population;

describe('release-derived display model', () => {
	it('uses one clean symmetric domain', () => {
		const result = buildDisplayModel(population, manifest);
		expect(result.domain).toBe(3.5);
	});

	it('formats signed positions for the inspector', () => {
		expect(formatRelativePosition(2.35)).toBe('2.35 above average.');
		expect(formatRelativePosition(-0.64)).toBe('0.64 below average.');
		expect(formatRelativePosition(0)).toBe('At the eligible-author average.');
	});

	it('maps semantic axes explicitly when the release feature order changes', () => {
		const swapped = {
			...manifest,
			model: { ...manifest.model, features: ['recognition', 'regard', 'reach'] }
		} as ProminenceManifest;
		const result = buildDisplayModel(population, swapped);
		expect(result.worldFeatureIndices).toEqual({ regard: 1, reach: 2, recognition: 0 });
		expect(result.axisFeatures.map((feature) => feature.key)).toEqual([
			'regard',
			'reach',
			'recognition'
		]);
	});
});
