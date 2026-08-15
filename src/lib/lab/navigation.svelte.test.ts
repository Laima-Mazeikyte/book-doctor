import { describe, expect, it } from 'vitest';
import { homeState, type OrbitState } from './orbit';
import {
	NavigationController,
	type NavigationScheduler,
	type PointerSample,
	type NavigationPointerType
} from './navigation';

class BrowserFrameScheduler implements NavigationScheduler {
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

	flushFrame(time = 16): void {
		const callbacks = [...this.frames.values()];
		this.frames.clear();
		for (const callback of callbacks) callback(time);
	}
}

function camera(): OrbitState {
	return homeState([
		{ x: -10, y: -5, z: 2 },
		{ x: 8, y: 6, z: -4 }
	]);
}

function dispatchPointer(
	host: HTMLElement,
	type: 'pointerdown' | 'pointermove' | 'pointerup',
	init: Partial<PointerEventInit> & { pointerId: number; x: number; y: number }
): void {
	const { x, y, ...eventInit } = init;
	host.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			pointerType: 'mouse',
			button: 0,
			clientX: x,
			clientY: y,
			...eventInit
		})
	);
}

function connectPointerEvents(
	host: HTMLElement,
	navigation: NavigationController,
	getType: () => NavigationPointerType = () => 'mouse'
): void {
	const sample = (event: PointerEvent): PointerSample => ({
		id: event.pointerId,
		x: event.clientX,
		y: event.clientY,
		pointerType: getType(),
		button: event.button,
		shiftKey: event.shiftKey
	});
	host.addEventListener('pointerdown', (event) =>
		navigation.beginPointer(sample(event as PointerEvent))
	);
	host.addEventListener('pointermove', (event) =>
		navigation.movePointer(sample(event as PointerEvent))
	);
	host.addEventListener('pointerup', (event) =>
		navigation.endPointer(sample(event as PointerEvent))
	);
}

describe('navigation browser interactions', () => {
	it('coalesces a real primary pointer drag into an orbit commit', () => {
		const host = document.createElement('div');
		document.body.append(host);
		const scheduler = new BrowserFrameScheduler();
		const commits: OrbitState[] = [];
		const navigation = new NavigationController(
			camera(),
			{ onCommit: (next) => commits.push(next) },
			{
				viewport: { width: 800, height: 600 },
				scheduler,
				now: () => 0
			}
		);
		connectPointerEvents(host, navigation);

		dispatchPointer(host, 'pointerdown', { pointerId: 1, x: 200, y: 180 });
		dispatchPointer(host, 'pointermove', { pointerId: 1, x: 250, y: 210 });
		dispatchPointer(host, 'pointermove', { pointerId: 1, x: 280, y: 230 });
		expect(commits).toHaveLength(0);

		scheduler.flushFrame();

		expect(commits).toHaveLength(1);
		expect(commits[0].yaw).not.toBe(camera().yaw);
		expect(commits[0].panX).toBe(camera().panX);

		dispatchPointer(host, 'pointerup', { pointerId: 1, x: 280, y: 230 });
		navigation.dispose();
		host.remove();
	});

	it('uses a touch release coordinate for a stationary tap', () => {
		const host = document.createElement('div');
		document.body.append(host);
		const scheduler = new BrowserFrameScheduler();
		const taps: Array<{ x: number; y: number }> = [];
		const navigation = new NavigationController(
			camera(),
			{ onCommit: () => undefined, onTap: (point) => taps.push(point) },
			{ viewport: { width: 800, height: 600 }, scheduler, now: () => 0 }
		);
		connectPointerEvents(host, navigation, () => 'touch');

		dispatchPointer(host, 'pointerdown', {
			pointerId: 7,
			pointerType: 'touch',
			x: 100,
			y: 120
		});
		dispatchPointer(host, 'pointerup', {
			pointerId: 7,
			pointerType: 'touch',
			x: 106,
			y: 124
		});
		scheduler.flushFrame();

		expect(taps).toEqual([{ x: 106, y: 124 }]);
		navigation.dispose();
		host.remove();
	});
});
