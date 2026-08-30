import { computeRanking, type RankingResult } from './ranking-engine';
import type { Population, Preset } from './types';

function workerTimingStart(): number {
	try {
		return (import.meta.env?.DEV || import.meta.env?.MODE === 'test') &&
			typeof performance !== 'undefined'
			? performance.now()
			: 0;
	} catch {
		return 0;
	}
}

function workerTimingEnd(start: number): void {
	if (!start || typeof performance === 'undefined' || typeof performance.measure !== 'function')
		return;
	try {
		performance.measure('author-prominence:worker-rank', { start, end: performance.now() });
	} catch {
		// User Timing is diagnostic only; a restricted worker must still rank.
	}
}

interface InitMessage {
	type: 'init';
	names: string[];
	authorIds: string[] | null;
	z: Float64Array[];
	sigmaZ: number[][];
	settledPreset: Preset;
	topN: number;
}

interface RankMessage {
	type: 'rank';
	weights: number[];
	selectedIndex: number | null;
	revision: number;
}

type RankingWorkerMessage = InitMessage | RankMessage;

let population: Population | null = null;
let sigmaZ: number[][] = [];
let settledPreset: Preset | null = null;
let topN = 15;
const workerScope = self as unknown as {
	onmessage: ((event: MessageEvent<RankingWorkerMessage>) => void) | null;
	postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Ranking worker failed.';
}

workerScope.onmessage = (event: MessageEvent<RankingWorkerMessage>) => {
	try {
		const message = event.data;
		if (message.type === 'init') {
			const count = message.names.length;
			population = {
				count,
				names: message.names.slice(),
				authorIds: message.authorIds ? message.authorIds.slice() : null,
				z: message.z,
				hasRecognition: new Uint8Array(count),
				nBooks: new Int32Array(count),
				bestTier: new Int8Array(count),
				nAwards: new Int32Array(count),
				concentration: new Float64Array(count)
			};
			sigmaZ = message.sigmaZ.map((row) => row.slice());
			settledPreset = { ...message.settledPreset, weights: message.settledPreset.weights.slice() };
			topN = message.topN;
			workerScope.postMessage({ type: 'ready' });
			return;
		}
		if (!population) {
			workerScope.postMessage({
				type: 'error',
				revision: message.revision,
				error: 'Worker is not initialized.'
			});
			return;
		}
		const started = workerTimingStart();
		if (!settledPreset) throw new Error('Worker is missing the settled preset.');
		const result: RankingResult = computeRanking({
			population,
			sigmaZ,
			settledPreset,
			topN,
			weights: message.weights.slice(),
			selectedIndex: message.selectedIndex,
			revision: message.revision
		});
		workerTimingEnd(started);
		const transfer: Transferable[] = [
			result.top250.buffer,
			result.rankByIndex.buffer,
			result.scoreIndices.buffer,
			result.scoreValues.buffer,
			result.contributionValues.buffer,
			result.rankBuckets.buffer
		];
		if (result.selectedContributions) transfer.push(result.selectedContributions.buffer);
		workerScope.postMessage({ type: 'result', result }, transfer);
	} catch (error) {
		workerScope.postMessage({
			type: 'error',
			revision: event.data.type === 'rank' ? event.data.revision : undefined,
			error: errorMessage(error)
		});
	}
};
