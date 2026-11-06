import { beforeEach, expect, it, vi } from 'vitest';
import { loadStartingBooks, loadStartingBookBySlug } from './startingBooks';

const db = vi.hoisted(() => ({
	from: vi.fn(),
	select: vi.fn(),
	ids: vi.fn(),
	run: vi.fn(),
	eq: vi.fn(),
	single: vi.fn()
}));
vi.mock('$lib/supabase', () => ({ getSupabase: () => ({ from: db.from }) }));
const seed = '01KR2ADTFG9DJ85AS30MZFHJG6';

beforeEach(() => {
	vi.clearAllMocks();
	db.from.mockReturnValue({ select: db.select });
	db.select.mockReturnValue({ in: db.ids, eq: db.eq });
	db.eq.mockReturnValue({ abortSignal: () => ({ maybeSingle: db.single }) });
	db.single.mockResolvedValue({
		data: {
			book_id: seed,
			slug: 'the-hunger-games-suzanne-collins',
			book_name: 'The Hunger Games',
			author: 'Suzanne Collins'
		},
		error: null
	});
	db.ids.mockReturnValue({ abortSignal: db.run });
	db.run.mockResolvedValue({
		data: [
			{
				book_id: seed,
				slug: 'the-hunger-games-suzanne-collins',
				book_name: 'The Hunger Games',
				author: 'Suzanne Collins',
				genre1: 'Fantasy',
				genre2: 'Urban Fantasy',
				keyword1: 'Found Family',
				keyword2: 'Found Family'
			}
		],
		error: null
	});
});

it('resolves only valid public IDs with a small public metadata projection', async () => {
	expect(await loadStartingBooks([seed, seed, 'invalid'])).toEqual([
		{
			book_id: seed,
			slug: 'the-hunger-games-suzanne-collins',
			title: 'The Hunger Games',
			author: 'Suzanne Collins',
			genres: ['Fantasy', 'Urban Fantasy'],
			keywords: ['Found Family']
		}
	]);
	expect(db.from).toHaveBeenCalledWith('books');
	expect(db.select).toHaveBeenCalledWith(
		expect.stringContaining('book_id,slug,book_name,author,genre1')
	);
	expect(db.select).toHaveBeenCalledWith(expect.stringContaining('keyword10'));
	expect(db.ids).toHaveBeenCalledWith('book_id', [seed]);
});

it('resolves a stored slug to its ULID and display metadata in one indexed lookup', async () => {
	const book = await loadStartingBookBySlug('the-hunger-games-suzanne-collins');
	expect(book).toMatchObject({
		book_id: seed,
		slug: 'the-hunger-games-suzanne-collins',
		title: 'The Hunger Games'
	});
	expect(db.eq).toHaveBeenCalledExactlyOnceWith('slug', 'the-hunger-games-suzanne-collins');
	expect(db.from).toHaveBeenCalledTimes(1);
	expect(db.ids).not.toHaveBeenCalled();
});

it('does not query malformed slugs and distinguishes absent books from failed lookups', async () => {
	expect(await loadStartingBookBySlug('../invalid')).toBeNull();
	expect(await loadStartingBookBySlug('')).toBeNull();
	expect(db.from).not.toHaveBeenCalled();
	db.single.mockResolvedValue({ data: null, error: null });
	expect(await loadStartingBookBySlug('missing-book')).toBeNull();
	db.single.mockResolvedValue({ data: null, error: new Error('Catalog unavailable') });
	await expect(loadStartingBookBySlug('missing-book')).rejects.toThrow('Catalog unavailable');
});

it('does not start a slug lookup after cancellation', async () => {
	const controller = new AbortController();
	controller.abort();
	await expect(
		loadStartingBookBySlug('the-hunger-games-suzanne-collins', controller.signal)
	).rejects.toThrow();
	expect(db.from).not.toHaveBeenCalled();
});

it('does not query an empty input and surfaces failed lookups instead of inventing an empty success', async () => {
	expect(await loadStartingBooks(['invalid'])).toEqual([]);
	expect(db.from).not.toHaveBeenCalled();
	db.run.mockResolvedValue({ data: null, error: new Error('Network unavailable') });
	await expect(loadStartingBooks([seed])).rejects.toThrow('Network unavailable');
});

it('does not start a lookup after cancellation', async () => {
	const controller = new AbortController();
	controller.abort();
	await expect(loadStartingBooks([seed], controller.signal)).rejects.toThrow();
	expect(db.from).not.toHaveBeenCalled();
});
