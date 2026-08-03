import { env } from '$env/dynamic/public';

/**
 * Maintenance mode is a build/deploy-time switch: set the env vars below and redeploy.
 * We read from `$env/dynamic/public` (not `static`) so an unset var is simply `undefined`
 * and normal deploys don't need to declare it.
 */

/** Whether the site is in maintenance mode. Toggle with PUBLIC_MAINTENANCE_MODE=true. */
export const MAINTENANCE_ON = env.PUBLIC_MAINTENANCE_MODE === 'true';

/** Absolute ISO 8601 UTC timestamp for when we expect to be back (e.g. 2026-07-03T18:00:00Z). */
export const MAINTENANCE_UNTIL = env.PUBLIC_MAINTENANCE_UNTIL ?? '';

/** Page routes that stay reachable while maintenance mode is on. */
const ALLOWED_PATHS = new Set([
	'/',
	'/faq',
	'/lab',
	'/lab/author-connections',
	'/lab/author-prominence',
	'/lab/book-search'
]);

/**
 * True if a request path should be served normally during maintenance.
 *
 * On Netlify, static assets and framework chunks are served by the CDN and never reach the
 * server hook — but in `vite dev`/`preview` they do, so we also allow `/_app/*` and any path
 * with a file extension. That keeps the allowed pages fully styled/hydrated everywhere.
 */
export function isAllowedDuringMaintenance(pathname: string): boolean {
	if (ALLOWED_PATHS.has(pathname)) return true;
	if (pathname.startsWith('/_app/')) return true;
	// Files with an extension (css, js, fonts, images, favicon, robots.txt, …).
	if (/\.[^/]+$/.test(pathname)) return true;
	return false;
}
