import { describe, expect, it } from 'vitest';
import {
	fitPoints,
	flightDuration,
	interpolate,
	projector,
	projectorInto,
	type OrbitState,
	type Point3D
} from './orbit';

function normalised(point: Point3D, camera: OrbitState): Point3D {
	return {
		x: (point.x - camera.centre[0]) / camera.radius,
		y: (point.y - camera.centre[1]) / camera.radius,
		z: (point.z - camera.centre[2]) / camera.radius
	};
}

describe('orbit camera fitting', () => {
	it('honours a useful minimum radius for a singleton fit', () => {
		const fit = fitPoints([{ x: 12, y: -4, z: 8 }], 3);

		expect(fit).toEqual({ centre: [12, -4, 8], radius: 3 });
	});

	it('does not throw the target off screen while moving to a tight fit', () => {
		const from: OrbitState = {
			yaw: 0,
			pitch: 0,
			zoom: 1,
			panX: 0,
			panY: 0,
			centre: [0, 0, 0],
			radius: 100
		};
		const to: OrbitState = {
			...from,
			centre: [90, -20, 10],
			radius: 0.001
		};
		const target = { x: 90, y: -20, z: 10 };
		const start = normalised(target, from);

		for (let step = 0; step <= 20; step++) {
			const current = normalised(target, interpolate(from, to, step / 20));
			expect(Math.abs(current.x)).toBeLessThanOrEqual(Math.abs(start.x) + 1e-9);
			expect(Math.abs(current.y)).toBeLessThanOrEqual(Math.abs(start.y) + 1e-9);
			expect(Math.abs(current.z)).toBeLessThanOrEqual(Math.abs(start.z) + 1e-9);
		}
	});

	it('writes the same projection into buffers as the object projector', () => {
		const camera: OrbitState = {
			yaw: -0.4,
			pitch: 0.7,
			zoom: 1.8,
			panX: 14,
			panY: -9,
			centre: [3, -2, 4],
			radius: 12
		};
		const viewport = { width: 960, height: 640 };
		const point = { x: 8, y: 1, z: -3 };
		const expected = projector(camera, viewport)(point);
		const x = new Float32Array(1);
		const y = new Float32Array(1);
		const depth = new Float32Array(1);
		const perspective = projectorInto(camera, viewport, x, y, depth)(0, point.x, point.y, point.z);

		expect(x[0]).toBeCloseTo(expected.x, 4);
		expect(y[0]).toBeCloseTo(expected.y, 4);
		expect(depth[0]).toBeCloseTo(expected.depth, 5);
		expect(perspective).toBeCloseTo(expected.perspective, 8);
	});

	it('snaps tiny camera corrections and caps large flights', () => {
		const from: OrbitState = {
			yaw: 0,
			pitch: 0,
			zoom: 1,
			panX: 0,
			panY: 0,
			centre: [0, 0, 0],
			radius: 10
		};
		const viewport = { width: 1000, height: 700 };

		expect(flightDuration(from, { ...from, panX: 4 }, viewport)).toBe(0);
		expect(flightDuration(from, { ...from, panX: 300 }, viewport)).toBe(500);
		expect(flightDuration(from, { ...from, zoom: 16 }, viewport)).toBe(750);
	});
});
