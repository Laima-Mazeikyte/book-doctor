import { error, redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import { bookPath } from '$lib/books/bookUrl';
import { bookCharacteristics, CHARACTERISTIC_SELECT } from '$lib/books/characteristics';
import { fetchBooksByUlidsInOrder } from '$lib/server/catalogBooks';
import { supabase } from '$lib/server/supabase';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	if (!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(params.book_id)) error(404, 'Book not found');
	const bookId = params.book_id.toUpperCase();
	let book;
	try {
		[book] = await fetchBooksByUlidsInOrder(supabase, [bookId]);
	} catch {
		error(503, 'Book details are temporarily unavailable. Please try again.');
	}
	if (!book) error(404, 'Book not found');
	const canonicalPath = `${base}${bookPath(book)}`;
	if (url.pathname !== canonicalPath) redirect(308, `${canonicalPath}${url.search}`);

	// Only established catalog fields are queried. Missing future data has no invented schema.
	const [characteristicResult, authorResult] = await Promise.all([
		supabase.from('books').select(CHARACTERISTIC_SELECT).eq('book_id', book.book_id).maybeSingle(),
		book.author.trim()
			? supabase
					.from('books')
					.select('book_id')
					.eq('author', book.author)
					.neq('book_id', book.book_id)
					.order('book_name')
					.limit(49)
			: Promise.resolve(null)
	]);
	let authorBooks: Awaited<ReturnType<typeof fetchBooksByUlidsInOrder>> = [];
	let authorBooksUnavailable = Boolean(authorResult?.error);
	if (authorResult?.data && !authorResult.error) {
		try {
			authorBooks = await fetchBooksByUlidsInOrder(
				supabase,
				authorResult.data.slice(0, 48).map((row) => row.book_id)
			);
		} catch {
			authorBooksUnavailable = true;
		}
	}
	return {
		book,
		authorBooks,
		authorBooksUnavailable,
		authorBooksTruncated: (authorResult?.data?.length ?? 0) > 48,
		canonicalUrl: new URL(canonicalPath, url.origin).href,
		characteristics: bookCharacteristics(
			characteristicResult.error ? null : characteristicResult.data
		)
	};
};
