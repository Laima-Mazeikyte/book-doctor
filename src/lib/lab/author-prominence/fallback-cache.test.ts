import { describe, expect, it } from 'vitest';
import { buildProjection, type ProjectionTransform } from './camera';
import { matchesFallbackLayer, type FallbackLayerIdentity } from './fallback-cache';

const population = {};
const display = {};

function transform(overrides: Partial<ProjectionTransform> = {}): ProjectionTransform {
	return {
		...buildProjection(
			{ azimuth: 0.4, elevation: 0.3, zoom: 1, panX: 0, panY: 0 },
			{ width: 640, height: 420, dpr: 1, domain: 4 }
		),
		...overrides
	};
}

function identity(
	changes: {
		transform?: ProjectionTransform;
		population?: object;
		display?: object;
		mode?: 'none' | 'sample' | 'settled';
	} = {}
): FallbackLayerIdentity<object, object> & { transform: ProjectionTransform } {
	return {
		transform: transform(),
		population,
		display,
		mode: 'settled',
		...changes
	};
}

describe('fallback population layer identity', () => {
	it('matches the same population, display, projection, and mode', () => {
		const cached = identity();
		expect(matchesFallbackLayer(cached, identity({ transform: cached.transform }))).toBe(true);
	});

	it('invalidates when the population reference changes', () => {
		const cached = identity();
		expect(matchesFallbackLayer(cached, identity({ population: {} }))).toBe(false);
	});

	it('invalidates when the display, mode, or projection changes', () => {
		const cached = identity();
		expect(matchesFallbackLayer(cached, identity({ display: {} }))).toBe(false);
		expect(matchesFallbackLayer(cached, identity({ mode: 'sample' }))).toBe(false);
		expect(
			matchesFallbackLayer(
				cached,
				identity({ transform: transform({ dpr: 2, width: 1280, height: 840 }) })
			)
		).toBe(false);
	});
});
