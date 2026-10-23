import { t } from '$lib/copy';
import type { Book } from '$lib/types/book';

/** Show the catalog summary when present, otherwise an explicit unavailable message. */
export function getBookDisplaySummary(book: Book): string {
	return book.summary?.trim() || t('shared.recommendationCard.noDescription');
}
