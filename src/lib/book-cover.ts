import { PUBLIC_BUNNY_COVERS_BASE } from '$env/static/public';

const coversBase = (PUBLIC_BUNNY_COVERS_BASE ?? '').replace(/\/$/, '');

export function coverUrlForBookIdWithBase(
	baseUrl: string | null | undefined,
	bookId: unknown
): string | undefined {
	const base = (baseUrl ?? '').replace(/\/$/, '');
	const id = typeof bookId === 'string' ? bookId.trim() : '';
	return base && id ? `${base}/${id}-720.avif` : undefined;
}

export function coverUrlForBookId(bookId: unknown): string | undefined {
	return coverUrlForBookIdWithBase(coversBase, bookId);
}
