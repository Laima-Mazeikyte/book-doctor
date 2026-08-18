import { cloneLens, lensState, type LensState } from './lens';
import { cloneRankingResult, type RankingResult } from './ranking-engine';
import type { ProminenceManifest } from './types';

export type GestureSource = 'triangle' | 'slider';
export type GestureStatus = 'active' | 'committed' | 'cancelled';

export interface LensGesture {
	id: number;
	source: GestureSource;
	startingLens: LensState;
	startingRanking: RankingResult | null;
	currentDraft: LensState;
	status: GestureStatus;
}

export function beginLensGesture(
	id: number,
	source: GestureSource,
	startingLens: LensState,
	startingRanking: RankingResult | null
): LensGesture {
	return {
		id,
		source,
		startingLens: cloneLens(startingLens),
		startingRanking: startingRanking ? cloneRankingResult(startingRanking) : null,
		currentDraft: cloneLens(startingLens),
		status: 'active'
	};
}

export function updateLensGesture(
	gesture: LensGesture,
	manifest: ProminenceManifest,
	weights: number[],
	preferredIndex?: number
): LensGesture {
	if (gesture.status !== 'active') return gesture;
	return {
		...gesture,
		currentDraft: lensState(manifest, weights, {
			presets: manifest.presets,
			preferredIndex,
			comparisonBaselineName: gesture.startingRanking?.lens.displayName ?? null,
			settled: false
		})
	};
}

export function commitLensGesture(
	gesture: LensGesture,
	manifest: ProminenceManifest
): { gesture: LensGesture; lens: LensState } {
	if (gesture.status !== 'active') return { gesture, lens: cloneLens(gesture.currentDraft) };
	const lens = lensState(manifest, gesture.currentDraft.weights, {
		presets: manifest.presets,
		comparisonBaselineName: gesture.startingRanking?.lens.displayName ?? null,
		settled: true
	});
	return { gesture: { ...gesture, currentDraft: cloneLens(lens), status: 'committed' }, lens };
}

export function cancelLensGesture(gesture: LensGesture): { gesture: LensGesture; lens: LensState } {
	return {
		gesture: { ...gesture, currentDraft: cloneLens(gesture.startingLens), status: 'cancelled' },
		lens: cloneLens(gesture.startingLens)
	};
}
