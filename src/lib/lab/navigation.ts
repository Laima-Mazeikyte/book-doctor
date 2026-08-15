import {
	clampPitch,
	clampZoom,
	flightDuration,
	interpolate,
	interpolateAtScreenPoint,
	zoomAtScreenPoint,
	type OrbitState,
	type ScreenPoint,
	type Viewport
} from './orbit';

export type NavigationPhase =
	| 'idle'
	| 'orbit-drag'
	| 'pan-drag'
	| 'two-finger-transform'
	| 'wheel-zoom'
	| 'horizontal-wheel-pan'
	| 'camera-flight'
	| 'lost-map-recovery';

export type CameraCommitKind = 'orbit' | 'pan' | 'zoom' | 'flight' | 'canonical' | 'data';

export type NavigationPointerType = 'mouse' | 'pen' | 'touch';

export interface PointerSample {
	id: number;
	x: number;
	y: number;
	pointerType: NavigationPointerType;
	button: number;
	shiftKey?: boolean;
}

export interface WheelSample {
	deltaX: number;
	deltaY: number;
	deltaMode: number;
	ctrlKey: boolean;
	shiftKey: boolean;
	x: number;
	y: number;
	time?: number;
}

export interface NavigationScheduler {
	requestFrame(callback: (time: number) => void): number;
	cancelFrame(id: number): void;
	setTimeout(callback: () => void, delay: number): unknown;
	clearTimeout(id: unknown): void;
}

export interface NavigationCallbacks {
	onCommit(camera: OrbitState, kind: CameraCommitKind): void;
	/** Paint the committed camera sample in the same frame as the camera update. */
	onRender?(camera: OrbitState, kind: CameraCommitKind, moving: boolean): void;
	onPhaseChange?(phase: NavigationPhase): void;
	onTap?(point: ScreenPoint, pointerType: NavigationPointerType): void;
	onSettled?(): void;
	/** Return the smallest pan correction needed after a pan or wheel session, or null. */
	recover?(camera: OrbitState): OrbitState | null;
	reducedMotion?(): boolean;
}

export interface NavigationOptions {
	viewport?: Viewport;
	lineHeight?: number;
	scheduler?: NavigationScheduler;
	now?: () => number;
}

interface PointerSession {
	id: number;
	pointerType: NavigationPointerType;
	mode: 'orbit' | 'pan';
	button: number;
	start: ScreenPoint;
	base: OrbitState;
	threshold: number;
	moved: boolean;
	tapEligible: boolean;
	rightButton: boolean;
}

interface ActivePointer extends PointerSample {
	lastX: number;
	lastY: number;
}

interface TouchGesture {
	ids: [number, number];
	base: OrbitState;
	startMidpoint: ScreenPoint;
	startDistance: number;
}

interface WheelSession {
	kind: 'zoom' | 'pan' | null;
	lastAt: number;
	anchor: ScreenPoint;
	zoomDelta: number;
	panDelta: number;
	classificationX: number;
	classificationY: number;
	pendingZoomDelta: number;
	pendingPanDelta: number;
	ended: boolean;
}

interface Flight {
	from: OrbitState;
	to: OrbitState;
	start: number;
	duration: number;
	anchor: ScreenPoint | null;
	source: 'semantic' | 'keyboard-zoom' | 'recovery';
}

const WHEEL_SESSION_GAP_MS = 80;
const WHEEL_LINE_HEIGHT = 16;
const WHEEL_AXIS_DEAD_ZONE = 4;
const WHEEL_DECISIVENESS_RATIO = 1.35;
const MAX_WHEEL_ZOOM_DELTA_PER_FRAME = 240;
const MAX_WHEEL_PAN_DELTA_PER_FRAME = 640;
const ZOOM_SENSITIVITY = 0.001;
const MOUSE_CLICK_THRESHOLD = 4;
const RIGHT_CLICK_THRESHOLD = 6;
const TOUCH_TAP_THRESHOLD = 9;
const KEYBOARD_SESSION_GAP_MS = 100;
const MIN_POINTER_DISTANCE = 0.0001;

const DEFAULT_SCHEDULER: NavigationScheduler = {
	requestFrame(callback) {
		if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
		return setTimeout(() => callback(Date.now()), 16) as unknown as number;
	},
	cancelFrame(id) {
		if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
		else clearTimeout(id);
	},
	setTimeout(callback, delay) {
		return setTimeout(callback, delay);
	},
	clearTimeout(id) {
		clearTimeout(id as ReturnType<typeof setTimeout>);
	}
};

function cloneCamera(camera: OrbitState): OrbitState {
	return { ...camera, centre: [...camera.centre] as OrbitState['centre'] };
}

