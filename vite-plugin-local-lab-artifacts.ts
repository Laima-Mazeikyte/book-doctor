import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Dev-only static server for locally generated lab artifacts.
 *
 * Lab releases deliberately do **not** live in `static/` — the author-frontend release alone
 * is ~87 MB, which SvelteKit would scan and Vite would copy into the
 * build output. Instead this middleware maps a virtual prefix onto a directory under
 * `temp/` so the frontend fetches the same relative paths it will fetch from Supabase
 * Storage; switching over is then a base-URL change and nothing else.
 *
 * Projects that still have local artifacts can register an instance with its own prefix and
 * root. The author-connections project is intentionally not one of them: its release is served
 * from Supabase Storage only. The plugin name is derived from the prefix because Vite warns on
 * duplicate plugin names.
 *
 * Not registered for `vite build` (`apply: 'serve'`), so production never depends on it.
 */

const CONTENT_TYPES: Record<string, string> = {
	'.json': 'application/json; charset=utf-8',
	'.bin': 'application/octet-stream',
	'.html': 'text/html; charset=utf-8'
};

export interface LocalLabArtifactsOptions {
	/** URL prefix the dev server mounts, e.g. `/author-graph-local`. */
	prefix: string;
	/** Artifact directory, relative to the project root. */
	root: string;
}

export function localLabArtifacts({ prefix, root }: LocalLabArtifactsOptions): Plugin {
	const artifactRoot = resolve(process.cwd(), root);

	return {
		name: `local-lab-artifacts${prefix}`,
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use(prefix, (req, res, next) => {
				const rawPath = (req.url ?? '/').split('?')[0];
				let decoded: string;
				try {
					decoded = decodeURIComponent(rawPath);
				} catch {
					res.statusCode = 400;
					res.end('Bad request');
					return;
				}

				// Resolve inside the artifact root and reject anything that escapes it.
				const target = normalize(join(artifactRoot, decoded));
				if (target !== artifactRoot && !target.startsWith(artifactRoot + sep)) {
					res.statusCode = 403;
					res.end('Forbidden');
					return;
				}

				let size: number;
				try {
					const stat = statSync(target);
					if (!stat.isFile()) {
						next();
						return;
					}
					size = stat.size;
				} catch {
					// A missing pair/inbound shard is a normal "no comparisons" outcome —
					// the frontend relies on 404 meaning empty, not broken.
					res.statusCode = 404;
					res.setHeader('Content-Type', 'text/plain; charset=utf-8');
					res.end('Not found');
					return;
				}

				res.statusCode = 200;
				res.setHeader('Content-Type', CONTENT_TYPES[extname(target)] ?? 'application/octet-stream');
				res.setHeader('Content-Length', String(size));
				/*
				 * Always revalidate. In production these paths carry their release version and
				 * should be uploaded `immutable` — but that guarantee only holds if a rebuild also
				 * gets a new version string, and locally it does not: the generator rewrites
				 * `versions/<name>/` in place all day. Serving `immutable` here pins whatever the
				 * browser saw first, so a regenerated artifact silently never appears and the page
				 * validates a manifest that is no longer on disk. Cheap to revalidate against a
				 * local file; correctness matters more than a dev-only round trip.
				 */
				res.setHeader('Cache-Control', 'no-cache');
				createReadStream(target).pipe(res);
			});
		}
	};
}
