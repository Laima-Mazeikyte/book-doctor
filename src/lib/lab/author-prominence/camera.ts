export interface CameraState {
	azimuth: number;
	elevation: number;
	zoom: number;
	panX: number;
	panY: number;
}

/** The single screen-space contract used by CPU overlays, picking and WebGL. */
export interface ProjectionFrame {
	/** CSS pixel width of the field. */
	width: number;
	/** CSS pixel height of the field. */
	height: number;
	/** Device pixel ratio used only at the final GPU clip-space boundary. */
	dpr: number;
	/** One symmetric world domain shared by all three axes. */
	domain: number;
}

export interface ProjectionTransform extends ProjectionFrame {
	camera: CameraState;
	cosAzimuth: number;
	sinAzimuth: number;
	cosElevation: number;
	sinElevation: number;
	baseScale: number;
	perspectiveFactor: number;
}

export interface ProjectedPoint {
	/** CSS-pixel coordinates, top-left origin. */
	x: number;
	y: number;
	/** Normalized camera depth; smaller values are closer to the viewer. */
	depth: number;
	/** CSS-pixel scale at this depth. */
	scale: number;
}

export interface ClipPoint {
	x: number;
	y: number;
	z: number;
}

const MIN_DOMAIN = 0.001;
const PERSPECTIVE_FACTOR = 0.18;

/** Build the camera transform once per frame. No caller should recompute its trigonometry. */
export function buildProjection(camera: CameraState, frame: ProjectionFrame): ProjectionTransform {
	const domain = Math.max(frame.domain, MIN_DOMAIN);
	const dpr = Math.max(1, Number.isFinite(frame.dpr) ? frame.dpr : 1);
	return {
		...frame,
		dpr,
		domain,
		camera: { ...camera },
		cosAzimuth: Math.cos(camera.azimuth),
		sinAzimuth: Math.sin(camera.azimuth),
		cosElevation: Math.cos(camera.elevation),
		sinElevation: Math.sin(camera.elevation),
		baseScale: Math.min(frame.width, frame.height) * 0.328 * camera.zoom,
		perspectiveFactor: PERSPECTIVE_FACTOR
	};
}

/** CPU projection in CSS pixels. This is the reference contract for labels and picking. */
export function projectPointWithTransform(
	x: number,
	y: number,
	tz: number,
	transform: ProjectionTransform,
	out?: ProjectedPoint
): ProjectedPoint {
	const px = x / transform.domain;
	const py = y / transform.domain;
	const pz = tz / transform.domain;
	const horizontal = transform.cosAzimuth * px - transform.sinAzimuth * py;
	const depthPlane = transform.sinAzimuth * px + transform.cosAzimuth * py;
	const vertical = transform.cosElevation * pz - transform.sinElevation * depthPlane;
	const depth = transform.cosElevation * depthPlane + transform.sinElevation * pz;
	const perspective = 1 / (1 + depth * transform.perspectiveFactor);
	const scale = transform.baseScale * perspective;
	const point = out ?? { x: 0, y: 0, depth: 0, scale: 0 };
	point.x = transform.width / 2 + transform.camera.panX + horizontal * scale;
	point.y = transform.height / 2 + transform.camera.panY - vertical * scale;
	point.depth = depth;
	point.scale = scale;
	return point;
}

/** The exact final conversion used by the WebGL vertex shader. */
export function projectClipPoint(
	x: number,
	y: number,
	tz: number,
	transform: ProjectionTransform
): ClipPoint {
	const point = projectPointWithTransform(x, y, tz, transform);
	const deviceWidth = transform.width * transform.dpr;
	const deviceHeight = transform.height * transform.dpr;
	const deviceX = point.x * transform.dpr;
	const deviceY = point.y * transform.dpr;
	return {
		x: (deviceX / deviceWidth) * 2 - 1,
		// WebGL's origin is bottom-left; the public contract remains top-left CSS pixels.
		y: 1 - (deviceY / deviceHeight) * 2,
		z: point.depth * 0.08
	};
}

/** Convert a clip-space point back to the public CSS-pixel contract for parity tests. */
export function clipToCssPoint(clip: ClipPoint, transform: ProjectionTransform): ProjectedPoint {
	const x = ((clip.x + 1) / 2) * transform.width;
	const y = ((1 - clip.y) / 2) * transform.height;
	const depth = clip.z / 0.08;
	return {
		x,
		y,
		depth,
		scale: transform.baseScale / (1 + depth * transform.perspectiveFactor)
	};
}

/** Compatibility wrapper for callers that have not yet built a frame explicitly. */
export function projectPoint(
	x: number,
	y: number,
	tz: number,
	camera: CameraState,
	width: number,
	height: number,
	domain = 1,
	dpr = 1
): ProjectedPoint {
	return projectPointWithTransform(
		x,
		y,
		tz,
		buildProjection(camera, { width, height, domain, dpr })
	);
}

/** `weights` must already be in world axis order: regard, reach, recognition. */
export function cameraForLens(weights: ArrayLike<number>): CameraState {
	const x = weights[0] ?? 1 / 3;
	const y = weights[1] ?? 1 / 3;
	const z = weights[2] ?? 1 / 3;
	return {
		azimuth: Math.atan2(x, y),
		elevation: Math.atan2(z, Math.hypot(x, y)),
		zoom: 1.08,
		panX: 0,
		panY: 0
	};
}
