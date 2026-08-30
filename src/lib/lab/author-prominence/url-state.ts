import { defaultLens, lensState, LENS_WEIGHT_TOLERANCE, type LensState } from './lens';
import { PUBLIC_PRESET_NAME } from './contract';
import { isUsableLensWeights } from './simplex';
import type { Population, ProminenceManifest } from './types';

const WEIGHT_TOLERANCE = LENS_WEIGHT_TOLERANCE;
export { PUBLIC_PRESET_NAME } from './contract';

export interface ProminenceUrlState {
	lens: LensState;
	selectedIndex: number | null;
	/** True when an explicitly supplied lens parameter was rejected. */
	invalidLens?: boolean;
}

function validWeights(raw: number[] | undefined, featureCount: number): raw is number[] {
	if (!raw || raw.length !== featureCount || !raw.every(Number.isFinite)) return false;
	if (raw.some((value) => value < 0)) return false;
	return Math.abs(raw.reduce((sum, value) => sum + value, 0) - 1) <= WEIGHT_TOLERANCE;
}

function authorIndex(
	encoded: string | null,
	version: string,
	population: Population
): number | null {
	if (!encoded) return null;
	const separator = encoded.indexOf(':');
	if (separator < 1 || encoded.slice(0, separator) !== version) return null;
	const identity = encoded.slice(separator + 1);
	if (!identity) return null;
	if (population.authorIds) {
		const byId = population.authorIds.indexOf(identity);
		return byId >= 0 ? byId : null;
	}
	const byName = population.names.indexOf(identity);
	return byName >= 0 ? byName : null;
}

/** Parse from a clean tested-default state; malformed state never leaks into the page. */
export function parseProminenceUrl(
	search: string | URLSearchParams,
	manifest: ProminenceManifest,
	population: Population,
	sigmaZ?: number[][]
): ProminenceUrlState {
	const params = typeof search === 'string' ? new URLSearchParams(search) : search;
	const fallback = defaultLens(manifest);
	const named = params.get('lens');
	const encodedCustom = params.get('w');
	const custom = encodedCustom
		?.split(',')
		.map((value) => (value.trim() ? Number(value) : Number.NaN));
	let lens = fallback;
	let invalidLens = false;
	if (named !== null) {
		// A named preset wins intentionally when both parameters are present. Balanced is the
		// only public name; shipped non-settled profiles remain release data, not URL state.
		const preset = manifest.presets.find(
			(candidate) =>
				candidate.name === PUBLIC_PRESET_NAME && candidate.settled && named === PUBLIC_PRESET_NAME
		);
		if (preset) {
			lens = lensState(manifest, preset.weights, {
				presets: manifest.presets,
				presetId: preset.name,
				settled: true
			});
		} else {
			invalidLens = true;
		}
	} else if (encodedCustom !== null) {
		const valid =
			validWeights(custom, manifest.model.features.length) &&
			(!sigmaZ || isUsableLensWeights(custom, sigmaZ, manifest.model.features.length));
		if (valid) lens = lensState(manifest, custom, { presets: manifest.presets, settled: true });
		else invalidLens = true;
	}
	return {
		lens,
		selectedIndex: authorIndex(params.get('author'), manifest.version, population),
		invalidLens
	};
}

export function serializeProminenceUrl(
	currentHref: string,
	basePath: string,
	state: ProminenceUrlState,
	manifest: ProminenceManifest,
	population: Population
): string {
	const url = new URL(currentHref, 'http://author-prominence.local');
	url.pathname = basePath;
	url.searchParams.delete('lens');
	url.searchParams.delete('w');
	url.searchParams.delete('author');
	if (state.lens.presetId === PUBLIC_PRESET_NAME) url.searchParams.set('lens', PUBLIC_PRESET_NAME);
	else url.searchParams.set('w', state.lens.weights.map((value) => value.toFixed(12)).join(','));
	if (
		state.selectedIndex !== null &&
		state.selectedIndex >= 0 &&
		state.selectedIndex < population.count
	) {
		const identity =
			population.authorIds?.[state.selectedIndex] ?? population.names[state.selectedIndex];
		url.searchParams.set('author', `${manifest.version}:${identity}`);
	}
	return `${url.pathname}${url.search}${url.hash}`;
}

export function urlStateEqual(a: ProminenceUrlState, b: ProminenceUrlState): boolean {
	return (
		a.selectedIndex === b.selectedIndex &&
		a.lens.weights.length === b.lens.weights.length &&
		a.lens.weights.every((weight, index) => weight === b.lens.weights[index])
	);
}
