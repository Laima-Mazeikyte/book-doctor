import type { Preset, ProminenceManifest } from './types';

export type LensSource = 'preset' | 'custom';

export interface LensSnapshot {
	weights: number[];
	displayShares: number[];
	source: LensSource;
	presetId: string | null;
	displayName: string;
	manifestNote: string;
}

/** The one lens object shared by the mixer, scene, ranking, inspector, URL adapter and announcements. */
export interface LensState extends LensSnapshot {
	comparisonBaselineName: string | null;
	settled: boolean;
}

export interface LensOptions {
	presets: Preset[];
	preferredIndex?: number;
	comparisonBaselineName?: string | null;
	settled?: boolean;
	presetId?: string | null;
}

function clampShare(value: number): number {
	return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

/** Largest-remainder display rounding. The internal lens remains floating point. */
export function largestRemainderShares(weights: number[], preferredIndex?: number): number[] {
	if (weights.length === 0) return [];
	const safe = weights.map(clampShare);
	const total = safe.reduce((sum, value) => sum + value, 0);
	const normalised =
		total > 0 ? safe.map((value) => value / total) : safe.map(() => 1 / safe.length);
	const raw = normalised.map((value) => value * 100);
	const shares = raw.map(Math.floor);
	const remaining = 100 - shares.reduce((sum, value) => sum + value, 0);
	const dominant = normalised.reduce(
		(best, value, index) => (value > normalised[best] ? index : best),
		0
	);
	const order = normalised
		.map((value, index) => ({
			index,
			fraction: raw[index] - Math.floor(raw[index]),
			preferred: index === preferredIndex,
			dominant: index === dominant
		}))
		.sort(
			(a, b) =>
				b.fraction - a.fraction ||
				Number(b.preferred) - Number(a.preferred) ||
				Number(b.dominant) - Number(a.dominant) ||
				a.index - b.index
		);
	for (let i = 0; i < remaining; i++) shares[order[i % order.length].index] += 1;
	return shares;
}

export function sharesText(weights: number[], preferredIndex?: number): string {
	return largestRemainderShares(weights, preferredIndex).join(' / ');
}

/** Set one displayed percentage while preserving the previous ratio of the other two. */
export function changeOneShare(
	weights: number[],
	index: number,
	requestedPercent: number
): number[] {
	const next = weights.map(clampShare);
	if (next.length < 2 || index < 0 || index >= next.length) return next;
	const requested =
		Math.max(0, Math.min(100, Number.isFinite(requestedPercent) ? requestedPercent : 0)) / 100;
	const remainder = 1 - requested;
	const other = next.map((_, candidate) => candidate).filter((candidate) => candidate !== index);
	const oldTotal = other.reduce((sum, candidate) => sum + next[candidate], 0);
	next[index] = requested;
	if (oldTotal > 0) {
		for (const candidate of other) next[candidate] = (next[candidate] / oldTotal) * remainder;
	} else {
		for (const candidate of other) next[candidate] = remainder / other.length;
	}
	const last = other[other.length - 1];
	if (last !== undefined) next[last] += 1 - next.reduce((sum, value) => sum + value, 0);
	return next;
}

export function presetForWeights(
	weights: number[],
	presets: Preset[],
	tolerance = 0.000001
): Preset | null {
	return (
		presets.find(
			(preset) =>
				preset.weights.length === weights.length &&
				preset.weights.every((weight, index) => Math.abs(weight - weights[index]) <= tolerance)
		) ?? null
	);
}

export function cloneLens(lens: LensState): LensState {
	return {
		...lens,
		weights: lens.weights.slice(),
		displayShares: lens.displayShares.slice()
	};
}

export function lensState(
	manifest: ProminenceManifest,
	weights: number[],
	options: LensOptions
): LensState {
	const exact = weights.slice();
	const namedPreset = options.presetId
		? (options.presets.find((candidate) => candidate.name === options.presetId) ?? null)
		: null;
	const preset =
		namedPreset &&
		namedPreset.weights.length === exact.length &&
		namedPreset.weights.every((weight, index) => Math.abs(weight - exact[index]) <= 0.000001)
			? namedPreset
			: presetForWeights(exact, options.presets);
	const source = preset ? 'preset' : 'custom';
	return {
		weights: exact,
		displayShares: largestRemainderShares(exact, options.preferredIndex),
		source,
		presetId: preset?.name ?? null,
		displayName: preset?.name ?? 'Custom lens',
		manifestNote: preset?.note ?? '',
		comparisonBaselineName: options.comparisonBaselineName ?? null,
		settled: options.settled ?? true
	};
}

export function defaultLens(manifest: ProminenceManifest): LensState {
	const preset = manifest.presets.find((candidate) => candidate.settled) ?? manifest.presets[0];
	return lensState(manifest, preset.weights, {
		presets: manifest.presets,
		presetId: preset.name,
		settled: true
	});
}
