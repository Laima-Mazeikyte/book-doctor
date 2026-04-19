import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** Bookmarks list lives on My bookshelf; keep old URL working. */
export const load: PageLoad = () => {
	throw redirect(308, '/my-bookshelf');
};
