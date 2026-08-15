import { describe, expect, it } from 'vitest';
import {
	fitPoints,
	fitProjectedPoints,
	flightDuration,
	interpolate,
	interpolateAtScreenPoint,
	projector,
	projectorInto,
	zoomAtScreenPoint,
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
	const viewport = { width: 1000, height: 700 };
	const camera: OrbitState = {
		yaw: -0.4,
		pitch: 0.7,
		zoom: 1.8,
		panX: 42,
		panY: -18,
		centre: [3, -2, 4],
		radius: 12
	};

	it('keeps the world point under an anchor fixed during zoom', () => {
		const point = { x: 8, y: 1, z: -3 };
		const anchor = projector(camera, viewport)(point);
		const zoomed = zoomAtScreenPoint(camera, viewport, anchor, 4);

		expect(projector(zoomed, viewport)(point).x).toBeCloseTo(anchor.x, 8);
		expect(projector(zoomed, viewport)(point).y).toBeCloseTo(anchor.y, 8);
	});

	it('does not move pan when zoom is already clamped at a limit', () => {
		const atLimit = { ...camera, zoom: 12, panX: 7, panY: -11 };
		const result = zoomAtScreenPoint(atLimit, viewport, { x: 123, y: 456 }, 99);

		expect(result).toBe(atLimit);
	});

	it('keeps a button zoom anchored throughout the eased flight', () => {
		const point = { x: 8, y: 1, z: -3 };
		const anchor = projector(camera, viewport)(point);
		const target = zoomAtScreenPoint(camera, viewport, anchor, 4);

		for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
			const current = interpolateAtScreenPoint(camera, target, progress, viewport, anchor);
			const projected = projector(current, viewport)(point);
			expect(projected.x).toBeCloseTo(anchor.x, 6);
			expect(projected.y).toBeCloseTo(anchor.y, 6);
		}
	});

	it('fits the actual projected rectangle inside a safe viewport', () => {
		const points = [
			{ x: -8, y: -2, z: 0 },
			{ x: 7, y: 4, z: 2 },
			{ x: 0, y: 1, z: -9 }
		];
		const fitted = fitProjectedPoints(
			points,
			camera,
			viewport,
			{
				left: 40,
				top: 50,
				right: 940,
				bottom: 640
			},
			{ padding: 20, maxZoom: 4 }
		);
		const bounds = projector(fitted, viewport);
		const projected = points.map(bounds);
		const minX = Math.min(...projected.map((point) => point.x));
		const maxX = Math.max(...projected.map((point) => point.x));
		const minY = Math.min(...projected.map((point) => point.y));
		const maxY = Math.max(...projected.map((point) => point.y));

		expect(minX).toBeGreaterThanOrEqual(40 - 1e-6);
		expect(maxX).toBeLessThanOrEqual(940 + 1e-6);
		expect(minY).toBeGreaterThanOrEqual(50 - 1e-6);
		expect(maxY).toBeLessThanOrEqual(640 + 1e-6);
	});

	it('supports separate horizontal and vertical fit allowances', () => {
		const points = [
			{ x: -8, y: -2, z: 0 },
			{ x: 7, y: 4, z: 2 },
			{ x: 0, y: 1, z: -9 }
		];
		const fitted = fitProjectedPoints(
			points,
			camera,
			viewport,
			{ left: 40, top: 50, right: 940, bottom: 640 },
			{ paddingX: 100, paddingY: 60, maxZoom: 4 }
		);
		const projected = points.map(projector(fitted, viewport));

		expect(Math.min(...projected.map((point) => point.x))).toBeGreaterThanOrEqual(140 - 1e-6);
		expect(Math.max(...projected.map((point) => point.x))).toBeLessThanOrEqual(840 + 1e-6);
		expect(Math.min(...projected.map((point) => point.y))).toBeGreaterThanOrEqual(110 - 1e-6);
		expect(Math.max(...projected.map((point) => point.y))).toBeLessThanOrEqual(580 + 1e-6);
	});

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
