import type { SupabaseClient } from '@supabase/supabase-js';
import type { FlavorEvidence } from '$lib/recommendations/flavorGroups';
import { fetchBooksByUlids } from './catalogBooks';

export async function resolveFlavorReferenceBooks(
	supabase: SupabaseClient,
	evidence: Iterable<FlavorEvidence | undefined>
) {
	const referenceIds = new Set<string>();
	for (const entry of evidence) {
		if (typeof entry?.reference_book_id === 'string') referenceIds.add(entry.reference_book_id);
	}
	const books = await fetchBooksByUlids(supabase, [...referenceIds]);
	return Object.fromEntries(books.map((book) => [book.book_id, book]));
}
