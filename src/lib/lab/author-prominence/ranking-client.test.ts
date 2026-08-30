import { afterEach, describe, expect, it, vi } from 'vitest';
import { INITIALIZATION_TIMEOUT_MS, RANKING_TIMEOUT_MS, RankingClient } from './ranking-client';
import { computeRanking, type RankingResult } from './ranking-engine';
import type { Population, Preset } from './types';

const population: Population = {
	count: 2,
	names: ['Alpha', 'Beta'],
	authorIds: null,
	z: [Float64Array.from([1, -1]), Float64Array.from([0, 1]), Float64Array.from([0, 0])],
	hasRecognition: Uint8Array.from([1, 1]),
	nBooks: new Int32Array(2),
	bestTier: new Int8Array(2),
	nAwards: new Int32Array(2),
	concentration: new Float64Array(2)
};
const presets: Preset[] = [{ name: 'Balanced', weights: [0.5, 0.5, 0], settled: true, note: '' }];
const settledPreset = presets[0];

class FakeWorker {
	static last: FakeWorker;
	static instances: FakeWorker[] = [];
	static autoReady = true;
	static throwOnConstruct = false;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	messages: Array<{ type: string; revision?: number; weights?: number[] }> = [];

	constructor() {
		if (FakeWorker.throwOnConstruct) throw new Error('worker construction failed');
		FakeWorker.last = this;
		FakeWorker.instances.push(this);
	}

	postMessage(message: { type: string; revision?: number; weights?: number[] }): void {
		this.messages.push(message);
		if (message.type === 'init' && FakeWorker.autoReady)
			queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } } as MessageEvent));
	}

	terminate(): void {}

	emit(result: RankingResult): void {
		this.onmessage?.({ data: { type: 'result', result } } as MessageEvent);
	}
}

