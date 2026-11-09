import type { Book } from '$lib/types/book';

export const SELECTION_MIN = 4;
export const SELECTION_MAX = 200;
export const SELECTION_TYPES = ['rank_selection', 'recommend_from_selection'] as const;
export type SelectionType = (typeof SELECTION_TYPES)[number];
export type SelectionRequest = { request_type: SelectionType; book_ids: string[] };
export type SelectionDrafts = Record<SelectionType, Book[]>;
export type SelectionRun = SelectionRequest & {
	public_id: string;
	status: string;
	result_count: number | null;
	skipped_book_ids?: string[];
	error_code: string | null;
	created_at: string;
};
export type SelectionPending = SelectionRequest & {
	since: number;
	public_id?: string;
	books?: Book[];
	excluded_ids?: string[];
};
export const emptySelectionDrafts = (): SelectionDrafts => ({
	rank_selection: [],
	recommend_from_selection: []
});
export function isSelectionType(value: unknown): value is SelectionType {
	return SELECTION_TYPES.includes(value as SelectionType);
}
export function isCatalogId(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}
export function parseSelectionRequest(value: unknown): SelectionRequest {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('Choose a recommendation mode and 4–200 books.');
	const body = value as Record<string, unknown>;
	if (Object.keys(body).some((key) => key !== 'request_type' && key !== 'book_ids'))
		throw new Error('Unsupported selection fields.');
	if (!isSelectionType(body.request_type)) throw new Error('Choose a valid recommendation mode.');
	if (
		!Array.isArray(body.book_ids) ||
		body.book_ids.length < SELECTION_MIN ||
		body.book_ids.length > SELECTION_MAX
	)
		throw new Error('Choose between 4 and 200 books.');
	if (!body.book_ids.every(isCatalogId))
		throw new Error('One or more books have an invalid catalog ID.');
	if (new Set(body.book_ids).size !== body.book_ids.length)
		throw new Error('Each book can appear only once.');
	return { request_type: body.request_type, book_ids: [...body.book_ids] };
}
export function addSelection(current: Book[], incoming: Book[]): Book[] {
	const seen = new Set(current.map((book) => book.book_id));
	const next = [...current];
	for (const book of incoming) {
		if (next.length >= SELECTION_MAX) break;
		if (!isCatalogId(book.book_id) || seen.has(book.book_id)) continue;
		seen.add(book.book_id);
		next.push(book);
	}
	return next;
}
export function sameSelection(a: SelectionRequest, b: SelectionRequest): boolean {
	const ids = new Set(a.book_ids);
	return (
		a.request_type === b.request_type &&
		ids.size === b.book_ids.length &&
		b.book_ids.every((id) => ids.has(id))
	);
}
export function selectionDraftKey(userId: string): string {
	return `unread:selection-drafts:v1:${userId}`;
}
export function selectionPendingKey(userId: string): string {
	return `unread:selection-pending:v1:${userId}`;
}
export function readSelectionDrafts(
	storage: Pick<Storage, 'getItem'>,
	userId: string
): SelectionDrafts {
	const drafts = emptySelectionDrafts();
	try {
		const raw = JSON.parse(storage.getItem(selectionDraftKey(userId)) ?? 'null');
		for (const mode of SELECTION_TYPES) {
			if (!Array.isArray(raw?.[mode])) continue;
			drafts[mode] = addSelection(
				[],
				raw[mode].filter(
					(book: Book) =>
						book &&
						typeof book.id === 'string' &&
						typeof book.title === 'string' &&
						typeof book.author === 'string'
				)
			);
		}
	} catch {
		/* Storage is optional; in-memory drafts still work. */
	}
	return drafts;
}
export function writeSelectionDrafts(
	storage: Pick<Storage, 'setItem'>,
	userId: string,
	drafts: SelectionDrafts
): void {
	try {
		const value = Object.fromEntries(
			SELECTION_TYPES.map((mode) => [
				mode,
				drafts[mode].map(({ id, book_id, title, author, slug }) => ({
					id,
					book_id,
					title,
					author,
					slug
				}))
			])
		);
		storage.setItem(selectionDraftKey(userId), JSON.stringify(value));
	} catch {
		/* Quota and privacy settings must not prevent editing. */
	}
}
