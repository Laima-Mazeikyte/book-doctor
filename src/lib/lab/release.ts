/**
 * Shared release resolution for lab artifact stores.
 *
 * Every lab project ships the same way: a read-only, versioned artifact tree in a public
 * Supabase Storage bucket, with `current_release.json` at its root naming the live version.
 * The store needs no Supabase client — plain `fetch` against public object paths is enough.
 *
 * Projects may provide a dev-only fallback through `artifactBase` while local artifacts are
 * being developed. Author connections deliberately provide no fallback: their release is
 * served from Supabase Storage only.
 */

export function trimSlashes(value: string): string {
	return value.replace(/^\/+|\/+$/g, '');
}

export function joinUrl(...parts: string[]): string {
	const [head, ...rest] = parts;
	const base = head.replace(/\/+$/, '');
	const tail = rest.map(trimSlashes).filter(Boolean);
	return tail.length ? `${base}/${tail.join('/')}` : base;
}

export async function fetchJson<T>(url: string): Promise<T> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Could not load ${url} (${response.status}).`);
	}
	return (await response.json()) as T;
}

/** The configured artifact base, or the caller's optional dev fallback when unset. */
export function artifactBase(configured: string | undefined, devFallback: string): string {
	const trimmed = configured?.trim();
	return trimmed ? trimmed.replace(/\/+$/, '') : devFallback;
}

/**
 * Resolve the active web root. A pinned version is deterministic and avoids caching
 * concerns around a mutable pointer; without one we fall back to `current_release.json`.
 */
export async function resolveWebRoot(base: string, pinnedVersion?: string): Promise<string> {
	const pinned = pinnedVersion?.trim();
	if (pinned) return `versions/${trimSlashes(pinned)}/web`;

	const pointer = await fetchJson<{ web_root?: string; version?: string }>(
		joinUrl(base, 'current_release.json')
	);
	if (pointer.web_root) return trimSlashes(pointer.web_root);
	if (pointer.version) return `versions/${trimSlashes(pointer.version)}/web`;
	throw new Error('current_release.json did not name a release.');
}
