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
export function fitPoints(points: Point3D[]): Pick<OrbitState, 'centre' | 'radius'> {
	if (points.length === 0) return { centre: [0, 0, 0], radius: 1 };
	const centre: [number, number, number] = [
		median(points.map((p) => p.x)),
		median(points.map((p) => p.y)),
		median(points.map((p) => p.z))
	];
	const distances = points.map((p) =>
		Math.hypot(p.x - centre[0], p.y - centre[1], p.z - centre[2])
	);
	return { centre, radius: Math.max(quantile(distances, 0.98), 1e-6) };
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
 * Projecting 7,911 points calls this once instead of computing four transcendentals each.
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

	let yawDelta = (to.yaw - from.yaw) % (Math.PI * 2);
	if (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
	if (yawDelta < -Math.PI) yawDelta += Math.PI * 2;

	return {
		yaw: from.yaw + yawDelta * eased,
		pitch: lerp(from.pitch, to.pitch),
		zoom: from.zoom * Math.pow(to.zoom / from.zoom, eased),
		panX: lerp(from.panX, to.panX),
		panY: lerp(from.panY, to.panY),
		centre: [
			lerp(from.centre[0], to.centre[0]),
			lerp(from.centre[1], to.centre[1]),
			lerp(from.centre[2], to.centre[2])
		],
		radius: from.radius * Math.pow(to.radius / from.radius, eased)
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
