import { describe, expect, it } from 'vitest';
import {
	flightDuration,
	homeState,
	interpolateAtScreenPoint,
	projector,
	zoomAtScreenPoint,
	type OrbitState
} from './orbit';
import {
	classifyWheel,
	NavigationController,
	normalizeWheelDelta,
	type NavigationScheduler,
	type PointerSample
} from './navigation';

class FakeScheduler implements NavigationScheduler {
	private nextId = 1;
	private frames = new Map<number, (time: number) => void>();
	private timers = new Map<number, () => void>();

	requestFrame(callback: (time: number) => void): number {
		const id = this.nextId++;
		this.frames.set(id, callback);
		return id;
	}

	cancelFrame(id: number): void {
		this.frames.delete(id);
	}

	setTimeout(callback: () => void): number {
		const id = this.nextId++;
		this.timers.set(id, callback);
		return id;
	}

	clearTimeout(id: unknown): void {
		this.timers.delete(id as number);
	}

	flushFrame(time: number): void {
		const callbacks = [...this.frames.values()];
		this.frames.clear();
		for (const callback of callbacks) callback(time);
	}

	flushTimers(): void {
		const callbacks = [...this.timers.values()];
		this.timers.clear();
		for (const callback of callbacks) callback();
	}
}

function createCamera(): OrbitState {
	return {
		...homeState([
			{ x: -10, y: -5, z: 2 },
			{ x: 8, y: 6, z: -4 }
		]),
		panX: 18,
		panY: -12
	};
}

function sample(overrides: Partial<PointerSample> = {}): PointerSample {
	return {
		id: 1,
		x: 200,
		y: 180,
		pointerType: 'mouse',
		button: 0,
		...overrides
	};
}

describe('navigation input classification', () => {
	it('normalizes line and page wheel deltas', () => {
		expect(normalizeWheelDelta(2, 1, { width: 800, height: 600 }, 20)).toBe(40);
		expect(normalizeWheelDelta(1, 2, { width: 800, height: 600 })).toBe(600);
		expect(normalizeWheelDelta(12, 0, { width: 800, height: 600 })).toBe(12);
	});

	it('prioritizes pinch and shift, then locks horizontal gestures', () => {
		expect(classifyWheel({ deltaX: 2, deltaY: 100, ctrlKey: true, shiftKey: false })).toBe('zoom');
		expect(classifyWheel({ deltaX: 0, deltaY: 100, ctrlKey: false, shiftKey: true })).toBe('pan');
		expect(classifyWheel({ deltaX: 100, deltaY: 2, ctrlKey: false, shiftKey: false })).toBe('pan');
		expect(classifyWheel({ deltaX: 2, deltaY: 100, ctrlKey: false, shiftKey: false })).toBe('zoom');
		expect(classifyWheel({ deltaX: 3, deltaY: 3, ctrlKey: false, shiftKey: false })).toBe(
			'pending'
		);
	});
});

