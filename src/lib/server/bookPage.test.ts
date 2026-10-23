import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '$lib/types/book';

const fixture = vi.hoisted(() => ({
	fetch: vi.fn(),
	from: vi.fn(),
	query: {
		select: vi.fn(),
		eq: vi.fn(),
		neq: vi.fn(),
		order: vi.fn(),
		maybeSingle: vi.fn(),
		limit: vi.fn()
	}
}));
vi.mock('$lib/server/catalogBooks', () => ({ fetchBooksByUlidsInOrder: fixture.fetch }));
vi.mock('$lib/server/supabase', () => ({ supabase: { from: fixture.from } }));
import { load } from '../../routes/books/[book_id]/[[slug]]/+page.server';

const book: Book = {
	id: 'uuid',
	book_id: '01KR2ADTNG29NSQV23VAGV8FXB',
	title: 'The Test Book',
	author: 'An Author'
};
function event(path = `/books/${book.book_id}/the-test-book`) {
	return {
		params: { book_id: path.split('/')[2], slug: path.split('/')[3] },
		url: new URL(path, 'https://unread.example')
	} as Parameters<typeof load>[0];
}

beforeEach(() => {
	vi.resetAllMocks();
	fixture.fetch.mockResolvedValue([book]);
	fixture.from.mockReturnValue(fixture.query);
	for (const key of ['select', 'eq', 'neq', 'order'] as const)
		fixture.query[key].mockReturnValue(fixture.query);
	fixture.query.limit.mockResolvedValue({ data: [], error: null });
	fixture.query.maybeSingle.mockResolvedValue({ data: null, error: null });
});

describe('public book page loading', () => {
	it('redirects missing, outdated, and lowercase identity URLs to the canonical URL', async () => {
		for (const path of [
			`/books/${book.book_id}`,
			`/books/${book.book_id}/old-title?source=share`,
			`/books/${book.book_id.toLowerCase()}/the-test-book`
		]) {
			await expect(load(event(path))).rejects.toMatchObject({
				status: 308,
				location: `/books/${book.book_id}/the-test-book${path.includes('?') ? '?source=share' : ''}`
			});
		}
		expect(fixture.from).not.toHaveBeenCalled();
	});
	it('returns 404 for malformed and absent books, and 503 for catalog outages', async () => {
		await expect(load(event('/books/invalid/title'))).rejects.toMatchObject({ status: 404 });
		expect(fixture.fetch).not.toHaveBeenCalled();
		fixture.fetch.mockResolvedValue([]);
		await expect(load(event())).rejects.toMatchObject({ status: 404 });
		fixture.fetch.mockRejectedValue(new Error('unavailable'));
		await expect(load(event())).rejects.toMatchObject({ status: 503 });
	});
	it('loads author books without making author lookup failures break the book page', async () => {
		fixture.query.maybeSingle.mockResolvedValue({ data: { pace_value: 0.8 }, error: null });
		fixture.query.limit.mockResolvedValue({ data: [{ book_id: 'another-id' }], error: null });
		const otherBook = { ...book, book_id: 'another-id' };
		fixture.fetch.mockResolvedValueOnce([book]).mockResolvedValueOnce([otherBook]);
		await expect(load(event())).resolves.toMatchObject({
			book,
			characteristics: { labels: [{ label: 'Unhurried' }], availableDimensions: 1 },
			authorBooks: [otherBook],
			canonicalUrl: `https://unread.example/books/${book.book_id}/the-test-book`
		});
		expect(fixture.query.eq).toHaveBeenCalledWith('author', book.author);
		expect(fixture.query.neq).toHaveBeenCalledWith('book_id', book.book_id);
		fixture.query.limit.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
		await expect(load(event())).resolves.toMatchObject({
			book,
			authorBooks: [],
			authorBooksUnavailable: true
		});
	});
});
