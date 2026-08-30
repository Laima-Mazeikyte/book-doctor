import { computeRanking, type RankingResult } from './ranking-engine';
import { prominenceTimingMeasure, prominenceTimingMark, withProminenceTiming } from './performance';
import type { Population, Preset } from './types';

export type RankingClientStatus =
	| 'starting'
	| 'ready'
	| 'busy'
	| 'fallback'
	| 'failed'
	| 'destroyed';

interface PendingRequest {
	weights: number[];
	selectedIndex: number | null;
	revision: number;
}

interface WorkerResponse {
	type: 'ready' | 'result' | 'error';
	result?: RankingResult;
	revision?: number;
	error?: string;
}

interface ClientOptions {
	onResult: (result: RankingResult) => void;
	onError?: (error: unknown) => void;
	onFatal?: (error: unknown) => void;
	onStatus?: (status: RankingClientStatus) => void;
	onDiagnostic?: (event: { kind: string; error?: unknown }) => void;
}

export const INITIALIZATION_TIMEOUT_MS = 2000;
export const RANKING_TIMEOUT_MS = 2000;

/** One active request plus one newest pending request; exact ranking is never approximated. */
export class RankingClient {
	private worker: Worker | null = null;
	private population: Population | null = null;
	private sigmaZ: number[][] = [];
	private settledPreset: Preset | null = null;
	private topN = 15;
	private status: RankingClientStatus = 'destroyed';
	private active: PendingRequest | null = null;
	private pending: PendingRequest | null = null;
	private revision = 0;
	private initializationTimeout: ReturnType<typeof setTimeout> | null = null;
	private rankingTimeout: ReturnType<typeof setTimeout> | null = null;
	private generation = 0;
	private diagnosticSent = false;
	private readonly options: ClientOptions;

	constructor(options: ClientOptions) {
		this.options = options;
	}

	getStatus(): RankingClientStatus {
		return this.status;
	}

	start(population: Population, sigmaZ: number[][], settledPreset: Preset, topN: number): void {
		const generation = ++this.generation;
		this.resetTransport();
		this.population = population;
		this.sigmaZ = sigmaZ.map((row) => row.slice());
		this.settledPreset = { ...settledPreset, weights: settledPreset.weights.slice() };
		this.topN = topN;
		this.revision = 0;
		this.diagnosticSent = false;
		this.setStatus('starting');
		try {
			this.worker = new Worker(new URL('./ranking.worker.ts', import.meta.url), { type: 'module' });
			this.worker.onmessage = (event: MessageEvent<WorkerResponse>) =>
				this.handleMessage(generation, event.data);
			this.worker.onerror = (error) => this.failWorker(generation, error);
			const message = {
				type: 'init' as const,
				names: population.names.slice(),
				authorIds: population.authorIds ? population.authorIds.slice() : null,
				z: population.z.map((column) => column.slice()),
				sigmaZ: this.sigmaZ,
				settledPreset: this.settledPreset!,
				topN
			};
			this.worker.postMessage(
				message,
				message.z.map((column) => column.buffer)
			);
			this.initializationTimeout = setTimeout(
				() => this.failWorker(generation, new Error('Ranking worker initialization timed out.')),
				INITIALIZATION_TIMEOUT_MS
			);
		} catch (error) {
			this.failWorker(generation, error);
		}
	}

	request(
		weights: number[],
		selectedIndex: number | null,
		onAllocated?: (revision: number) => void
	): number {
		if (this.status === 'destroyed' || this.status === 'failed') return this.revision;
		const revision = ++this.revision;
		this.pending = { weights: weights.slice(), selectedIndex, revision };
		onAllocated?.(revision);
		this.pump();
		return revision;
	}

	destroy(): void {
		this.generation += 1;
		this.resetTransport();
		this.population = null;
		this.sigmaZ = [];
		this.settledPreset = null;
		this.active = null;
		this.pending = null;
		this.setStatus('destroyed');
	}

	private resetTransport(): void {
		this.clearTimers();
		this.worker?.terminate();
		this.worker = null;
		this.active = null;
		this.pending = null;
	}

	private setStatus(status: RankingClientStatus): void {
		this.status = status;
		this.options.onStatus?.(status);
	}

	private handleMessage(generation: number, message: unknown): void {
		if (generation !== this.generation || this.status === 'destroyed' || this.status === 'failed')
			return;
		if (!message || typeof message !== 'object' || !('type' in message)) {
			this.failWorker(generation, new Error('Ranking worker returned a malformed message.'));
			return;
		}
		const response = message as WorkerResponse;
		if (response.type === 'ready') {
			if (this.status !== 'starting') return;
			this.clearInitializationTimeout();
			this.setStatus('ready');
			this.pump();
			return;
		}
		if (response.type === 'error') {
			this.failWorker(generation, new Error(response.error ?? 'Ranking worker returned an error.'));
			return;
		}
		const deserializationMark = prominenceTimingMark('worker-deserialization');
		const workerResult = response.result;
		const valid =
			response.type === 'result' && workerResult !== undefined && this.validResult(workerResult);
		prominenceTimingMeasure('worker-deserialization', deserializationMark);
		if (!valid || !workerResult) {
			this.failWorker(generation, new Error('Ranking worker returned a malformed result.'));
			return;
		}
		this.clearRankingTimeout();
		this.active = null;
		if (workerResult.revision === this.revision)
			withProminenceTiming('reactive-update', () => this.options.onResult(workerResult));
		this.setStatus(this.pending ? 'busy' : 'ready');
		this.pump();
	}

