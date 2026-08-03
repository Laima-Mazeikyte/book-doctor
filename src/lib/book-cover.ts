import { PUBLIC_BUNNY_COVERS_BASE } from '$env/static/public';

const coversBase = (PUBLIC_BUNNY_COVERS_BASE ?? '').replace(/\/$/, '');

export function coverUrlForBookIdWithBase(
	baseUrl: string | null | undefined,
	bookId: unknown,
	size = 720
): string | undefined {
	const base = (baseUrl ?? '').replace(/\/$/, '');
	const id = typeof bookId === 'string' ? bookId.trim() : '';
	return base && id ? `${base}/${id}-${size}.avif` : undefined;
}

export function coverUrlForBookId(bookId: unknown): string | undefined {
	return coverUrlForBookIdWithBase(coversBase, bookId);
}

export function coverUrlForBookIdAtSize(bookId: unknown, size: number): string | undefined {
	return coverUrlForBookIdWithBase(coversBase, bookId, size);
}
