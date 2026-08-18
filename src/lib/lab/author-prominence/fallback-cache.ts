import type { ProjectionTransform } from './camera';

export type FallbackLayerMode = 'none' | 'sample' | 'settled';

export interface FallbackLayerIdentity<Population = unknown, Display = unknown> {
	transform: ProjectionTransform | null;
	population: Population | null;
	display: Display | null;
	mode: FallbackLayerMode;
}

function sameProjection(left: ProjectionTransform | null, right: ProjectionTransform): boolean {
	if (!left) return false;
	return (
		left.width === right.width &&
		left.height === right.height &&
		left.dpr === right.dpr &&
		left.domain === right.domain &&
		left.camera.azimuth === right.camera.azimuth &&
		left.camera.elevation === right.camera.elevation &&
		left.camera.zoom === right.camera.zoom &&
		left.camera.panX === right.camera.panX &&
		left.camera.panY === right.camera.panY
	);
}

export function matchesFallbackLayer<Population, Display>(
	cached: FallbackLayerIdentity<Population, Display>,
	next: FallbackLayerIdentity<Population, Display> & { transform: ProjectionTransform }
): boolean {
	return (
		cached.mode === next.mode &&
		cached.population === next.population &&
		cached.display === next.display &&
		sameProjection(cached.transform, next.transform)
	);
}
