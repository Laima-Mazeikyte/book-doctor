import type { PostgrestError } from '@supabase/supabase-js';

type RowsResult<Row> = { data: Row[] | null; error: PostgrestError | null };

// Stay below the project's verified 1,000-row response cap.
export const LIBRARY_PAGE_SIZE = 500;
const BOOK_ID_BATCH_SIZE = 200;

/** Read a deterministically ordered query completely; never publish a partial failed load. */
export async function readAllPages<Row>(
	readPage: (from: number, to: number) => PromiseLike<RowsResult<Row>>,
	isStale: () => boolean = () => false
): Promise<RowsResult<Row>> {
	const rows: Row[] = [];
	while (!isStale()) {
		const result = await readPage(rows.length, rows.length + LIBRARY_PAGE_SIZE - 1);
		if (isStale()) break;
		if (result.error) return { data: null, error: result.error };
		const page = result.data ?? [];
		rows.push(...page);
		if (page.length < LIBRARY_PAGE_SIZE) return { data: rows, error: null };
	}
	return { data: null, error: null };
}

/** Bound both the response size and the URL length of catalog `in(book_id, …)` lookups. */
export async function readBookIdBatches<Row>(
	bookIds: string[],
	readBatch: (ids: string[]) => PromiseLike<RowsResult<Row>>,
	isStale: () => boolean = () => false
): Promise<RowsResult<Row>> {
	const ids = [...new Set(bookIds)];
	const rows: Row[] = [];
	for (let offset = 0; offset < ids.length; offset += BOOK_ID_BATCH_SIZE) {
		if (isStale()) return { data: null, error: null };
		const result = await readBatch(ids.slice(offset, offset + BOOK_ID_BATCH_SIZE));
		if (isStale()) return { data: null, error: null };
		if (result.error) return { data: null, error: result.error };
		rows.push(...(result.data ?? []));
	}
	return { data: rows, error: null };
}
