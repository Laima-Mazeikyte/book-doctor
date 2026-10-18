import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { coverUrlForBookId } from '$lib/book-cover';
import { parseCorrectionChanges, type CorrectionContext } from '$lib/corrections/model';
import { requireAccessToken } from '$lib/server/requestAuth';
import { createSupabaseWithAuth } from '$lib/server/supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function registeredClient(request: Request) {
	const token = requireAccessToken(request);
	const client = createSupabaseWithAuth(token);
	const { data, error: authError } = await client.auth.getUser(token);
	if (authError || !data.user) error(401, 'Please sign in again.');
	if (data.user.is_anonymous)
		error(403, 'A registered account is required to suggest corrections.');
	return client;
}

function bookId(value: unknown): string {
	if (typeof value !== 'string' || !/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(value))
		error(400, 'Invalid book ID.');
	return value;
}

function rpcError(failure: { code?: string; message?: string }): never {
	const code = failure.code;
	if (code === 'PT429')
		error(
			429,
			'You have reached the limit of 20 corrections in 24 hours. Try again when a slot becomes available.'
		);
	if (code === 'PT409' || code === '23505')
		error(409, 'This proposal has changed. Close and reopen the form to load the latest version.');
	if (code === 'PT404') error(404, 'Book or pending proposal unavailable.');
	if (code === 'PT403') error(403, 'A registered account is required to suggest corrections.');
	if (code === '22023') error(400, failure.message ?? 'Invalid proposed changes.');
	console.error('[book-corrections] Database request failed', code);
	error(500, 'Could not save or load your proposal. Please try again.');
}

async function resolveContext(
	data: unknown,
	id: string,
	client: Awaited<ReturnType<typeof registeredClient>>
): Promise<CorrectionContext> {
	const context = data as CorrectionContext;
	// Older correction contexts can omit the year. Read its catalog value rather than
	// silently opening an empty input or using stale metadata from the book card.
	if (!context.catalog.year) {
		const { data: book, error: failure } = await client
			.from('books')
			.select('year')
			.eq('book_id', id)
			.maybeSingle();
		if (failure) rpcError(failure);
		context.catalog.year = book?.year == null ? '' : String(book.year);
	} else context.catalog.year = String(context.catalog.year);
	// Covers are derived from the stable catalog ID, not the legacy cover_url column.
	const coverUrl = coverUrlForBookId(id) ?? '';
	context.catalog.coverUrl = coverUrl;
	for (const proposal of context.pending) {
		proposal.original_values.coverUrl = coverUrl;
		proposal.original_values.year = String(proposal.original_values.year ?? context.catalog.year);
	}
	return context;
}

export const GET: RequestHandler = async ({ request, url }) => {
	const client = await registeredClient(request);
	const id = bookId(url.searchParams.get('book_id'));
	const { data, error: failure } = await client.rpc('get_book_correction_context', {
		p_book_id: id
	});
	if (failure) rpcError(failure);
	return json(await resolveContext(data, id, client), {
		headers: { 'Cache-Control': 'private, no-store' }
	});
};

export const POST: RequestHandler = async ({ request }) => {
	const client = await registeredClient(request);
	const body = await readBody(request);
	const id = bookId(body.book_id);
	if (typeof body.id !== 'string' || !UUID.test(body.id)) error(400, 'Invalid proposal ID.');
	let changes;
	try {
		changes = parseCorrectionChanges(body.changes);
	} catch (failure) {
		error(400, failure instanceof Error ? failure.message : 'Invalid proposed changes.');
	}
	const { data, error: failure } = await client.rpc('save_book_correction', {
		p_book_id: id,
		p_id: body.id,
		p_changes: changes
	});
	if (failure) rpcError(failure);
	return json(await resolveContext(data, id, client), {
		headers: { 'Cache-Control': 'private, no-store' }
	});
};

export const DELETE: RequestHandler = async ({ request }) => {
	const client = await registeredClient(request);
	const body = await readBody(request);
	if (typeof body.id !== 'string' || !UUID.test(body.id)) error(400, 'Invalid proposal ID.');
	const { error: failure } = await client.rpc('withdraw_book_correction', { p_id: body.id });
	if (failure) rpcError(failure);
	return new Response(null, { status: 204 });
};

async function readBody(request: Request): Promise<Record<string, unknown>> {
	// Bound the body before parsing, including requests without Content-Length.
	const reader = request.body?.getReader();
	if (!reader) error(400, 'Invalid request.');
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > 100000) {
			await reader.cancel();
			error(413, 'The proposed changes are too large.');
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	try {
		const body = JSON.parse(new TextDecoder().decode(bytes));
		if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
		return body;
	} catch {
		error(400, 'Invalid request.');
	}
}
