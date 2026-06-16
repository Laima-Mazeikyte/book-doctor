export const MAIN_NAV_PATHS = new Set([
	'/',
	'/rate',
	'/my-bookshelf',
	'/rate/recommendations',
	'/faq'
]);

export function isMainNavPath(pathname: string): boolean {
	return MAIN_NAV_PATHS.has(pathname);
}

export function shouldMainNavPageTransition(from: string, to: string): boolean {
	return from !== to && isMainNavPath(from) && isMainNavPath(to);
}

export function prefersReducedMotion(): boolean {
	return (
		typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
	);
}
