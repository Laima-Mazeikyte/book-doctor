import { withTimeout } from '$lib/requests/timeout';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface DiscoveryBook {
	book_id: string;
	slug: string;
	title: string;
	author: string;
	reason: { code: string; params: Record<string, unknown> };
}

export interface BookDiscoveryResult {
	bookId: string;
	releaseId: string | null;
	similarExperience: DiscoveryBook[];
	differentDirection: DiscoveryBook[];
}

const ulid = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const slug = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;
function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseBooks(value: unknown, sourceId: string, seen: Set<string>): DiscoveryBook[] {
	if (!Array.isArray(value) || value.length > 5) throw new Error('Invalid discovery list');
	return value.map((item: unknown) => {
		if (
			!object(item) ||
			typeof item.book_id !== 'string' ||
			!ulid.test(item.book_id) ||
			item.book_id === sourceId ||
			seen.has(item.book_id) ||
			typeof item.slug !== 'string' ||
			item.slug.length > 2000 ||
			!slug.test(item.slug) ||
			typeof item.title !== 'string' ||
			!item.title.trim() ||
			typeof item.author !== 'string' ||
			!item.author.trim() ||
			!object(item.reason) ||
			typeof item.reason.code !== 'string' ||
			!item.reason.code ||
			!object(item.reason.params)
		)
			throw new Error('Invalid discovery book');
		seen.add(item.book_id);
		return {
			book_id: item.book_id,
			slug: item.slug,
			title: item.title,
			author: item.author,
			reason: { code: item.reason.code, params: item.reason.params }
		};
	});
}

/** Shared public results. Metadata and ordering arrive in this one request. */
export async function loadBookDiscovery(
	supabase: SupabaseClient,
	bookId: string,
	signal: AbortSignal
): Promise<BookDiscoveryResult> {
	return withTimeout(
		async (signal) => {
			signal.throwIfAborted();
			const { data, error } = await supabase
				.rpc('get_book_discovery', { p_book_id: bookId })
				.abortSignal(signal);
			if (error) throw new Error(error.message || 'Unable to load related books');
			signal.throwIfAborted();
			if (
				!object(data) ||
				data.book_id !== bookId ||
				!(
					data.release_id === null ||
					(typeof data.release_id === 'string' && data.release_id.trim())
				)
			) {
				throw new Error('Invalid book discovery response');
			}
			const seen = new Set<string>();
			const similarExperience = parseBooks(data.similar_experience, bookId, seen);
			const differentDirection = parseBooks(data.different_direction, bookId, seen);
			if (data.release_id === null && seen.size)
				throw new Error('Discovery results have no release');
			return { bookId, releaseId: data.release_id, similarExperience, differentDirection };
		},
		{ signal }
	);
}

const contrasts: Record<string, readonly [string, string]> = {
	pace: ['More action-driven', 'More introspective'],
	vocabulary: ['More accessible language', 'More complex language'],
	depth: ['A more literal focus', 'A more philosophical focus'],
	atmosphere: ['A less oppressive atmosphere', 'A more oppressive atmosphere'],
	emotion: ['A more uplifting emotional tone', 'A more tragic emotional tone'],
	violence: ['Less graphic violence', 'More graphic violence'],
	spice: ['Less explicit sexual content', 'More explicit sexual content'],
	granularity: ['Sparser description', 'Richer description'],
	narrative: ['A more conventional narrative structure', 'A more deconstructed narrative structure']
};
const families = new Set([
	'fantasy',
	'science fiction',
	'romance',
	'mystery and crime',
	'thrillers',
	'horror',
	'literary and realistic fiction',
	'historical fiction',
	'comics and manga',
	'poetry',
	'biography and memoir',
	'history',
	'philosophy',
	'psychology',
	'society and politics',
	'science and nature',
	'business and economics',
	'personal development',
	'religion and spirituality',
	'arts and criticism',
	'health and medicine',
	'travel',
	'food and crafts',
	"children's books",
	'true crime'
]);

/** Explain supported changes without implying absent content or personal fit. */
export function discoveryReason(reason: DiscoveryBook['reason']): string | null {
	const { code, params } = reason;
	if (params.direction !== -1 && params.direction !== 1) return null;
	if (code === 'dimension_contrast' && typeof params.axis === 'string') {
		return Object.hasOwn(contrasts, params.axis)
			? contrasts[params.axis][params.direction === -1 ? 0 : 1]
			: null;
	}
	if (
		['genre_contrast', 'topic_contrast', 'format_contrast', 'audience_contrast'].includes(code) &&
		typeof params.family === 'string' &&
		families.has(params.family)
	) {
		return `${params.direction === 1 ? 'Toward' : 'Away from'} ${params.family}`;
	}
	// shared_profile is described once by the section subtitle. New reason codes
	// can still show books without inventing unsupported explanations.
	return null;
}

export function visibleDiscoveryBooks(
	books: DiscoveryBook[],
	readIds: ReadonlySet<string>,
	dismissedIds: ReadonlySet<string> = new Set()
): DiscoveryBook[] {
	const eligible = books.filter((book) => !dismissedIds.has(book.book_id));
	const unread = eligible.filter((book) => !readIds.has(book.book_id));
	const familiar = eligible.filter((book) => readIds.has(book.book_id));
	// Dismissals fill otherwise empty slots, in server order regardless of rating.
	const dismissed = books.filter((book) => dismissedIds.has(book.book_id));
	return [...unread, ...familiar, ...dismissed].slice(0, 3);
}
