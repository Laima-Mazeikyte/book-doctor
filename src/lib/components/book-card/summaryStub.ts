import type { Book } from '$lib/types/book';

/** Placeholder until API returns real summaries. Swap to `book.summary` when backend is ready. */
export const BOOK_SUMMARY_PLACEHOLDER =
	'Concrete sidewalks crack under the weight of history as a young man navigates the geography of his own upbringing. These poems map the precise intersection where personal memory meets the systemic pressures of a changing neighborhood. Every stanza acts as a pulse check on the fragile stability of a life built amidst shifting urban landscapes.';

/** Prefer catalog summary when present; otherwise stub. */
export function getBookDisplaySummary(book: Book): string {
	const s = book.summary?.trim();
	return s && s.length > 0 ? s : BOOK_SUMMARY_PLACEHOLDER;
}