describe('navigation controller', () => {
	it('uses the same frame clock for an idle render request', () => {
		const scheduler = new FakeScheduler();
		const renders: OrbitState[] = [];
		const navigation = new NavigationController(
			createCamera(),
			{
				onCommit: () => {},
				onRender: (camera) => renders.push(camera)
			},
			{ viewport: { width: 800, height: 600 }, scheduler, now: () => 0 }
		);

		navigation.requestRender();
		navigation.requestRender();
		expect(renders).toHaveLength(0);
		scheduler.flushFrame(16);

		expect(renders).toHaveLength(1);
		expect(renders[0]).toEqual(navigation.currentCamera);
	});

	it('coalesces primary orbit moves and never changes camera in the raw handler', () => {
		const scheduler = new FakeScheduler();
		const commits: OrbitState[] = [];
		const navigation = new NavigationController(
			createCamera(),
			{
				onCommit: (camera) => commits.push(camera)
			},
			{ viewport: { width: 800, height: 600 }, scheduler, now: () => 0 }
		);

		navigation.beginPointer(sample());
		navigation.movePointer(sample({ x: 250, y: 210 }));
		navigation.movePointer(sample({ x: 280, y: 230 }));
		expect(commits).toHaveLength(0);
		scheduler.flushFrame(16);

		expect(commits).toHaveLength(1);
		expect(commits[0].yaw).not.toBe(createCamera().yaw);
		expect(commits[0].panX).toBe(createCamera().panX);
	});

	it('uses the pointer-down mode for shift, middle, and right pan drags', () => {
		const run = (button: number, shiftKey = false) => {
			const scheduler = new FakeScheduler();
			const commits: OrbitState[] = [];
			const navigation = new NavigationController(
				createCamera(),
				{
					onCommit: (camera) => commits.push(camera)
				},
				{ viewport: { width: 800, height: 600 }, scheduler, now: () => 0 }
			);
			navigation.beginPointer(sample({ button, shiftKey }));
			navigation.movePointer(sample({ button, shiftKey, x: 250, y: 210 }));
			scheduler.flushFrame(16);
			return commits.at(-1)!;
		};

		const shift = run(0, true);
		const middle = run(1);
		const right = run(2);
		expect(shift.panX).toBe(middle.panX);
		expect(shift.panY).toBe(middle.panY);
		expect(middle.panX).toBe(right.panX);
		expect(middle.panY).toBe(right.panY);
		expect(shift.yaw).toBe(createCamera().yaw);
	});

	it('applies touch pinch zoom and midpoint pan from one immutable snapshot', () => {
		const scheduler = new FakeScheduler();
		const commits: OrbitState[] = [];
		const navigation = new NavigationController(
			createCamera(),
			{
				onCommit: (camera) => commits.push(camera)
			},
			{ viewport: { width: 800, height: 600 }, scheduler, now: () => 0 }
		);

		navigation.beginPointer(sample({ id: 1, pointerType: 'touch', x: 300, y: 280 }));
		navigation.beginPointer(sample({ id: 2, pointerType: 'touch', x: 500, y: 280 }));
		navigation.movePointer(sample({ id: 1, pointerType: 'touch', x: 250, y: 300 }));
		navigation.movePointer(sample({ id: 2, pointerType: 'touch', x: 550, y: 300 }));
		scheduler.flushFrame(16);

		const result = commits.at(-1)!;
		const expected = zoomAtScreenPoint(
			createCamera(),
			{ width: 800, height: 600 },
			{ x: 400, y: 280 },
			createCamera().zoom * 1.5
		);
		expect(result.zoom).toBeCloseTo(expected.zoom, 6);
		expect(result.panX).toBeCloseTo(expected.panX, 6);
		expect(result.panY).toBeCloseTo(expected.panY + 20, 6);
	});

	it('keeps wheel zoom under the cursor and locks a horizontal session to pan', () => {
		const scheduler = new FakeScheduler();
		const initial = createCamera();
		const commits: OrbitState[] = [];
		const navigation = new NavigationController(
			initial,
			{
				onCommit: (camera) => commits.push(camera)
			},
			{ viewport: { width: 800, height: 600 }, scheduler, now: () => 0 }
		);
		const point = { x: 420, y: 260 };
		const world = { x: 1, y: 2, z: -3 };
		const anchor = projector(initial, { width: 800, height: 600 })(world);

		navigation.handleWheel({
			deltaX: 0,
			deltaY: -100,
			deltaMode: 0,
			ctrlKey: false,
			shiftKey: false,
			x: anchor.x,
			y: anchor.y,
			time: 0
		});
		scheduler.flushFrame(16);
		const zoomed = commits.at(-1)!;
		const projected = projector(zoomed, { width: 800, height: 600 })(world);
		expect(projected.x).toBeCloseTo(anchor.x, 5);
		expect(projected.y).toBeCloseTo(anchor.y, 5);
		scheduler.flushTimers();

		navigation.handleWheel({
			deltaX: 120,
			deltaY: 4,
			deltaMode: 0,
			ctrlKey: false,
			shiftKey: false,
			x: point.x,
			y: point.y,
			time: 100
		});
		navigation.handleWheel({
			deltaX: 2,
			deltaY: 100,
			deltaMode: 0,
			ctrlKey: false,
			shiftKey: false,
			x: point.x,
			y: point.y,
			time: 130
		});
		scheduler.flushFrame(66);
		const panned = commits.at(-1)!;
		expect(panned.panX).toBeLessThan(zoomed.panX);
		expect(panned.zoom).toBe(zoomed.zoom);
	});

	it('accumulates ambiguous wheel packets before locking the session', () => {
		const scheduler = new FakeScheduler();
		const initial = createCamera();
		const commits: OrbitState[] = [];
		const navigation = new NavigationController(
			initial,
			{ onCommit: (camera) => commits.push(camera) },
			{ viewport: { width: 800, height: 600 }, scheduler, now: () => 0 }
		);

		navigation.handleWheel({
			deltaX: 3,
			deltaY: 3,
			deltaMode: 0,
			ctrlKey: false,
			shiftKey: false,
			x: 400,
			y: 300,
			time: 0
		});
		scheduler.flushFrame(16);
		expect(commits).toHaveLength(0);

		navigation.handleWheel({
			deltaX: 0,
			deltaY: -100,
			deltaMode: 0,
			ctrlKey: false,
			shiftKey: false,
			x: 400,
			y: 300,
			time: 30
		});
		scheduler.flushFrame(32);
		expect(commits.at(-1)?.zoom).toBeGreaterThan(initial.zoom);
	});

	it('resolves an unresolved diagonal wheel session when it ends', () => {
		const scheduler = new FakeScheduler();
		const initial = createCamera();
		const commits: OrbitState[] = [];
		const navigation = new NavigationController(
			initial,
			{ onCommit: (camera) => commits.push(camera) },
			{ viewport: { width: 800, height: 600 }, scheduler, now: () => 0 }
		);

		navigation.handleWheel({
			deltaX: 12,
			deltaY: 12,
			deltaMode: 0,
			ctrlKey: false,
			shiftKey: false,
			x: 400,
			y: 300,
			time: 0
		});
		scheduler.flushTimers();
		scheduler.flushFrame(16);
		scheduler.flushFrame(32);

		expect(commits.at(-1)?.zoom).toBeLessThan(initial.zoom);
	});

	it('uses the meaningful vertical delta for shifted wheel jitter', () => {
		const scheduler = new FakeScheduler();
		const initial = createCamera();
		const commits: OrbitState[] = [];
		const navigation = new NavigationController(
			initial,
			{ onCommit: (camera) => commits.push(camera) },
			{ viewport: { width: 800, height: 600 }, scheduler, now: () => 0 }
		);

		navigation.handleWheel({
			deltaX: 0.5,
			deltaY: 80,
			deltaMode: 0,
			ctrlKey: false,
			shiftKey: true,
			x: 400,
			y: 300,
			time: 0
		});
		scheduler.flushFrame(16);

		expect(commits.at(-1)?.panX).toBeCloseTo(initial.panX - 80, 6);
	});

	it('keeps a stationary right click available to the browser but suppresses a right drag menu', () => {
		const scheduler = new FakeScheduler();
		const navigation = new NavigationController(
			createCamera(),
			{
				onCommit: () => undefined
			},
			{ viewport: { width: 800, height: 600 }, scheduler, now: () => 0 }
		);

		navigation.beginPointer(sample({ button: 2 }));
		navigation.endPointer(sample({ button: 2 }));
		expect(navigation.consumeContextMenuSuppression()).toBe(false);

		navigation.beginPointer(sample({ id: 2, button: 2 }));
		navigation.movePointer(sample({ id: 2, button: 2, x: 240, y: 180 }));
		expect(navigation.consumeContextMenuSuppression()).toBe(true);
	});

	it('keeps right-drag suppression active through a pause before release', () => {
		const scheduler = new FakeScheduler();
		const navigation = new NavigationController(
			createCamera(),
			{ onCommit: () => undefined },
			{ viewport: { width: 800, height: 600 }, scheduler, now: () => 0 }
		);

		navigation.beginPointer(sample({ id: 3, button: 2 }));
		navigation.movePointer(sample({ id: 3, button: 2, x: 240, y: 180 }));
		scheduler.flushTimers();
		navigation.endPointer(sample({ id: 3, button: 2, x: 240, y: 180 }));
		expect(navigation.consumeContextMenuSuppression()).toBe(true);

		navigation.beginPointer(sample({ id: 4, button: 2 }));
		navigation.movePointer(sample({ id: 4, button: 2, x: 240, y: 180 }));
		navigation.endPointer(sample({ id: 4, button: 2, x: 240, y: 180 }));
		scheduler.flushTimers();
		expect(navigation.consumeContextMenuSuppression()).toBe(false);
	});

	it('accumulates repeated discrete zoom button targets', () => {
		const scheduler = new FakeScheduler();
		const initial = createCamera();
		const commits: OrbitState[] = [];
		const navigation = new NavigationController(
			initial,
			{ onCommit: (camera) => commits.push(camera) },
			{ viewport: { width: 800, height: 600 }, scheduler, now: () => 0 }
		);

		navigation.zoomBy(1.5, false, true);
		navigation.zoomBy(1.5, false, true);
		scheduler.flushFrame(0);
		scheduler.flushFrame(1000);

		expect(commits.at(-1)?.zoom).toBeCloseTo(initial.zoom * 2.25, 8);
	});

	it('retargets a late discrete zoom from the currently displayed camera', () => {
		const scheduler = new FakeScheduler();
		let now = 0;
		const initial = createCamera();
		const viewport = { width: 800, height: 600 };
		const commits: OrbitState[] = [];
		const navigation = new NavigationController(
			initial,
			{ onCommit: (camera) => commits.push(camera) },
			{ viewport, scheduler, now: () => now }
		);
		const anchor = { x: viewport.width / 2, y: viewport.height / 2 };
		const firstTarget = zoomAtScreenPoint(initial, viewport, anchor, initial.zoom * 1.5);
		const firstDuration = flightDuration(initial, firstTarget, viewport);

		navigation.zoomBy(1.5, false, true);
		scheduler.flushFrame(100);
		now = 200;
		navigation.zoomBy(1.5, false, true);
		scheduler.flushFrame(200);

		const expected = interpolateAtScreenPoint(
			initial,
			firstTarget,
			200 / firstDuration,
			viewport,
			anchor
		);
		expect(commits.at(-1)?.zoom).toBeCloseTo(expected.zoom, 8);
		expect(commits.at(-1)?.zoom).toBeLessThan(initial.zoom * 2.25);
	});

	it('does not cancel keyboard zoom or reset flights after dispatch', () => {
		const scheduler = new FakeScheduler();
		const initial = createCamera();
		const commits: OrbitState[] = [];
		const navigation = new NavigationController(
			initial,
			{ onCommit: (camera) => commits.push(camera) },
			{ viewport: { width: 800, height: 600 }, scheduler, now: () => 0 }
		);

		expect(navigation.handleKey('=', false, false)).toBe(true);
		expect(commits).toHaveLength(0);
		scheduler.flushFrame(0);
		scheduler.flushFrame(1000);
		expect(commits.at(-1)?.zoom).toBeCloseTo(initial.zoom * 1.5, 8);

		navigation.resetTo(homeState([]));
		scheduler.flushFrame(1000);
		scheduler.flushFrame(2000);
		expect(commits.at(-1)).toMatchObject({ yaw: homeState([]).yaw, zoom: 1 });
	});

	it('waits to report settled until a coalesced direct camera commit lands', () => {
		const scheduler = new FakeScheduler();
		let settled = 0;
		const navigation = new NavigationController(
			createCamera(),
			{ onCommit: () => undefined, onSettled: () => settled++ },
			{ viewport: { width: 800, height: 600 }, scheduler, now: () => 0 }
		);

		navigation.beginPointer(sample({ button: 1 }));
		navigation.movePointer(sample({ button: 1, x: 240, y: 210 }));
		navigation.endPointer(sample({ button: 1, x: 240, y: 210 }));
		expect(settled).toBe(0);
		scheduler.flushFrame(16);
		expect(settled).toBe(1);
	});
});
