import { describe, expect, it } from 'vitest';
import {
	buildProjection,
	clipToCssPoint,
	projectClipPoint,
	projectPointWithTransform,
	type CameraState
} from './camera';

const camera: CameraState = { azimuth: -0.8, elevation: 0.52, zoom: 1.12, panX: 17, panY: -9 };
const points: Array<[number, number, number]> = [
	[0, 0, 0],
	[4, 0, 0],
	[0, 4, 0],
	[0, 0, 4],
	[-4, -4, -4],
	[3.2, -1.1, 2.4],
	[-0.42, 1.37, -2.08],
	// Real v1 author coordinates used to guard the production projection path.
	[1.937895, 3.66119, 1.66801],
	[0.506791, 3.266758, 3.66119],
	[0.463374, 2.199166, 0.841472]
];

describe('shared CPU/GPU projection contract', () => {
	it.each([1, 1.5, 2])('round-trips CSS points at DPR %s', (dpr) => {
		const transform = buildProjection(camera, { width: 913, height: 577, dpr, domain: 4 });
		for (const [x, y, z] of points) {
			const cpu = projectPointWithTransform(x, y, z, transform);
			const gpu = clipToCssPoint(projectClipPoint(x, y, z, transform), transform);
			expect(Math.abs(gpu.x - cpu.x)).toBeLessThanOrEqual(0.000001);
			expect(Math.abs(gpu.y - cpu.y)).toBeLessThanOrEqual(0.000001);
			expect(Math.abs(gpu.depth - cpu.depth)).toBeLessThanOrEqual(0.000001);
		}
	});

	it('keeps top-left CSS coordinates stable through resize and camera changes', () => {
		const first = buildProjection(camera, { width: 800, height: 600, dpr: 1, domain: 4 });
		const second = buildProjection(
			{ ...camera, azimuth: 0.3, elevation: -0.4, panX: -32, panY: 21, zoom: 0.8 },
			{ width: 1200, height: 700, dpr: 2, domain: 4 }
		);
		expect(projectPointWithTransform(0, 0, 0, first).x).toBe(417);
		expect(projectPointWithTransform(0, 0, 0, second).x).toBe(568);
		expect(projectPointWithTransform(0, 0, 0, second).y).toBe(371);
	});
});