afterEach(() => {
	FakeWorker.autoReady = true;
	FakeWorker.throwOnConstruct = false;
	FakeWorker.instances = [];
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('ranking client request coalescing', () => {
	it('keeps only the newest pending revision and ignores the old result', async () => {
		vi.stubGlobal('Worker', FakeWorker);
		const results: number[] = [];
		const client = new RankingClient({ onResult: (result) => results.push(result.revision) });
		client.start(
			population,
			[
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1]
			],
			settledPreset,
			2
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		const worker = FakeWorker.last;
		const firstRevision = client.request([1, 0, 0], null);
		const secondRevision = client.request([0, 0, 1], null);
		expect(worker.messages.filter((message) => message.type === 'rank')).toHaveLength(1);
		const oldResult = computeRanking({
			population,
			sigmaZ: [
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1]
			],
			settledPreset,
			topN: 2,
			weights: [1, 0, 0],
			selectedIndex: null,
			revision: firstRevision
		});
		worker.emit(oldResult);
		expect(results).toEqual([]);
		expect(worker.messages.filter((message) => message.type === 'rank').at(-1)?.weights).toEqual([
			0, 0, 1
		]);
		const latestResult = computeRanking({
			population,
			sigmaZ: [
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1]
			],
			settledPreset,
			topN: 2,
			weights: [0, 0, 1],
			selectedIndex: null,
			revision: secondRevision
		});
		worker.emit(latestResult);
		expect(results).toEqual([secondRevision]);
		client.destroy();
		vi.unstubAllGlobals();
	});

	it('falls back exactly when the worker fails before ready', () => {
		vi.stubGlobal('Worker', FakeWorker);
		const revisions: number[] = [];
		const client = new RankingClient({ onResult: (result) => revisions.push(result.revision) });
		client.start(
			population,
			[
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1]
			],
			settledPreset,
			2
		);
		const revision = client.request([1, 0, 0], null);
		FakeWorker.last.onerror?.({ message: 'init failed' } as ErrorEvent);
		expect(revisions).toEqual([revision]);
		expect(client.getStatus()).toBe('fallback');
		client.destroy();
		vi.unstubAllGlobals();
	});

	it('allocates before synchronous fallback publication', () => {
		vi.stubGlobal('Worker', FakeWorker);
		FakeWorker.throwOnConstruct = true;
		const events: string[] = [];
		const client = new RankingClient({
			onResult: (result) => events.push(`result:${result.revision}`)
		});
		client.start(
			population,
			[
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1]
			],
			settledPreset,
			2
		);
		const revision = client.request([1, 0, 0], null, (allocated) =>
			events.push(`allocated:${allocated}`)
		);

		expect(events).toEqual([`allocated:${revision}`, `result:${revision}`]);
		client.destroy();
	});

	it('keeps the newer pending request when the active worker request fails', async () => {
		vi.stubGlobal('Worker', FakeWorker);
		const revisions: number[] = [];
		const client = new RankingClient({ onResult: (result) => revisions.push(result.revision) });
		client.start(
			population,
			[
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1]
			],
			settledPreset,
			2
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		client.request([1, 0, 0], null);
		const newest = client.request([0, 0, 1], null);
		FakeWorker.last.onerror?.({ message: 'runtime failed' } as ErrorEvent);
		expect(revisions).toEqual([newest]);
		client.destroy();
		vi.unstubAllGlobals();
	});

	it('cannot publish a result after destruction', async () => {
		vi.stubGlobal('Worker', FakeWorker);
		const results: number[] = [];
		const client = new RankingClient({ onResult: (result) => results.push(result.revision) });
		client.start(
			population,
			[
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1]
			],
			settledPreset,
			2
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		const revision = client.request([1, 0, 0], null);
		client.destroy();
		FakeWorker.last.emit(
			computeRanking({
				population,
				sigmaZ: [
					[1, 0, 0],
					[0, 1, 0],
					[0, 0, 1]
				],
				settledPreset,
				topN: 2,
				weights: [1, 0, 0],
				selectedIndex: null,
				revision
			})
		);
		expect(results).toEqual([]);
	});

	it('times out initialization and computes the newest request exactly', () => {
		vi.useFakeTimers();
		vi.stubGlobal('Worker', FakeWorker);
		FakeWorker.autoReady = false;
		const results: number[] = [];
		const client = new RankingClient({ onResult: (result) => results.push(result.revision) });
		client.start(
			population,
			[
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1]
			],
			settledPreset,
			2
		);
		const revision = client.request([0, 1, 0], null);
		vi.advanceTimersByTime(INITIALIZATION_TIMEOUT_MS + 1);
		expect(results).toEqual([revision]);
		expect(client.getStatus()).toBe('fallback');
		FakeWorker.last.onmessage?.({ data: { type: 'ready' } } as MessageEvent);
		expect(client.getStatus()).toBe('fallback');
		expect(results).toEqual([revision]);
	});

	it('times out an in-flight ranking and leaves the client usable in exact fallback mode', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('Worker', FakeWorker);
		const results: number[] = [];
		const client = new RankingClient({ onResult: (result) => results.push(result.revision) });
		client.start(
			population,
			[
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1]
			],
			settledPreset,
			2
		);
		await Promise.resolve();
		const revision = client.request([0, 1, 0], null);
		vi.advanceTimersByTime(RANKING_TIMEOUT_MS + 1);
		expect(results).toEqual([revision]);
		expect(client.getStatus()).toBe('fallback');
	});

	it('treats malformed worker results as a recoverable fallback', async () => {
		vi.stubGlobal('Worker', FakeWorker);
		const results: number[] = [];
		const diagnostics: string[] = [];
		const client = new RankingClient({
			onResult: (result) => results.push(result.revision),
			onDiagnostic: ({ kind }) => diagnostics.push(kind)
		});
		client.start(
			population,
			[
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1]
			],
			settledPreset,
			2
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		const revision = client.request([0, 1, 0], null);
		FakeWorker.last.emit({} as RankingResult);
		expect(results).toEqual([revision]);
		expect(diagnostics).toEqual(['ranking-worker-fallback']);
		expect(client.getStatus()).toBe('fallback');
	});

	it('ignores late messages from a replaced worker generation', async () => {
		vi.stubGlobal('Worker', FakeWorker);
		FakeWorker.autoReady = false;
		const statuses: string[] = [];
		const client = new RankingClient({
			onResult: () => undefined,
			onStatus: (status) => statuses.push(status)
		});
		client.start(
			population,
			[
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1]
			],
			settledPreset,
			2
		);
		const first = FakeWorker.last;
		client.start(
			population,
			[
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1]
			],
			settledPreset,
			2
		);
		const second = FakeWorker.last;
		first.onmessage?.({ data: { type: 'ready' } } as MessageEvent);
		expect(client.getStatus()).toBe('starting');
		second.onmessage?.({ data: { type: 'ready' } } as MessageEvent);
		expect(client.getStatus()).toBe('ready');
		expect(statuses.filter((status) => status === 'ready')).toHaveLength(1);
	});

	it('surfaces an exact fallback failure and does not remain busy', () => {
		vi.stubGlobal('Worker', FakeWorker);
		FakeWorker.autoReady = false;
		const fatal: unknown[] = [];
		const client = new RankingClient({
			onResult: () => undefined,
			onFatal: (error) => fatal.push(error)
		});
		client.start(
			population,
			[
				[0, 0, 0],
				[0, 0, 0],
				[0, 0, 0]
			],
			settledPreset,
			2
		);
		client.request([1, 0, 0], null);
		FakeWorker.last.onerror?.({ message: 'init failed' } as ErrorEvent);
		// The request was queued before the failure; fallback validation fails explicitly.
		expect(client.getStatus()).toBe('failed');
		expect(fatal).toHaveLength(1);
	});

	it('falls back when Worker construction itself fails', () => {
		vi.stubGlobal('Worker', FakeWorker);
		FakeWorker.throwOnConstruct = true;
		const results: number[] = [];
		const client = new RankingClient({ onResult: (result) => results.push(result.revision) });
		client.start(
			population,
			[
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1]
			],
			settledPreset,
			2
		);
		const revision = client.request([1, 0, 0], null);
		expect(results).toEqual([revision]);
		expect(client.getStatus()).toBe('fallback');
	});
});