function distance(a: ScreenPoint, b: ScreenPoint): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: ScreenPoint, b: ScreenPoint): ScreenPoint {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function normalisePointerType(pointerType: string): NavigationPointerType {
	if (pointerType === 'touch') return 'touch';
	if (pointerType === 'pen') return 'pen';
	return 'mouse';
}

export function normalizeWheelDelta(
	delta: number,
	deltaMode: number,
	viewport: Viewport,
	lineHeight = WHEEL_LINE_HEIGHT
): number {
	if (deltaMode === 1) return delta * lineHeight;
	if (deltaMode === 2) return delta * Math.max(viewport.height, 1);
	return delta;
}

export function classifyWheel(
	sample: Pick<WheelSample, 'deltaX' | 'deltaY' | 'ctrlKey' | 'shiftKey'>
): 'zoom' | 'pan' | 'pending' {
	if (sample.ctrlKey) return 'zoom';
	if (sample.shiftKey) return 'pan';
	const x = Math.abs(sample.deltaX);
	const y = Math.abs(sample.deltaY);
	if (x <= WHEEL_AXIS_DEAD_ZONE && y <= WHEEL_AXIS_DEAD_ZONE) return 'pending';
	if (x > WHEEL_AXIS_DEAD_ZONE && x >= y * WHEEL_DECISIVENESS_RATIO) return 'pan';
	if (y > WHEEL_AXIS_DEAD_ZONE && y >= x * WHEEL_DECISIVENESS_RATIO) return 'zoom';
	return 'pending';
}

function horizontalPanDelta(deltaX: number, deltaY: number, shiftKey: boolean): number {
	if (!shiftKey) return deltaX;
	const x = Math.abs(deltaX);
	const y = Math.abs(deltaY);
	if (x <= WHEEL_AXIS_DEAD_ZONE) return y > WHEEL_AXIS_DEAD_ZONE ? deltaY : 0;
	if (y > WHEEL_AXIS_DEAD_ZONE && y >= x * WHEEL_DECISIVENESS_RATIO) return deltaY;
	return deltaX;
}

/**
 * The map's single camera/input owner. It accepts already-small numeric event samples so it
 * remains usable from Svelte, tests, or another host without depending on DOM event classes.
 */
export class NavigationController {
	private camera: OrbitState;
	private viewport: Viewport;
	private readonly callbacks: NavigationCallbacks;
	private readonly scheduler: NavigationScheduler;
	private readonly now: () => number;
	private readonly lineHeight: number;

	private pendingCamera: OrbitState | null = null;
	private pendingKind: CameraCommitKind | null = null;
	private frameId: number | null = null;
	private disposed = false;
	private phase: NavigationPhase = 'idle';

	private flight: Flight | null = null;
	private activePointers = new Map<number, ActivePointer>();
	private pointerSession: PointerSession | null = null;
	private touchGesture: TouchGesture | null = null;
	private touchHadTransform = false;
	private wheelSession: WheelSession | null = null;
	private wheelTimer: unknown = null;
	private keyboardPanTimer: unknown = null;
	private keyboardOrbitTimer: unknown = null;
	private contextMenuSuppressed = false;
	private contextMenuTimer: unknown = null;
	private pendingSettled = false;
	private recoveryRequested = false;
	private renderRequested = false;
	private renderRequestKind: CameraCommitKind | null = null;
	private pendingTap: { point: ScreenPoint; pointerType: NavigationPointerType } | null = null;
	private tapAfterPaint = false;

	constructor(
		initialCamera: OrbitState,
		callbacks: NavigationCallbacks,
		options: NavigationOptions = {}
	) {
		this.camera = cloneCamera(initialCamera);
		this.viewport = options.viewport ?? { width: 0, height: 0 };
		this.callbacks = callbacks;
		this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
		this.now =
			options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
		this.lineHeight = options.lineHeight ?? WHEEL_LINE_HEIGHT;
	}

	get currentCamera(): OrbitState {
		return this.pendingCamera ?? this.camera;
	}

	get currentPhase(): NavigationPhase {
		return this.phase;
	}

	get isMoving(): boolean {
		return (
			this.phase !== 'idle' ||
			this.flight !== null ||
			this.pendingCamera !== null ||
			this.keyboardPanTimer !== null ||
			this.keyboardOrbitTimer !== null ||
			this.pendingSettled ||
			this.recoveryRequested
		);
	}

	setViewport(viewport: Viewport): void {
		this.viewport = viewport;
	}

	/** Coalesce an idle data or resize repaint onto the same frame clock as camera input. */
	requestRender(kind: CameraCommitKind = 'data'): void {
		if (this.disposed) return;
		this.renderRequested = true;
		this.renderRequestKind = this.mergeKind(this.renderRequestKind, kind);
		this.scheduleFrame();
	}

	replaceCamera(camera: OrbitState): void {
		this.cancelFlight();
		this.pendingCamera = null;
		this.pendingKind = null;
		this.pendingSettled = false;
		this.recoveryRequested = false;
		this.pendingTap = null;
		this.tapAfterPaint = false;
		this.camera = cloneCamera(camera);
		this.callbacks.onCommit(this.camera, 'data');
		this.renderRequested = false;
		this.renderRequestKind = null;
		this.callbacks.onRender?.(this.camera, 'data', false);
	}

	private setPhase(phase: NavigationPhase): void {
		if (this.phase === phase) return;
		this.phase = phase;
		this.callbacks.onPhaseChange?.(phase);
	}

	private scheduleFrame(): void {
		if (this.disposed || this.frameId !== null) return;
		this.frameId = this.scheduler.requestFrame((time) => this.flushFrame(time));
	}

	private mergeKind(current: CameraCommitKind | null, next: CameraCommitKind): CameraCommitKind {
		if (!current || current === next) return next;
		if (current === 'data' || next === 'data') return 'data';
		if (current === 'canonical' || next === 'canonical') return 'canonical';
		if (current === 'orbit' || next === 'orbit') return 'orbit';
		if (current === 'zoom' || next === 'zoom') return 'zoom';
		return 'pan';
	}

	private queueCamera(camera: OrbitState, kind: CameraCommitKind, schedule = true): void {
		this.pendingCamera = cloneCamera(camera);
		this.pendingKind = this.mergeKind(this.pendingKind, kind);
		if (schedule) this.scheduleFrame();
	}

	private flushFrame(time: number): void {
		this.frameId = null;
		if (this.disposed) return;

		if (this.flight) {
			const flight = this.flight;
			const progress =
				flight.duration === 0
					? 1
					: Math.min(1, Math.max(0, (time - flight.start) / flight.duration));
			const next = flight.anchor
				? interpolateAtScreenPoint(flight.from, flight.to, progress, this.viewport, flight.anchor)
				: interpolate(flight.from, flight.to, progress);
			if (progress >= 1) {
				this.flight = null;
				this.camera = cloneCamera(flight.to);
				this.callbacks.onCommit(this.camera, 'canonical');
				this.renderRequested = false;
				this.renderRequestKind = null;
				this.callbacks.onRender?.(this.camera, 'canonical', false);
				this.setPhase('idle');
				this.callbacks.onSettled?.();
			} else {
				this.camera = cloneCamera(next);
				this.callbacks.onCommit(this.camera, 'flight');
				this.renderRequested = false;
				this.renderRequestKind = null;
				this.callbacks.onRender?.(this.camera, 'flight', true);
				this.scheduleFrame();
			}
			return;
		}

		this.flushWheelInput();

		let committed = false;
		if (this.pendingCamera && this.pendingKind) {
			this.camera = this.pendingCamera;
			const kind = this.pendingKind;
			this.pendingCamera = null;
			this.pendingKind = null;
			this.callbacks.onCommit(this.camera, kind);
			this.renderRequested = false;
			this.renderRequestKind = null;
			this.callbacks.onRender?.(this.camera, kind, this.isMoving);
			committed = true;
		}
		const endedWheel = this.wheelSession;
		if (endedWheel?.ended && endedWheel.zoomDelta === 0 && endedWheel.panDelta === 0) {
			if (endedWheel.kind === null) {
				const fallbackKind =
					endedWheel.classificationX > endedWheel.classificationY ? 'pan' : 'zoom';
				if (
					Math.max(endedWheel.classificationX, endedWheel.classificationY) > WHEEL_AXIS_DEAD_ZONE
				) {
					endedWheel.kind = fallbackKind;
					if (fallbackKind === 'zoom') endedWheel.zoomDelta += endedWheel.pendingZoomDelta;
					else endedWheel.panDelta += endedWheel.pendingPanDelta;
					endedWheel.pendingZoomDelta = 0;
					endedWheel.pendingPanDelta = 0;
					this.setPhase(fallbackKind === 'zoom' ? 'wheel-zoom' : 'horizontal-wheel-pan');
					this.flushWheelInput();
					this.scheduleFrame();
				} else {
					this.wheelSession = null;
					this.setPhase('idle');
				}
			} else {
				this.wheelSession = null;
				this.endGesture('wheel', false);
			}
		}

		let recoveryStarted = false;
		if (this.recoveryRequested) {
			this.recoveryRequested = false;
			const recovery = this.callbacks.recover?.(this.workingCamera());
			if (recovery) {
				this.startFlight(recovery, null, 'recovery', false);
				recoveryStarted = true;
			}
		}
		if (!recoveryStarted && this.pendingSettled) {
			this.pendingSettled = false;
			this.callbacks.onSettled?.();
		}

		if (this.tapAfterPaint) {
			this.tapAfterPaint = false;
			const tap = this.pendingTap;
			this.pendingTap = null;
			if (tap) this.callbacks.onTap?.(tap.point, tap.pointerType);
		} else if (this.pendingTap) {
			const tap = this.pendingTap;
			this.pendingTap = null;
			if (committed) {
				this.pendingTap = tap;
				this.tapAfterPaint = true;
				this.scheduleFrame();
			} else {
				this.callbacks.onTap?.(tap.point, tap.pointerType);
			}
		}

		if (
			this.wheelSession &&
			(this.wheelSession.zoomDelta !== 0 || this.wheelSession.panDelta !== 0)
		) {
			this.scheduleFrame();
		}

		if (!committed && !recoveryStarted && this.renderRequested) {
			const kind = this.renderRequestKind ?? 'data';
			this.renderRequested = false;
			this.renderRequestKind = null;
			this.callbacks.onRender?.(this.camera, kind, this.isMoving);
		}
	}

	private cancelScheduledFrame(): void {
		if (this.frameId === null) return;
		this.scheduler.cancelFrame(this.frameId);
		this.frameId = null;
	}

	private cancelFlight(): void {
		if (!this.flight) return;
		this.flight = null;
		if (this.phase === 'camera-flight' || this.phase === 'lost-map-recovery') this.setPhase('idle');
	}

	private cancelWheelSession(): void {
		if (this.wheelTimer !== null) this.scheduler.clearTimeout(this.wheelTimer);
		this.wheelTimer = null;
		this.wheelSession = null;
		if (this.phase === 'wheel-zoom' || this.phase === 'horizontal-wheel-pan') this.setPhase('idle');
	}

	private settleWhenCommitted(): void {
		/* Settling is also a renderer operation; keep it on the shared frame clock even when
		 * the gesture produced no pending camera sample (for example, a stationary tap). */
		this.pendingSettled = true;
		this.scheduleFrame();
	}

	private cancelKeyboardTimers(): void {
		if (this.keyboardPanTimer !== null) this.scheduler.clearTimeout(this.keyboardPanTimer);
		if (this.keyboardOrbitTimer !== null) this.scheduler.clearTimeout(this.keyboardOrbitTimer);
		this.keyboardPanTimer = null;
		this.keyboardOrbitTimer = null;
	}

	private cancelRecovery(): void {
		this.recoveryRequested = false;
		this.pendingSettled = false;
	}

	cancelSemanticFlight(): void {
		this.cancelFlight();
		this.cancelKeyboardTimers();
		this.cancelRecovery();
	}

	private workingCamera(): OrbitState {
		return this.pendingCamera ?? this.camera;
	}

	private startFlight(
		target: OrbitState,
		anchor: ScreenPoint | null,
		source: Flight['source'],
		preserveExisting: boolean
	): void {
		const to = {
			...target,
			zoom: clampZoom(target.zoom),
			pitch: clampPitch(target.pitch)
		};
		const currentTime = this.now();
		const existingFlight = preserveExisting ? this.flight : null;
		const from = existingFlight
			? this.flightCameraAt(existingFlight, currentTime)
			: cloneCamera(this.workingCamera());
		const duration = flightDuration(from, to, this.viewport);
		if (this.callbacks.reducedMotion?.() || duration === 0) {
			this.flight = null;
			this.pendingCamera = null;
			this.pendingKind = null;
			this.pendingSettled = true;
			this.queueCamera(to, 'canonical');
			this.setPhase('idle');
			return;
		}

		this.pendingSettled = false;
		if (existingFlight && existingFlight.anchor !== null) {
			this.flight = {
				from,
				to,
				start: currentTime,
				duration,
				anchor: anchor ?? existingFlight.anchor,
				source
			};
		} else {
			this.pendingCamera = null;
			this.pendingKind = null;
			this.flight = {
				from,
				to,
				start: currentTime,
				duration,
				anchor,
				source
			};
		}
		this.setPhase(source === 'recovery' ? 'lost-map-recovery' : 'camera-flight');
		this.scheduleFrame();
	}

	private flightCameraAt(flight: Flight, time: number): OrbitState {
		const progress =
			flight.duration === 0 ? 1 : Math.min(1, Math.max(0, (time - flight.start) / flight.duration));
		return flight.anchor
			? interpolateAtScreenPoint(flight.from, flight.to, progress, this.viewport, flight.anchor)
			: interpolate(flight.from, flight.to, progress);
	}

	flyTo(target: OrbitState): void {
		this.pendingTap = null;
		this.tapAfterPaint = false;
		this.cancelRecovery();
		this.cancelWheelSession();
		this.cancelKeyboardTimers();
		this.cancelPointerSessions();
		this.cancelFlight();
		this.startFlight(target, null, 'semantic', false);
	}

	zoomBy(factor: number, persistent = false, accumulateDiscrete = false): void {
		this.pendingTap = null;
		this.tapAfterPaint = false;
		this.cancelRecovery();
		this.cancelWheelSession();
		this.cancelKeyboardTimers();
		this.cancelPointerSessions();
		const activeDiscreteFlight = this.flight !== null && this.flight.anchor !== null;
		const preserveExisting = (persistent || accumulateDiscrete) && activeDiscreteFlight;
		if (!preserveExisting) this.cancelFlight();
		const base = preserveExisting && this.flight ? this.flight.to : this.workingCamera();
		const anchor = { x: this.viewport.width / 2, y: this.viewport.height / 2 };
		const target = zoomAtScreenPoint(base, this.viewport, anchor, base.zoom * factor);
		if (target.zoom === base.zoom) return;
		this.startFlight(
			target,
			anchor,
			accumulateDiscrete ? 'semantic' : 'keyboard-zoom',
			preserveExisting
		);
	}

	resetTo(target: OrbitState): void {
		this.pendingTap = null;
		this.tapAfterPaint = false;
		this.cancelRecovery();
		this.cancelWheelSession();
		this.cancelKeyboardTimers();
		this.cancelPointerSessions();
		this.cancelFlight();
		this.startFlight(target, null, 'semantic', false);
	}

	private queueOrbitOrPan(camera: OrbitState, kind: 'orbit' | 'pan'): void {
		this.cancelFlight();
		this.queueCamera(camera, kind);
	}

	private setContextMenuSuppression(): void {
		this.contextMenuSuppressed = true;
		if (this.contextMenuTimer !== null) {
			this.scheduler.clearTimeout(this.contextMenuTimer);
			this.contextMenuTimer = null;
		}
	}

	private armContextMenuFailsafe(): void {
		if (!this.contextMenuSuppressed) return;
		if (this.contextMenuTimer !== null) this.scheduler.clearTimeout(this.contextMenuTimer);
		this.contextMenuTimer = this.scheduler.setTimeout(() => {
			this.contextMenuSuppressed = false;
			this.contextMenuTimer = null;
		}, 1000);
	}

	consumeContextMenuSuppression(): boolean {
		const suppressed = this.contextMenuSuppressed;
		this.clearContextMenuSuppression();
		return suppressed;
	}

	private clearContextMenuSuppression(): void {
		this.contextMenuSuppressed = false;
		if (this.contextMenuTimer !== null) this.scheduler.clearTimeout(this.contextMenuTimer);
		this.contextMenuTimer = null;
	}

	private beginTouchPointer(sample: PointerSample): void {
		this.activePointers.set(sample.id, { ...sample, lastX: sample.x, lastY: sample.y });
		if (this.activePointers.size === 1) {
			this.pointerSession = {
				id: sample.id,
				pointerType: 'touch',
				mode: 'orbit',
				button: 0,
				start: { x: sample.x, y: sample.y },
				base: cloneCamera(this.workingCamera()),
				threshold: TOUCH_TAP_THRESHOLD,
				moved: false,
				tapEligible: true,
				rightButton: false
			};
			this.touchGesture = null;
			this.touchHadTransform = false;
			this.setPhase('orbit-drag');
			return;
		}

		if (this.activePointers.size === 2) {
			const pointers = [...this.activePointers.values()];
			const first = pointers[0];
			const second = pointers[1];
			const firstPoint = { x: first.lastX, y: first.lastY };
			const secondPoint = { x: second.lastX, y: second.lastY };
			this.pointerSession = null;
			this.touchGesture = {
				ids: [first.id, second.id],
				base: cloneCamera(this.workingCamera()),
				startMidpoint: midpoint(firstPoint, secondPoint),
				startDistance: Math.max(distance(firstPoint, secondPoint), MIN_POINTER_DISTANCE)
			};
			this.touchHadTransform = true;
			this.setPhase('two-finger-transform');
		}
	}

	beginPointer(sample: PointerSample): boolean {
		if (this.disposed) return false;
		this.pendingTap = null;
		this.tapAfterPaint = false;
		this.cancelRecovery();
		this.cancelKeyboardTimers();
		const pointerType = normalisePointerType(sample.pointerType);
		const normalised = { ...sample, pointerType };
		this.cancelWheelSession();
		this.cancelFlight();
		if (pointerType === 'touch') {
			if (this.activePointers.size >= 2) return false;
			this.beginTouchPointer(normalised);
			return true;
		}

		if (this.pointerSession || this.activePointers.size > 0) return false;
		const isPanButton =
			sample.button === 1 || sample.button === 2 || (pointerType === 'pen' && sample.button > 0);
		const mode = isPanButton || Boolean(sample.shiftKey) ? 'pan' : 'orbit';
		const threshold = sample.button === 2 ? RIGHT_CLICK_THRESHOLD : MOUSE_CLICK_THRESHOLD;
		this.pointerSession = {
			id: sample.id,
			pointerType,
			mode,
			button: sample.button,
			start: { x: sample.x, y: sample.y },
			base: cloneCamera(this.workingCamera()),
			threshold,
			moved: false,
			tapEligible: sample.button === 0 && !sample.shiftKey,
			rightButton: sample.button === 2
		};
		this.activePointers.set(sample.id, { ...normalised, lastX: sample.x, lastY: sample.y });
		this.setPhase(mode === 'pan' ? 'pan-drag' : 'orbit-drag');
		return true;
	}

	private currentTouchPoints(): [ActivePointer, ActivePointer] | null {
		if (!this.touchGesture) return null;
		const first = this.activePointers.get(this.touchGesture.ids[0]);
		const second = this.activePointers.get(this.touchGesture.ids[1]);
		if (!first || !second) return null;
		return [first, second];
	}

	private queueTouchTransform(): void {
		const gesture = this.touchGesture;
		const points = this.currentTouchPoints();
		if (!gesture || !points) return;
		const [first, second] = points;
		const firstPoint = { x: first.lastX, y: first.lastY };
		const secondPoint = { x: second.lastX, y: second.lastY };
		const currentMidpoint = midpoint(firstPoint, secondPoint);
		const currentDistance = Math.max(distance(firstPoint, secondPoint), MIN_POINTER_DISTANCE);
		const zoomed = zoomAtScreenPoint(
			gesture.base,
			this.viewport,
			gesture.startMidpoint,
			gesture.base.zoom * (currentDistance / gesture.startDistance)
		);
		this.queueCamera(
			{
				...zoomed,
				panX: zoomed.panX + currentMidpoint.x - gesture.startMidpoint.x,
				panY: zoomed.panY + currentMidpoint.y - gesture.startMidpoint.y
			},
			'zoom'
		);
	}

	movePointer(sample: PointerSample): void {
		const active = this.activePointers.get(sample.id);
		if (!active) return;
		active.lastX = sample.x;
		active.lastY = sample.y;

		if (this.touchGesture) {
			this.queueTouchTransform();
			return;
		}

		const session = this.pointerSession;
		if (!session || session.id !== sample.id) return;
		const point = { x: sample.x, y: sample.y };
		const movedDistance = distance(point, session.start);
		if (movedDistance > session.threshold) {
			session.moved = true;
			session.tapEligible = false;
			if (session.rightButton) this.setContextMenuSuppression();
			const dx = sample.x - session.start.x;
			const dy = sample.y - session.start.y;
			if (session.mode === 'pan') {
				this.queueOrbitOrPan(
					{ ...session.base, panX: session.base.panX + dx, panY: session.base.panY + dy },
					'pan'
				);
			} else {
				this.queueOrbitOrPan(
					{
						...session.base,
						yaw: session.base.yaw + dx * 0.008,
						pitch: clampPitch(session.base.pitch + dy * 0.008)
					},
					'orbit'
				);
			}
		}
	}

	private endGesture(kind: 'pan' | 'wheel', schedule = true): void {
		void kind;
		this.setPhase('idle');
		this.pendingSettled = true;
		this.recoveryRequested = true;
		if (schedule) this.scheduleFrame();
	}

	private rebaseRemainingTouch(): void {
		const remaining = [...this.activePointers.values()][0];
		if (!remaining) {
			this.touchGesture = null;
			this.pointerSession = null;
			this.endGesture('pan');
			return;
		}
		this.touchGesture = null;
		this.pointerSession = {
			id: remaining.id,
			pointerType: 'touch',
			mode: 'orbit',
			button: 0,
			start: { x: remaining.lastX, y: remaining.lastY },
			base: cloneCamera(this.workingCamera()),
			threshold: TOUCH_TAP_THRESHOLD,
			moved: true,
			tapEligible: false,
			rightButton: false
		};
		this.setPhase('orbit-drag');
	}

	endPointer(sample: PointerSample, cancelled = false): void {
		const pointerType = normalisePointerType(sample.pointerType);
		this.activePointers.delete(sample.id);

		if (this.touchGesture) {
			if (this.activePointers.size === 0) {
				this.touchGesture = null;
				this.pointerSession = null;
				this.touchHadTransform = false;
				this.endGesture('pan');
				return;
			}
			this.rebaseRemainingTouch();
			return;
		}

		const session = this.pointerSession;
		if (!session || session.id !== sample.id) return;
		this.pointerSession = null;
		const rightPan = session.rightButton && session.moved;
		const hadTouchTransform = this.touchHadTransform;
		this.touchHadTransform = false;
		if (!cancelled && session.tapEligible && !session.moved) {
			this.setPhase('idle');
			this.pendingTap = { point: { x: sample.x, y: sample.y }, pointerType };
			this.scheduleFrame();
			this.settleWhenCommitted();
			return;
		}
		if ((session.mode === 'pan' && session.moved) || hadTouchTransform) {
			this.endGesture('pan');
		} else {
			this.setPhase('idle');
			this.settleWhenCommitted();
		}
		if (rightPan) {
			if (cancelled) this.clearContextMenuSuppression();
			else this.armContextMenuFailsafe();
		}
	}

	cancelPointer(pointerId: number, pointerType: NavigationPointerType = 'mouse'): void {
		const active = this.activePointers.get(pointerId);
		if (!active) return;
		this.endPointer(
			{
				id: pointerId,
				x: active.lastX,
				y: active.lastY,
				pointerType,
				button: active.button
			},
			true
		);
	}

	private finishWheelSession(): void {
		this.wheelTimer = null;
		const session = this.wheelSession;
		if (!session) return;
		session.ended = true;
		this.scheduleFrame();
	}

	private scheduleWheelEnd(): void {
		if (this.wheelTimer !== null) this.scheduler.clearTimeout(this.wheelTimer);
		this.wheelTimer = this.scheduler.setTimeout(
			() => this.finishWheelSession(),
			WHEEL_SESSION_GAP_MS
		);
	}

	handleWheel(sample: WheelSample): void {
		if (this.disposed) return;
		this.pendingTap = null;
		this.tapAfterPaint = false;
		this.cancelRecovery();
		this.cancelKeyboardTimers();
		this.cancelPointerSessions();
		this.cancelFlight();
		if (this.wheelSession?.ended) this.wheelSession = null;
		const time = sample.time ?? this.now();
		const deltaX = normalizeWheelDelta(
			sample.deltaX,
			sample.deltaMode,
			this.viewport,
			this.lineHeight
		);
		const deltaY = normalizeWheelDelta(
			sample.deltaY,
			sample.deltaMode,
			this.viewport,
			this.lineHeight
		);
		if (!this.wheelSession || time - this.wheelSession.lastAt > WHEEL_SESSION_GAP_MS) {
			this.wheelSession = {
				kind: null,
				lastAt: time,
				anchor: { x: sample.x, y: sample.y },
				zoomDelta: 0,
				panDelta: 0,
				classificationX: 0,
				classificationY: 0,
				pendingZoomDelta: 0,
				pendingPanDelta: 0,
				ended: false
			};
		} else {
			this.wheelSession.lastAt = time;
			this.wheelSession.anchor = { x: sample.x, y: sample.y };
		}

		const session = this.wheelSession;
		if (session.kind === null) {
			session.classificationX += Math.abs(deltaX);
			session.classificationY += Math.abs(deltaY);
			session.pendingZoomDelta += deltaY;
			session.pendingPanDelta += horizontalPanDelta(deltaX, deltaY, sample.shiftKey);
			const classified = classifyWheel({
				deltaX: session.classificationX,
				deltaY: session.classificationY,
				ctrlKey: sample.ctrlKey,
				shiftKey: sample.shiftKey
			});
			if (classified !== 'pending') {
				session.kind = classified;
				if (classified === 'zoom') session.zoomDelta += session.pendingZoomDelta;
				else session.panDelta += session.pendingPanDelta;
				session.pendingZoomDelta = 0;
				session.pendingPanDelta = 0;
			}
		} else if (session.kind === 'zoom') {
			session.zoomDelta += deltaY;
		} else {
			session.panDelta += horizontalPanDelta(deltaX, deltaY, sample.shiftKey);
		}
		if (session.kind) {
			this.setPhase(session.kind === 'zoom' ? 'wheel-zoom' : 'horizontal-wheel-pan');
		}
		this.scheduleWheelEnd();
		this.scheduleFrame();
	}

	private flushWheelInput(): void {
		const session = this.wheelSession;
		if (!session || !session.kind) return;
		if (session.kind === 'zoom') {
			const delta = Math.max(
				-MAX_WHEEL_ZOOM_DELTA_PER_FRAME,
				Math.min(MAX_WHEEL_ZOOM_DELTA_PER_FRAME, session.zoomDelta)
			);
			session.zoomDelta -= delta;
			if (delta !== 0) {
				const base = this.workingCamera();
				this.queueCamera(
					zoomAtScreenPoint(
						base,
						this.viewport,
						session.anchor,
						base.zoom * Math.exp(-delta * ZOOM_SENSITIVITY)
					),
					'zoom',
					false
				);
			}
		} else {
			const delta = Math.max(
				-MAX_WHEEL_PAN_DELTA_PER_FRAME,
				Math.min(MAX_WHEEL_PAN_DELTA_PER_FRAME, session.panDelta)
			);
			session.panDelta -= delta;
			if (delta !== 0) {
				const base = this.workingCamera();
				this.queueCamera({ ...base, panX: base.panX - delta }, 'pan', false);
			}
		}
	}

	private cancelPointerSessions(): void {
		this.activePointers.clear();
		this.pointerSession = null;
		this.touchGesture = null;
		this.touchHadTransform = false;
		this.clearContextMenuSuppression();
	}

	handleKey(key: string, shiftKey = false, repeat = false): boolean {
		if (this.disposed) return false;
		this.pendingTap = null;
		this.tapAfterPaint = false;
		this.cancelRecovery();
		this.cancelWheelSession();
		const orbitStep = 0.12;
		const panStep = 40;
		if (key === 'Escape') return true;

		if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
			this.cancelFlight();
			if (shiftKey) {
				if (this.keyboardOrbitTimer !== null) {
					this.scheduler.clearTimeout(this.keyboardOrbitTimer);
					this.keyboardOrbitTimer = null;
				}
			} else if (this.keyboardPanTimer !== null) {
				this.scheduler.clearTimeout(this.keyboardPanTimer);
				this.keyboardPanTimer = null;
			}
			const base = this.workingCamera();
			let next = base;
			if (key === 'ArrowLeft') {
				next = shiftKey
					? { ...base, panX: base.panX + panStep }
					: { ...base, yaw: base.yaw - orbitStep };
			} else if (key === 'ArrowRight') {
				next = shiftKey
					? { ...base, panX: base.panX - panStep }
					: { ...base, yaw: base.yaw + orbitStep };
			} else if (key === 'ArrowUp') {
				next = shiftKey
					? { ...base, panY: base.panY + panStep }
					: { ...base, pitch: clampPitch(base.pitch - orbitStep) };
			} else {
				next = shiftKey
					? { ...base, panY: base.panY - panStep }
					: { ...base, pitch: clampPitch(base.pitch + orbitStep) };
			}
			this.queueOrbitOrPan(next, shiftKey ? 'pan' : 'orbit');
			if (shiftKey) {
				if (this.keyboardPanTimer !== null) this.scheduler.clearTimeout(this.keyboardPanTimer);
				this.keyboardPanTimer = this.scheduler.setTimeout(() => {
					this.keyboardPanTimer = null;
					this.endGesture('pan');
				}, KEYBOARD_SESSION_GAP_MS);
			} else {
				if (this.keyboardOrbitTimer !== null) this.scheduler.clearTimeout(this.keyboardOrbitTimer);
				this.keyboardOrbitTimer = this.scheduler.setTimeout(() => {
					this.keyboardOrbitTimer = null;
					this.settleWhenCommitted();
				}, KEYBOARD_SESSION_GAP_MS);
			}
			return true;
		}

		if (key === '+' || key === '=' || key === '-' || key === '_') {
			const factor = key === '+' || key === '=' ? 1.5 : 1 / 1.5;
			this.zoomBy(factor, repeat);
			return true;
		}

		if (key === '0') {
			return false;
		}
		return false;
	}

	settleWheelForTests(): void {
		this.finishWheelSession();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.cancelScheduledFrame();
		this.cancelPointerSessions();
		this.cancelKeyboardTimers();
		this.cancelRecovery();
		this.flight = null;
		if (this.wheelTimer !== null) this.scheduler.clearTimeout(this.wheelTimer);
		if (this.contextMenuTimer !== null) this.scheduler.clearTimeout(this.contextMenuTimer);
		this.wheelTimer = null;
		this.contextMenuTimer = null;
		this.pendingTap = null;
		this.tapAfterPaint = false;
		this.renderRequested = false;
		this.renderRequestKind = null;
	}
}
