/**
 * Orbit camera for the 3D Lab map.
 *
 * One transform drives both the canvas backdrop and the SVG foreground, so the two can
 * never drift apart. World units are the artifact's own PaCMAP coordinates; screen units
 * are CSS pixels within the viewport element.
 *
 * Coordinates are normalised against a centre and radius before rotation, so the camera
 * behaves the same whatever absolute scale the embedding happens to have come out at —
 * PaCMAP output carries no fixed units. The centre is a per-axis median and the radius a
 * high quantile of the distance to it, which keeps a handful of far-flung outliers from
 * shrinking the whole cloud into the middle of the viewport.
 *
 * The projection is deliberately hand-rolled and perspective-correct only in the weak sense
 * the artifact itself claims: nearby is meaningful, while axes and far-away projected
 * distance are approximate. Reading precise geometry off this projection is not supported by
 * the data, so nothing here tries to make that possible.
 */

export interface Viewport {
	width: number;
	height: number;
}

export interface ScreenPoint {
	x: number;
	y: number;
}

export interface ScreenRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface OrbitState {
	/** Rotation about the vertical axis, radians. */
	yaw: number;
	/** Rotation above/below the horizon, radians, clamped to just under a pole. */
	pitch: number;
	/** Multiplier on the fitted scale. */
	zoom: number;
	/** Screen-space offset in CSS pixels. */
	panX: number;
	panY: number;
	centre: [number, number, number];
	/** World distance that maps to the fitted screen radius. */
	radius: number;
}

export interface Point3D {
	x: number;
	y: number;
	z: number;
}

export interface Projected {
	x: number;
	y: number;
	/** Rotated depth, larger is nearer the camera. Used for sorting and depth cues. */
	depth: number;
	/** Perspective multiplier at this depth; scales point size. */
	perspective: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 12;
export const MAX_PITCH = 1.5;

/** Camera distance in normalised units. Shallow enough to read as depth, not a fisheye. */
const CAMERA_DISTANCE = 3.4;
const NEAR_CLAMP = 0.7;
/** Fraction of the smaller viewport dimension the fitted radius occupies. */
const FIT_FRACTION = 0.43;

export const DEFAULT_YAW = -0.65;

/**
 * Opening pitch: a quarter turn below the old eye-level view, which is what dragging the
 * map down by 90° gets you.
 *
 * The cloud is a rough ball, so a level view reads as a flat disc and gives no sense that
 * it has depth at all. Coming in from above puts the communities at visibly different
 * depths on the first frame, which is the whole point of a 3D layout.
 */
export const DEFAULT_PITCH = -0.35 + Math.PI / 2;

export function clampZoom(zoom: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function clampPitch(pitch: number): number {
	return Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch));
}

/**
 * Change zoom while keeping the projected location under `anchor` fixed.
 *
 * The projection's world-dependent part is multiplied by zoom around the camera origin, so
 * the required pan correction is affine even though the projection itself has a weak
 * perspective term. Clamping happens before the ratio is derived; at either limit this returns
 * the original state without moving the camera under the cursor.
 */
