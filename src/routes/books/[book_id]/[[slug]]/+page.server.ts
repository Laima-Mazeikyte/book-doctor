import { error, redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import { bookPath } from '$lib/books/bookUrl';
import {
	bookCharacteristics,
	CHARACTERISTIC_SELECT,
	type CharacteristicRow
} from '$lib/books/characteristics';
import { CATALOG_SELECT } from '$lib/server/catalogBooks';
import { mapBookRowToBook, type BookCatalogRow } from '$lib/search/mapBookRowToBook';
import { supabase } from '$lib/server/supabase';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	if (!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(params.book_id)) error(404, 'Book not found');
	const bookId = params.book_id.toUpperCase();
	const { data, error: bookError } = await Promise.resolve(
		supabase
			.from('books')
			.select(`${CATALOG_SELECT}, ${CHARACTERISTIC_SELECT}`)
			.eq('book_id', bookId)
			.maybeSingle()
	).catch(() => error(503, 'Book details are temporarily unavailable. Please try again.'));
	if (bookError) {
		error(503, 'Book details are temporarily unavailable. Please try again.');
	}
	if (!data) error(404, 'Book not found');
	const row = data as unknown as BookCatalogRow & CharacteristicRow;
	const book = mapBookRowToBook(row);
	const canonicalPath = `${base}${bookPath(book)}`;
	if (url.pathname !== canonicalPath) redirect(308, `${canonicalPath}${url.search}`);

	return {
		book,
		canonicalUrl: new URL(canonicalPath, url.origin).href,
		characteristics: bookCharacteristics(row)
	};
};
