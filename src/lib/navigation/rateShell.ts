/** Routes where first paint should prioritize /api/feed/latest over library hydration. */
export function isRateShellPath(pathname: string): boolean {
	return pathname === '/rate' || pathname.startsWith('/rate/');
}
