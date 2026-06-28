/**
 * When the user opens /rate?q=… from another in-app route (e.g. my bookshelf), closing search
 * should return them there (`history.back()`), not leave them on the rate browse feed.
 */
const EXTERNAL_KEY = 'book-doctor-rate-search-external';
/** Author pill from outside /rate: rate page should use exact Meilisearch author search, not fuzzy `q`. */
const AUTHOR_KEY = 'book-doctor-rate-author-search';

export function markRateSearchOpenedFromOtherRoute(): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.setItem(EXTERNAL_KEY, '1');
}

export function clearRateSearchExternalEntry(): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.removeItem(EXTERNAL_KEY);
}

/** Returns true once if the flag was set (and clears it). */
export function consumeRateSearchExternalEntry(): boolean {
	if (typeof sessionStorage === 'undefined') return false;
	if (sessionStorage.getItem(EXTERNAL_KEY) !== '1') return false;
	sessionStorage.removeItem(EXTERNAL_KEY);
	return true;
}

export function markRateAuthorSearch(author: string): void {
	if (typeof sessionStorage === 'undefined') return;
	const trimmed = author.trim();
	if (!trimmed) return;
	sessionStorage.setItem(AUTHOR_KEY, trimmed);
}

export function clearRateAuthorSearch(): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.removeItem(AUTHOR_KEY);
}

/**
 * Returns the author anchor once if set (and clears it). Caller should enable author search
 * when the returned value matches the `q` param (case-insensitive).
 */
export function consumeRateAuthorSearch(): string | null {
	if (typeof sessionStorage === 'undefined') return null;
	const raw = sessionStorage.getItem(AUTHOR_KEY);
	sessionStorage.removeItem(AUTHOR_KEY);
	const trimmed = raw?.trim();
	return trimmed ? trimmed : null;
}
