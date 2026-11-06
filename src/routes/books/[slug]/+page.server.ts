import { SERVER_TIMEOUT_MS, withTimeout } from '$lib/requests/timeout';
import { error, redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import { bookPath } from '$lib/books/bookUrl';
import { bookSeries } from '$lib/books/series';
import { mapBookRowToBook, type BookCatalogRow } from '$lib/search/mapBookRowToBook';
import { supabase } from '$lib/server/supabase';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, request }) => {
	if (
		!params.slug ||
		params.slug.length > 2000 ||
		!/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(params.slug)
	) {
		error(404, 'Book not found');
	}
	const { data, error: bookError } = await withTimeout(
		(signal) =>
			supabase.rpc('get_book_detail_with_series', { p_slug: params.slug }).abortSignal(signal),
		{ timeoutMs: SERVER_TIMEOUT_MS, signal: request?.signal }
	).catch(() => error(503, 'Book details are temporarily unavailable. Please try again.'));
	if (bookError) error(503, 'Book details are temporarily unavailable. Please try again.');
	if (!data?.book) error(404, 'Book not found');
	const book = mapBookRowToBook(data.book as BookCatalogRow);
	const canonicalPath = `${base}${bookPath(book)}`;
	if (url.pathname !== canonicalPath) redirect(308, `${canonicalPath}${url.search}`);
	return {
		book,
		series: bookSeries(data.series),
		canonicalUrl: new URL(canonicalPath, url.origin).href
	};
};