	private validResult(result: RankingResult): boolean {
		const lens = result.lens;
		const featureCount = this.population?.z.length ?? 0;
		const populationCount = this.population?.count ?? 0;
		const weightTotal = Array.isArray(result.weights)
			? result.weights.reduce((sum, value) => sum + value, 0)
			: Number.NaN;
		const displayTotal = Array.isArray(lens?.displayShares)
			? lens.displayShares.reduce((sum, value) => sum + value, 0)
			: Number.NaN;
		return (
			Number.isInteger(result.revision) &&
			result.revision > 0 &&
			Array.isArray(result.weights) &&
			result.weights.every((weight) => Number.isFinite(weight) && weight >= 0) &&
			result.weights.length === featureCount &&
			Number.isFinite(weightTotal) &&
			Math.abs(weightTotal - 1) <= 0.000001 &&
			Number.isFinite(result.denominator) &&
			result.denominator > 0 &&
			ArrayBuffer.isView(result.top250) &&
			result.top250.length <= Math.min(250, populationCount) &&
			ArrayBuffer.isView(result.rankByIndex) &&
			result.rankByIndex.length === populationCount &&
			ArrayBuffer.isView(result.scoreIndices) &&
			ArrayBuffer.isView(result.scoreValues) &&
			result.scoreIndices.length === result.scoreValues.length &&
			ArrayBuffer.isView(result.contributionValues) &&
			result.contributionValues.length === result.scoreIndices.length * featureCount &&
			ArrayBuffer.isView(result.rankBuckets) &&
			result.rankBuckets.length === populationCount &&
			Array.isArray(lens?.weights) &&
			Array.isArray(lens?.displayShares) &&
			lens.weights.length === featureCount &&
			lens.displayShares.length === featureCount &&
			lens.displayShares.every((share) => Number.isInteger(share) && share >= 0 && share <= 100) &&
			displayTotal === 100 &&
			lens.weights.every((weight, index) => weight === result.weights[index]) &&
			(lens.source === 'preset' || lens.source === 'custom') &&
			typeof lens.displayName === 'string' &&
			typeof lens.manifestNote === 'string'
		);
	}

	private failWorker(generation: number, error: unknown): void {
		if (
			generation !== this.generation ||
			this.status === 'destroyed' ||
			this.status === 'fallback' ||
			this.status === 'failed'
		)
			return;
		this.clearTimers();
		this.worker?.terminate();
		this.worker = null;
		// Invalidate every handler attached to the abandoned worker before computing fallback.
		this.generation += 1;
		// If a newer request is already pending, it supersedes the in-flight request.
		if (!this.pending && this.active) this.pending = this.active;
		this.active = null;
		this.setStatus('fallback');
		if (!this.diagnosticSent) {
			this.diagnosticSent = true;
			this.options.onDiagnostic?.({ kind: 'ranking-worker-fallback', error });
		}
		this.options.onError?.(error);
		this.pump();
	}

	private pump(): void {
		if (this.status === 'destroyed' || this.status === 'failed' || this.active || !this.pending)
			return;
		if (this.status === 'starting') return;
		const pending = this.pending;
		this.pending = null;
		this.active = pending;
		const worker = this.worker;
		if (worker && (this.status === 'ready' || this.status === 'busy')) {
			this.setStatus('busy');
			const generation = this.generation;
			try {
				withProminenceTiming('worker-request', () =>
					worker.postMessage({ type: 'rank', ...pending })
				);
				this.rankingTimeout = setTimeout(
					() => this.failWorker(generation, new Error('Ranking worker request timed out.')),
					RANKING_TIMEOUT_MS
				);
			} catch (error) {
				this.failWorker(generation, error);
			}
			return;
		}
		this.computeFallback(pending);
	}

	private computeFallback(request: PendingRequest): void {
		if (!this.population) {
			this.failFallback(new Error('Ranking fallback has no release population.'));
			return;
		}
		try {
			if (!this.settledPreset) throw new Error('Ranking fallback has no settled preset.');
			const result = withProminenceTiming('worker-rank', () =>
				computeRanking({
					population: this.population!,
					sigmaZ: this.sigmaZ,
					settledPreset: this.settledPreset!,
					topN: this.topN,
					weights: request.weights.slice(),
					selectedIndex: request.selectedIndex,
					revision: request.revision
				})
			);
			this.active = null;
			if (result.revision === this.revision)
				withProminenceTiming('reactive-update', () => this.options.onResult(result));
			this.setStatus('fallback');
		} catch (error) {
			this.active = null;
			this.failFallback(error);
		}
		if (this.pending) this.pump();
	}

	private failFallback(error: unknown): void {
		this.active = null;
		this.setStatus('failed');
		this.options.onFatal?.(error);
		this.options.onDiagnostic?.({ kind: 'ranking-fallback-failed', error });
	}

	private clearInitializationTimeout(): void {
		if (this.initializationTimeout !== null) clearTimeout(this.initializationTimeout);
		this.initializationTimeout = null;
	}

	private clearRankingTimeout(): void {
		if (this.rankingTimeout !== null) clearTimeout(this.rankingTimeout);
		this.rankingTimeout = null;
	}

	private clearTimers(): void {
		this.clearInitializationTimeout();
		this.clearRankingTimeout();
	}
}
