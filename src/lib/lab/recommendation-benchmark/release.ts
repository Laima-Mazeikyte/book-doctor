import { env } from '$env/dynamic/public';
import { artifactBase, fetchJson, joinUrl, resolveWebRoot } from '../release';
import {
	BenchmarkFormatError,
	POPULATION_IDS,
	SYSTEM_IDS,
	type BenchmarkManifest,
	type BenchmarkSummary,
	type Reader,
	type ReaderHistory
} from './types';
import { SHOWCASE_READER_IDS } from './showcase';

const SCHEMA_VERSION = 5;
/** The page names this method under the chart, so a release with another one is rejected. */
const INTERVAL_METHOD = /wilson/i;

export interface Release {
	base: string;
	webRoot: string;
	manifest: BenchmarkManifest;
	summary: BenchmarkSummary;
	/** The showcase readers, in showcase order. */
	readers: Reader[];
}

function fail(message: string): never {
	throw new BenchmarkFormatError(message);
}

export function validateManifest(manifest: BenchmarkManifest): void {
	if (manifest?.schema_version !== SCHEMA_VERSION) {
		fail(`Unsupported manifest schema_version ${manifest?.schema_version}.`);
	}
	const ids = new Set(manifest.systems?.map((system) => system.id));
	for (const id of SYSTEM_IDS) {
		if (!ids.has(id)) fail(`Manifest does not describe the ${id} system.`);
	}
	if (!manifest.systems.find((system) => system.id === 'chatgpt')?.prompt) {
		fail('Manifest has no ChatGPT prompt.');
	}
	if (!manifest.files?.summary || !manifest.files.readers || !manifest.files.histories) {
		fail('Manifest does not name its data files.');
	}
	if (!manifest.files.histories.includes('{id}')) {
		fail('Manifest history path has no {id} placeholder.');
	}
	if (!Number.isInteger(manifest.cohort?.readers) || manifest.cohort.readers <= 0) {
		fail('Manifest does not report the cohort size.');
	}
	for (const id of POPULATION_IDS) {
		if (!manifest.populations?.some((population) => population.id === id)) {
			fail(`Manifest does not describe the ${id} population.`);
		}
	}
	const boundaries = manifest.cohort.history_boundaries;
	if (
		!Array.isArray(boundaries) ||
		boundaries.length !== 3 ||
		boundaries.some((value, i) => !Number.isFinite(value) || (i > 0 && value <= boundaries[i - 1]))
	) {
		fail('Manifest has no valid history boundaries.');
	}
}

export function validateSummary(summary: BenchmarkSummary): void {
	if (summary?.schema_version !== SCHEMA_VERSION) {
		fail(`Unsupported summary schema_version ${summary?.schema_version}.`);
	}
	const rows = summary.accuracy?.rows;
	if (!Array.isArray(rows) || !Array.isArray(summary.accuracy.paired)) {
		fail('Summary has no accuracy rows.');
	}
	for (const system of SYSTEM_IDS) {
		if (!rows.some((row) => row.system === system)) fail(`Summary has no ${system} accuracy.`);
	}
	for (const row of rows) {
		if (!POPULATION_IDS.includes(row.population) || row.users <= 0) {
			fail(`Accuracy row for ${row.system} has no valid population.`);
		}
		if (!Array.isArray(row.ci95) || row.ci95.length !== 2) {
			fail(`Accuracy row for ${row.system} has no interval.`);
		}
		if (!INTERVAL_METHOD.test(row.ci95_method ?? '')) {
			fail(`Accuracy row for ${row.system} does not use Wilson score intervals.`);
		}
	}
	if (!INTERVAL_METHOD.test(summary.uncertainty?.method ?? '')) {
		fail('Summary intervals are not Wilson score intervals.');
	}
	if (!Array.isArray(summary.groups?.history_group)) {
		fail('Summary has no group breakdown.');
	}
	if (!Array.isArray(summary.groups.unread_2000?.history_group)) {
		fail('Summary has no history breakdown for the 2,000-reader cohort.');
	}
}

/**
 * The reader file holds the showcase readers. Returns them in showcase order, each with a hidden
 * book and a list from every system.
 */
export function showcaseReaders(readers: Reader[]): Reader[] {
	if (!Array.isArray(readers)) fail('Reader file is not a list.');
	const byId = new Map(readers.map((reader) => [reader.id, reader]));
	return SHOWCASE_READER_IDS.map((id) => {
		const reader = byId.get(id);
		if (!reader) fail(`Reader file has no ${id}.`);
		if (!reader.target?.id || SYSTEM_IDS.some((system) => !reader.lists?.[system]?.length)) {
			fail(`Reader ${id} is incomplete.`);
		}
		return reader;
	});
}

export async function loadRelease(): Promise<Release> {
	// Served from Supabase Storage only; there is no local fallback.
	const base = artifactBase(env.PUBLIC_RECOMMENDATION_BENCHMARK_BASE, '');
	if (!base) {
		throw new Error(
			'PUBLIC_RECOMMENDATION_BENCHMARK_BASE is required; the benchmark is served from Supabase Storage.'
		);
	}
	const webRoot = await resolveWebRoot(base);
	const manifest = await fetchJson<BenchmarkManifest>(joinUrl(base, webRoot, 'manifest.json'));
	validateManifest(manifest);
	const [summary, readers] = await Promise.all([
		fetchJson<BenchmarkSummary>(joinUrl(base, webRoot, manifest.files.summary)),
		fetchJson<Reader[]>(joinUrl(base, webRoot, manifest.files.readers))
	]);
	validateSummary(summary);
	return { base, webRoot, manifest, summary, readers: showcaseReaders(readers) };
}

/** Full histories are only fetched when a reader asks to see one; each loads once. */
export function createHistoryLoader(release: Release) {
	const cache = new Map<string, Promise<ReaderHistory>>();
	return (readerId: string): Promise<ReaderHistory> => {
		let load = cache.get(readerId);
		if (!load) {
			const path = release.manifest.files.histories.replace('{id}', encodeURIComponent(readerId));
			load = fetchJson<ReaderHistory>(joinUrl(release.base, release.webRoot, path)).then(
				(history) => {
					if (history.id !== readerId || !Array.isArray(history.rows)) {
						throw new BenchmarkFormatError(`History for ${readerId} is malformed.`);
					}
					return history;
				}
			);
			load.catch(() => cache.delete(readerId));
			cache.set(readerId, load);
		}
		return load;
	};
}
