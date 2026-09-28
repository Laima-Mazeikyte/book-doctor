import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHistoryLoader, loadRelease } from './release';
import { SHOWCASE_READER_IDS } from './showcase';
import { BenchmarkFormatError } from './types';

vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_RECOMMENDATION_BENCHMARK_BASE: '/handoff' }
}));

const manifest = {
	schema_version: 5,
	version: 'v7',
	cohort: { readers: 200, history_boundaries: [79, 122, 208] },
	systems: [
		{ id: 'ours', readers: 200 },
		{ id: 'hardcover', readers: 100 },
		{ id: 'chatgpt', readers: 200, prompt: 'Recommend ten books.' }
	],
	populations: [
		{ id: 'all', readers: 200, history_min: 11, history_max: 766 },
		{ id: 'shorter', readers: 100, history_min: 11, history_max: 122 },
		{ id: 'unread_2000', readers: 2000, direct_comparison: false }
	],
	files: {
		summary: 'summary.json',
		readers: 'readers.json',
		histories: 'histories/{id}.json'
	}
};
const row = (system: string, population: string) => ({
	system,
	population,
	users: 1,
	hits: 1,
	hit_rate: 1,
	ci95: [1, 1],
	ci95_method: 'Wilson score interval'
});
const summary = {
	schema_version: 5,
	accuracy: {
		rows: [
			row('ours', 'all'),
			row('chatgpt', 'all'),
			row('hardcover', 'shorter'),
			row('ours', 'unread_2000')
		],
		paired: []
	},
	groups: { history_group: [], unread_2000: { history_group: [] } },
	uncertainty: { method: 'Wilson score interval' }
};
const book = { id: 'B', title: 'T', author: 'A' };
const reader = (id: string) => ({
	id,
	shown_count: 10,
	target: book,
	top_rated: [],
	lists: { ours: [book], hardcover: [book], chatgpt: [book] },
	hit_rank: { ours: 1, hardcover: null, chatgpt: null }
});
/** The whole showcase, in reverse, to show the loader restores the showcase order. */
const readers = [...SHOWCASE_READER_IDS].reverse().map(reader);

function stubFetch(...bodies: unknown[]) {
	const fetcher = vi.fn();
	for (const body of bodies) fetcher.mockResolvedValueOnce(Response.json(body));
	vi.stubGlobal('fetch', fetcher);
	return fetcher;
}

afterEach(() => vi.unstubAllGlobals());

describe('recommendation benchmark release', () => {
	it('follows the release pointer and returns the showcase readers in order', async () => {
		const fetcher = stubFetch({ web_root: 'versions/v7/web' }, manifest, summary, readers);
		const release = await loadRelease();
		expect(release.manifest.version).toBe('v7');
		expect(release.readers.map((r) => r.id)).toEqual(SHOWCASE_READER_IDS);
		expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
			'/handoff/current_release.json',
			'/handoff/versions/v7/web/manifest.json',
			'/handoff/versions/v7/web/summary.json',
			'/handoff/versions/v7/web/readers.json'
		]);
	});

	it('rejects an unknown schema', async () => {
		stubFetch({ version: 'v7' }, { ...manifest, schema_version: 99 });
		await expect(loadRelease()).rejects.toBeInstanceOf(BenchmarkFormatError);
	});

	it('rejects a release without history boundaries', async () => {
		const noBoundaries = { ...manifest, cohort: { readers: 200 } };
		stubFetch({ version: 'v7' }, noBoundaries);
		await expect(loadRelease()).rejects.toBeInstanceOf(BenchmarkFormatError);
	});

	it('rejects a release without the ChatGPT prompt', async () => {
		const noPrompt = {
			...manifest,
			systems: manifest.systems.map((system) => ({ id: system.id, readers: system.readers }))
		};
		stubFetch({ version: 'v7' }, noPrompt);
		await expect(loadRelease()).rejects.toBeInstanceOf(BenchmarkFormatError);
	});

	it('rejects a summary without the 2,000-reader history breakdown', async () => {
		const noCohort = { ...summary, groups: { history_group: [] } };
		stubFetch({ version: 'v7' }, manifest, noCohort, readers);
		await expect(loadRelease()).rejects.toBeInstanceOf(BenchmarkFormatError);
	});

	it('rejects a row whose own interval is not a Wilson interval', async () => {
		const bootstrapRow = {
			...summary,
			accuracy: {
				...summary.accuracy,
				rows: [
					...summary.accuracy.rows.slice(0, 3),
					{ ...row('ours', 'unread_2000'), ci95_method: 'Stratified user bootstrap' }
				]
			}
		};
		stubFetch({ version: 'v7' }, manifest, bootstrapRow, readers);
		await expect(loadRelease()).rejects.toBeInstanceOf(BenchmarkFormatError);
	});

	it('rejects a release whose intervals are not Wilson intervals', async () => {
		const bootstrap = { ...summary, uncertainty: { method: 'stratified bootstrap' } };
		stubFetch({ version: 'v7' }, manifest, bootstrap, readers);
		await expect(loadRelease()).rejects.toBeInstanceOf(BenchmarkFormatError);
	});

	it('rejects a summary with a system missing from the accuracy rows', async () => {
		const withoutHardcover = {
			...summary,
			accuracy: { ...summary.accuracy, rows: summary.accuracy.rows.slice(0, 2) }
		};
		stubFetch({ version: 'v7' }, manifest, withoutHardcover, readers);
		await expect(loadRelease()).rejects.toBeInstanceOf(BenchmarkFormatError);
	});

	it('rejects a reader file missing a showcase reader', async () => {
		stubFetch({ version: 'v7' }, manifest, summary, readers.slice(1));
		await expect(loadRelease()).rejects.toBeInstanceOf(BenchmarkFormatError);
	});

	it('rejects a showcase reader without a list from every system', async () => {
		const [first, ...rest] = readers;
		const noHardcover = { ...first, lists: { ours: [book], chatgpt: [book] } };
		stubFetch({ version: 'v7' }, manifest, summary, [noHardcover, ...rest]);
		await expect(loadRelease()).rejects.toBeInstanceOf(BenchmarkFormatError);
	});

	it('loads each history once and checks it belongs to the reader', async () => {
		const id = SHOWCASE_READER_IDS[0];
		const fetcher = stubFetch({ version: 'v7' }, manifest, summary, readers, {
			id,
			columns: ['id', 'title', 'author', 'rating'],
			rows: [['B', 'Book', 'Author', 5]]
		});
		const release = await loadRelease();
		const load = createHistoryLoader(release);
		const [first, second] = await Promise.all([load(id), load(id)]);
		expect(first).toBe(second);
		expect(fetcher).toHaveBeenCalledTimes(5);
		expect(fetcher.mock.calls[4][0]).toBe(`/handoff/versions/v7/web/histories/${id}.json`);
	});
});
