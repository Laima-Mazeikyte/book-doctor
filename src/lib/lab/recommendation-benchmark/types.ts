/**
 * Types for the recommendation benchmark release (v7, schema 5) written by
 * `temp/benchmarking/export_benchmark_web.py`. Only the fields the page reads are typed.
 *
 * Every statistic is precomputed by the exporter; the page only formats and draws it.
 */

export const SYSTEM_IDS = ['ours', 'hardcover', 'chatgpt'] as const;
export type SystemId = (typeof SYSTEM_IDS)[number];

/**
 * Who a statistic covers. `all`: every reader of the shared 200-reader comparison cohort.
 * `shorter`: the 100 readers Hardcover was tested on, the shorter-history groups. `unread_2000`:
 * a separate 2,000-reader cohort with the same design, for Unread only; it is never part of a
 * head-to-head comparison.
 */
export const POPULATION_IDS = ['all', 'shorter', 'unread_2000'] as const;
export type PopulationId = (typeof POPULATION_IDS)[number];

export class BenchmarkFormatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BenchmarkFormatError';
	}
}

export interface SystemInfo {
	id: SystemId;
	readers: number;
	/** ChatGPT only: the prompt it was given, shown in "How it works". */
	prompt?: string;
}

export interface PopulationInfo {
	id: PopulationId;
	readers: number;
	/** Rated-book range of the population's readers; absent for the separate cohort. */
	history_min?: number;
	history_max?: number;
	/** False for a cohort that is not part of any head-to-head comparison. */
	direct_comparison?: boolean;
}

export interface BenchmarkManifest {
	schema_version: number;
	version: string;
	cohort: {
		/** The full shared cohort; the reader file holds only the showcase readers. */
		readers: number;
		/** Upper bounds of history groups 1–3, shared by every cohort; group 4 is above the last. */
		history_boundaries: number[];
	};
	systems: SystemInfo[];
	populations: PopulationInfo[];
	files: { summary: string; readers: string; histories: string };
}

/** A system's hit rate over every reader of one population. */
export interface HitRow {
	system: SystemId;
	population: PopulationId;
	users: number;
	hits: number;
	hit_rate: number;
	/** 95% Wilson score interval for the hit rate. */
	ci95: [number, number];
	ci95_method: string;
}

/** Head to head over every reader both systems were tested on. */
export interface PairedAccuracy {
	a: SystemId;
	b: SystemId;
	users: number;
	only_a: number;
	only_b: number;
	both: number;
	/** Two-sided exact McNemar test: a binomial test on readers only one system found. */
	p_exact: number;
}

export interface GroupRow {
	group: string;
	/** Absent for a system with no readers in the group. */
	systems: Partial<Record<SystemId, { users: number; hits: number }>>;
}

/** Unread's hits in one history group of the separate 2,000-reader cohort. */
export interface CohortGroupRow {
	group: string;
	users: number;
	hits: number;
}

export interface BenchmarkSummary {
	schema_version: number;
	accuracy: { rows: HitRow[]; paired: PairedAccuracy[] };
	groups: {
		history_group: GroupRow[];
		unread_2000: { history_group: CohortGroupRow[] };
	};
	/** How the exporter computed every `ci95`; the page labels the whiskers with this method. */
	uncertainty: { method: string };
}

export interface ListedBook {
	/** Catalog id; null when a comparator's book is not in our catalog. */
	id: string | null;
	title: string;
	author: string;
}

export interface CatalogBook {
	id: string;
	title: string;
	author: string;
}

export interface RatedBook extends CatalogBook {
	rating: number;
}

export interface Reader {
	id: string;
	/** Books given to every recommender, the length of the reader's full history. */
	shown_count: number;
	target: CatalogBook;
	top_rated: RatedBook[];
	lists: Record<SystemId, ListedBook[]>;
	/** One-based rank of the hidden favorite, or null for a miss. */
	hit_rank: Record<SystemId, number | null>;
}

export interface ReaderHistory {
	id: string;
	columns: ['id', 'title', 'author', 'rating'];
	rows: Array<[string, string, string, number]>;
}
