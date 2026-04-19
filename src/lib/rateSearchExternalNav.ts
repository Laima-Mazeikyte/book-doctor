/**
 * When the user opens /rate?q=… from another in-app route (e.g. my bookshelf), closing search
 * should return them there (`history.back()`), not leave them on the rate browse feed.
 */
const KEY = 'book-doctor-rate-search-external';

export function markRateSearchOpenedFromOtherRoute(): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.setItem(KEY, '1');
}

export function clearRateSearchExternalEntry(): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.removeItem(KEY);
}

/** Returns true once if the flag was set (and clears it). */
export function consumeRateSearchExternalEntry(): boolean {
	if (typeof sessionStorage === 'undefined') return false;
	if (sessionStorage.getItem(KEY) !== '1') return false;
	sessionStorage.removeItem(KEY);
	return true;
}