export function zoomAtScreenPoint(
	state: OrbitState,
	viewport: Viewport,
	anchor: ScreenPoint,
	requestedZoom: number
): OrbitState {
	const zoom = clampZoom(requestedZoom);
	if (zoom === state.zoom) return state;
	const ratio = zoom / state.zoom;
	const originX = viewport.width / 2 + state.panX;
	const originY = viewport.height / 2 + state.panY;
	return {
		...state,
		zoom,
		panX: state.panX + (1 - ratio) * (anchor.x - originX),
		panY: state.panY + (1 - ratio) * (anchor.y - originY)
	};
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const n = sorted.length;
	return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function quantile(values: number[], q: number): number {
	if (values.length === 0) return 1;
	const sorted = [...values].sort((a, b) => a - b);
	const at = Math.floor((sorted.length - 1) * q);
	return sorted[Math.min(sorted.length - 1, Math.max(0, at))];
}

/**
 * Centre and radius that frame `points`, leaving yaw, pitch and zoom untouched.
 *
 * The 98th percentile of the distance to the median is the framing radius: with a dense
 * cloud plus a thin tail, using the maximum would waste most of the viewport on empty space.
 */
export function fitPoints(
	points: Point3D[],
	minimumRadius = 1e-6
): Pick<OrbitState, 'centre' | 'radius'> {
	if (points.length === 0) return { centre: [0, 0, 0], radius: 1 };
	const centre: [number, number, number] = [
		median(points.map((p) => p.x)),
		median(points.map((p) => p.y)),
		median(points.map((p) => p.z))
	];
	const distances = points.map((p) =>
		Math.hypot(p.x - centre[0], p.y - centre[1], p.z - centre[2])
	);
	return { centre, radius: Math.max(quantile(distances, 0.98), minimumRadius, 1e-6) };
}

export function homeState(points: Point3D[]): OrbitState {
	return {
		yaw: DEFAULT_YAW,
		pitch: DEFAULT_PITCH,
		zoom: 1,
		panX: 0,
		panY: 0,
		...fitPoints(points)
	};
}

/**
 * Project a world point to screen pixels.
 *
 * Hot path — called for every mapped author on every frame — so the trigonometry is hoisted
 * into `projector()` for batch use and this single-point form is for one-off callers.
 */
export function project(state: OrbitState, viewport: Viewport, point: Point3D): Projected {
	return projector(state, viewport)(point);
}

/**
 * Build a projection closure with the per-frame trigonometry and scale precomputed.
 * The SVG foreground uses this for its small active set; the canvas uses `projectorInto`.
 */
export function projector(state: OrbitState, viewport: Viewport): (point: Point3D) => Projected {
	const { centre, radius } = state;
	const cosYaw = Math.cos(state.yaw);
	const sinYaw = Math.sin(state.yaw);
	const cosPitch = Math.cos(state.pitch);
	const sinPitch = Math.sin(state.pitch);
	const scale = Math.min(viewport.width, viewport.height) * FIT_FRACTION * state.zoom;
	const originX = viewport.width / 2 + state.panX;
	const originY = viewport.height / 2 + state.panY;

	return (point: Point3D): Projected => {
		const nx = (point.x - centre[0]) / radius;
		const ny = (point.y - centre[1]) / radius;
		const nz = (point.z - centre[2]) / radius;

		// Yaw about the vertical axis, then pitch about the resulting horizontal axis.
		const yawX = cosYaw * nx + sinYaw * nz;
		const yawZ = -sinYaw * nx + cosYaw * nz;
		const pitchY = cosPitch * ny - sinPitch * yawZ;
		const depth = sinPitch * ny + cosPitch * yawZ;

		// Clamping the denominator stops points at or behind the camera from inverting; the
		// cloud radius is well inside CAMERA_DISTANCE so this only ever bites on outliers.
		const perspective = CAMERA_DISTANCE / Math.max(NEAR_CLAMP, CAMERA_DISTANCE - depth);

		return {
			x: originX + yawX * scale * perspective,
			y: originY - pitchY * scale * perspective,
			depth,
			perspective
		};
	};
}

/**
 * Allocation-free version of `projector()` for the full point cloud.
 *
 * The object-returning projector is convenient for the small SVG foreground. The canvas path
 * calls this thousands of times per frame, so it writes into the existing typed arrays and
 * returns only the perspective multiplier needed to derive point size.
 */
export function projectorInto(
	state: OrbitState,
	viewport: Viewport,
	screenX: Float32Array,
	screenY: Float32Array,
	screenDepth: Float32Array
): (slot: number, x: number, y: number, z: number) => number {
	const { centre, radius } = state;
	const cosYaw = Math.cos(state.yaw);
	const sinYaw = Math.sin(state.yaw);
	const cosPitch = Math.cos(state.pitch);
	const sinPitch = Math.sin(state.pitch);
	const scale = Math.min(viewport.width, viewport.height) * FIT_FRACTION * state.zoom;
	const originX = viewport.width / 2 + state.panX;
	const originY = viewport.height / 2 + state.panY;

	return (slot: number, x: number, y: number, z: number): number => {
		const nx = (x - centre[0]) / radius;
		const ny = (y - centre[1]) / radius;
		const nz = (z - centre[2]) / radius;
		const yawX = cosYaw * nx + sinYaw * nz;
		const yawZ = -sinYaw * nx + cosYaw * nz;
		const pitchY = cosPitch * ny - sinPitch * yawZ;
		const depth = sinPitch * ny + cosPitch * yawZ;
		const perspective = CAMERA_DISTANCE / Math.max(NEAR_CLAMP, CAMERA_DISTANCE - depth);

		screenX[slot] = originX + yawX * scale * perspective;
		screenY[slot] = originY - pitchY * scale * perspective;
		screenDepth[slot] = depth;
		return perspective;
	};
}

const MIN_FLIGHT_MS = 250;
const MAX_FLIGHT_MS = 750;
const SNAP_PIXELS = 8;
const SNAP_SCALE_CHANGE = Math.log(1.03);
const FULL_TRAVEL_PIXELS = 600;
const FULL_SCALE_CHANGE = Math.log(16);

/**
 * Camera duration based on how much the projected view changes.
 *
 * Tiny corrections cut directly to their target, ordinary neighborhood changes take roughly
 * half a second, and only a large pan/orbit or a sixteen-fold scale change receives the old
 * 750 ms maximum.
 */
export function flightDuration(from: OrbitState, to: OrbitState, viewport: Viewport): number {
	const viewportScale = Math.min(viewport.width, viewport.height) * FIT_FRACTION;
	const referenceRadius = Math.max(from.radius, to.radius, 1e-6);
	const centrePixels =
		(Math.hypot(
			to.centre[0] - from.centre[0],
			to.centre[1] - from.centre[1],
			to.centre[2] - from.centre[2]
		) /
			referenceRadius) *
		viewportScale;
	const panPixels = Math.hypot(to.panX - from.panX, to.panY - from.panY);
	let yawDelta = (to.yaw - from.yaw) % (Math.PI * 2);
	if (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
	if (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
	const orbitPixels = Math.hypot(yawDelta, to.pitch - from.pitch) * Math.max(viewportScale, 1);
	const spatialPixels = Math.max(centrePixels, panPixels, orbitPixels);
	const fromScale = from.zoom / from.radius;
	const toScale = to.zoom / to.radius;
	const scaleChange = Math.abs(Math.log(toScale / fromScale));

	if (spatialPixels < SNAP_PIXELS && scaleChange < SNAP_SCALE_CHANGE) return 0;

	const travel = Math.min(
		1,
		Math.max(spatialPixels / FULL_TRAVEL_PIXELS, scaleChange / FULL_SCALE_CHANGE)
	);
	return MIN_FLIGHT_MS + (MAX_FLIGHT_MS - MIN_FLIGHT_MS) * travel;
}

function cubicOut(t: number): number {
	const f = t - 1;
	return f * f * f + 1;
}

/**
 * Eased camera flight. Zoom interpolates geometrically so it feels linear, which a naive
 * linear interpolation does not — it lurches at the wide end. Yaw takes the short way round.
 */
export function interpolate(from: OrbitState, to: OrbitState, t: number): OrbitState {
	const eased = cubicOut(Math.min(1, Math.max(0, t)));
	const lerp = (a: number, b: number) => a + (b - a) * eased;
	/*
	 * Interpolate the inverse radius and centre/radius together. Interpolating the centre
	 * linearly while shrinking the radius geometrically makes the two parts of the camera
	 * disagree: during a tight refit, the old centre can be divided by almost the final tiny
	 * radius and throw the target millions of pixels off screen. This form makes every point's
	 * normalised coordinate interpolate linearly between its two endpoint coordinates.
	 */
	const inverseRadius = lerp(1 / from.radius, 1 / to.radius);
	const radius = 1 / inverseRadius;
	const centre = from.centre.map(
		(value, axis) => radius * lerp(value / from.radius, to.centre[axis] / to.radius)
	) as OrbitState['centre'];

	let yawDelta = (to.yaw - from.yaw) % (Math.PI * 2);
	if (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
	if (yawDelta < -Math.PI) yawDelta += Math.PI * 2;

	return {
		yaw: from.yaw + yawDelta * eased,
		pitch: lerp(from.pitch, to.pitch),
		zoom: from.zoom * Math.pow(to.zoom / from.zoom, eased),
		panX: lerp(from.panX, to.panX),
		panY: lerp(from.panY, to.panY),
		centre,
		radius
	};
}

/**
 * Interpolate a zoom-only flight while preserving a screen-space anchor on every frame.
 * Button and keyboard zooms use this instead of ordinary pan interpolation: geometric zoom
 * easing and linear pan easing do not describe the same anchored world point between endpoints.
 */
export function interpolateAtScreenPoint(
	from: OrbitState,
	to: OrbitState,
	t: number,
	viewport: Viewport,
	anchor: ScreenPoint
): OrbitState {
	const current = interpolate(from, to, t);
	const anchored = zoomAtScreenPoint(
		{ ...from, panX: from.panX, panY: from.panY },
		viewport,
		anchor,
		current.zoom
	);
	return { ...current, panX: anchored.panX, panY: anchored.panY };
}

export interface ProjectedBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/** Calculate the actual two-dimensional projected bounds of a set of points. */
export function projectedBounds(
	state: OrbitState,
	viewport: Viewport,
	points: Point3D[]
): ProjectedBounds | null {
	if (points.length === 0) return null;
	const project = projector(state, viewport);
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const point of points) {
		const projected = project(point);
		if (projected.x < minX) minX = projected.x;
		if (projected.y < minY) minY = projected.y;
		if (projected.x > maxX) maxX = projected.x;
		if (projected.y > maxY) maxY = projected.y;
	}
	return { minX, minY, maxX, maxY };
}

export interface ProjectedFitOptions {
	minimumRadius?: number;
	padding?: number;
	paddingX?: number;
	paddingY?: number;
	maxZoom?: number;
}

/**
 * Fit points by their real projected rectangle, preserving the camera's yaw and pitch.
 *
 * The initial projection is made at neutral zoom and zero pan. Since zoom scales that whole
 * projection around the viewport origin, the rectangle can then be fitted into an arbitrary
 * safe rectangle, such as one that leaves room for the desktop legend and controls.
 */
export function fitProjectedPoints(
	points: Point3D[],
	state: OrbitState,
	viewport: Viewport,
	safeRect: ScreenRect,
	options: ProjectedFitOptions = {}
): OrbitState {
	if (points.length === 0) return state;
	const {
		minimumRadius = 1e-6,
		padding = 0,
		paddingX = padding,
		paddingY = padding,
		maxZoom = MAX_ZOOM
	} = options;
	const fit = fitPoints(points, minimumRadius);
	const neutral: OrbitState = {
		...state,
		zoom: 1,
		panX: 0,
		panY: 0,
		...fit
	};
	const bounds = projectedBounds(neutral, viewport, points);
	if (!bounds) return neutral;

	const availableWidth = Math.max(1, safeRect.right - safeRect.left - paddingX * 2);
	const availableHeight = Math.max(1, safeRect.bottom - safeRect.top - paddingY * 2);
	const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
	const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
	const fittedZoom = Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight);
	const cappedMaxZoom = clampZoom(maxZoom);
	const zoom =
		points.length === 1
			? Math.min(clampZoom(state.zoom), cappedMaxZoom)
			: Math.min(cappedMaxZoom, Math.max(MIN_ZOOM, fittedZoom));
	const boundsCenterX = (bounds.minX + bounds.maxX) / 2;
	const boundsCenterY = (bounds.minY + bounds.maxY) / 2;
	const safeCenterX = (safeRect.left + safeRect.right) / 2;
	const safeCenterY = (safeRect.top + safeRect.bottom) / 2;
	const neutralOriginX = viewport.width / 2;
	const neutralOriginY = viewport.height / 2;

	return {
		...neutral,
		zoom,
		panX: safeCenterX - (neutralOriginX + (boundsCenterX - neutralOriginX) * zoom),
		panY: safeCenterY - (neutralOriginY + (boundsCenterY - neutralOriginY) * zoom)
	};
}

/** Diagonal of the axis-aligned box around `points`, for scale-free distance thresholds. */
export function diagonalOf(points: Point3D[]): number {
	if (points.length === 0) return 1;
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	let minZ = Infinity;
	let maxZ = -Infinity;
	for (const p of points) {
		if (p.x < minX) minX = p.x;
		if (p.x > maxX) maxX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.y > maxY) maxY = p.y;
		if (p.z < minZ) minZ = p.z;
		if (p.z > maxZ) maxZ = p.z;
	}
	return Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
}
