import { matchingIndices, type SearchPopulation } from './ranking';
import type { BookPopulation, BookRanking, RankingMode } from './types';

export type SearchRequest =
	| { type: 'prepare'; mode: RankingMode; population: SearchPopulation }
	| {
			type: 'search';
			id: number;
			mode: RankingMode;
			query: string;
			limit: number;
			order?: Int32Array;
	  };
export interface SearchResult {
	indices: number[];
	total: number;
}
export type SearchResponse = { id: number } & (SearchResult | { notReady: true });

/** Keeps text normalization and full-population scans away from typing and layout. */
export class BookSearchClient {
	private worker: Worker | null = null;
	private unavailable = false;
	private requestId = 0;
	private populations = new Map<RankingMode, BookPopulation>();
	private rankings = new Map<RankingMode, BookRanking>();
	/** Resolves with null when this request should be answered on the main thread instead. */
	private pending = new Map<number, (result: SearchResult | null) => void>();

	prepare(population: BookPopulation): void {
		if (this.unavailable) return;
		try {
			if (!this.worker) {
				this.worker = new Worker(new URL('./search.worker.ts', import.meta.url), {
					type: 'module'
				});
				this.worker.onmessage = ({ data }: MessageEvent<SearchResponse>) => {
					const settle = this.pending.get(data.id);
					this.pending.delete(data.id);
					settle?.('notReady' in data ? null : { indices: data.indices, total: data.total });
				};
				this.worker.onerror = () => this.destroy();
				this.worker.onmessageerror = () => this.destroy();
			}
			if (this.populations.get(population.mode) === population) return;
			this.worker.postMessage({
				type: 'prepare',
				mode: population.mode,
				population: {
					titles: population.titles,
					authors: population.authors,
					seriesNames: population.seriesNames
				}
			} satisfies SearchRequest);
			this.populations.set(population.mode, population);
			this.rankings.delete(population.mode);
		} catch {
			this.destroy();
		}
	}

	async search(
		population: BookPopulation,
		ranking: BookRanking,
		query: string,
		limit: number
	): Promise<SearchResult> {
		this.prepare(population);
		if (this.worker) {
			const worker = this.worker;
			const id = ++this.requestId;
			const result = await new Promise<SearchResult | null>((resolve) => {
				this.pending.set(id, resolve);
				worker.postMessage({
					type: 'search',
					id,
					mode: population.mode,
					query,
					limit,
					order: this.rankings.get(population.mode) === ranking ? undefined : ranking.order
				} satisfies SearchRequest);
				this.rankings.set(population.mode, ranking);
			});
			if (result) return result;
			// The worker lost this dataset: resend it with the next search, answer this one here.
			this.populations.delete(population.mode);
			this.rankings.delete(population.mode);
		}
		// Search still works in environments that cannot start a worker.
		const matches = matchingIndices(population, ranking, query);
		return { indices: matches.slice(0, limit), total: matches.length };
	}

	destroy(): void {
		this.unavailable = true;
		this.worker?.terminate();
		this.worker = null;
		for (const settle of this.pending.values()) settle(null);
		this.pending.clear();
		this.populations.clear();
		this.rankings.clear();
	}
}
