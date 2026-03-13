import { GOOGLE_BOOKS_API_KEY } from '$env/static/private';
import type { Book } from '$lib/types/book';

const BASE = 'https://www.googleapis.com/books/v1/volumes';

// Normalise a string to a lowercase alphanumeric key for deduplication.
function normalise(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface GoogleVolume {
	id: string;
	volumeInfo: {
		title?: string;
		authors?: string[];
		publishedDate?: string;
		description?: string;
		imageLinks?: {
			thumbnail?: string;
			smallThumbnail?: string;
		};
	};
}

interface GoogleBooksResponse {
	totalItems: number;
	items?: GoogleVolume[];
}

function mapVolume(vol: GoogleVolume): Book {
	const info = vol.volumeInfo;
	const rawCover = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail;
	// Only use the URL if it points to the actual front cover, not a scanned interior page.
	// Google Books thumbnail URLs for real covers contain "frontcover" in the URL.
	const coverUrl =
		rawCover && rawCover.includes('frontcover')
			? rawCover.replace(/^http:/, 'https:')
			: undefined;

	return {
		id: vol.id,
		title: info.title ?? 'Unknown title',
		author: info.authors?.[0] ?? 'Unknown author',
		coverUrl,
		summary: info.description,
		year: info.publishedDate ? info.publishedDate.slice(0, 4) : undefined
	};
}

function dedup(volumes: GoogleVolume[]): GoogleVolume[] {
	const seen = new Set<string>();
	return volumes.filter((vol) => {
		const info = vol.volumeInfo;
		const key =
			normalise(info.title ?? '') + '|' + normalise(info.authors?.[0] ?? '');
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

async function fetchVolumes(params: Record<string, string | number>): Promise<GoogleVolume[]> {
	const url = new URL(BASE);
	for (const [k, v] of Object.entries(params)) {
		url.searchParams.set(k, String(v));
	}
	if (GOOGLE_BOOKS_API_KEY) {
		url.searchParams.set('key', GOOGLE_BOOKS_API_KEY);
	}

	const res = await fetch(url.toString());
	if (!res.ok) {
		throw new Error(`Google Books API error: ${res.status} ${res.statusText}`);
	}

	const data: GoogleBooksResponse = await res.json();
	return data.items ?? [];
}

/**
 * Fetch a page of popular books (broad relevance-ordered query).
 * Books without a cover image are excluded.
 */
export async function fetchPopularBooks(startIndex: number, maxResults: number): Promise<Book[]> {
	const volumes = await fetchVolumes({
		q: 'subject:fiction',
		orderBy: 'relevance',
		printType: 'books',
		langRestrict: 'en',
		maxResults,
		startIndex
	});

	return dedup(volumes)
		.map(mapVolume)
		.filter((b) => Boolean(b.coverUrl));
}

/**
 * Search books by query string. Books without covers get a placeholder (coverUrl undefined).
 */
export async function searchBooks(query: string, maxResults: number): Promise<Book[]> {
	const volumes = await fetchVolumes({
		q: query,
		orderBy: 'relevance',
		printType: 'books',
		langRestrict: 'en',
		maxResults
	});

	return dedup(volumes).map(mapVolume);
}
