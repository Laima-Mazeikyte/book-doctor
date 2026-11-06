/** Public IDs always contain a letter, so historical numeric IDs remain unambiguous. */
export function isPublicRequestId(id: string): boolean {
	return /^[A-Za-z0-9]{8}$/.test(id) && /[A-Za-z]/.test(id);
}

export function requestIdColumn(id: string): 'id' | 'public_id' {
	return isPublicRequestId(id) ? 'public_id' : 'id';
}
