import { env } from '$env/dynamic/public';
import { assertConnectionGeometry, ConnectionFormatError } from './decode';
import {
	buildAuthorIndex,
	decodeCommunities,
	decodeSubcommunities,
	type AuthorIndex
} from './authors';
import { artifactBase, fetchJson, joinUrl, resolveWebRoot } from '../release';
import type { AuthorTasteManifest } from './types';

/**
 * Resolves and validates an author-taste release. Store mechanics — base URL, version
 * pointer, JSON fetching — are shared with every other lab project in `../release.ts`; only
 * the env var names and the manifest validation are specific to this one.
 */

const SUPPORTED_SCHEMA_VERSIONS = [3];
const EXPECTED_BUILDER = 'buildAuthorFrontendArtifact.py';

interface CompactPayload {
	columns: string[];
	rows: unknown[][];
}

export interface Release {
	base: string;
	webRoot: string;
	manifest: AuthorTasteManifest;
	index: AuthorIndex;
}

/**
 * Reject anything this frontend cannot render correctly.
 *
 * The retired `author_graph` artifact also had a `schema_version`, on unrelated numbering,
 * so the builder is checked too — pointing `PUBLIC_AUTHOR_FRONTEND_BASE` at the wrong
 * release must fail loudly rather than decode garbage.
 */
function validate(manifest: AuthorTasteManifest): void {
	if (!manifest.created_by?.includes(EXPECTED_BUILDER)) {
		throw new ConnectionFormatError(
			`Release was built by "${manifest.created_by}", not ${EXPECTED_BUILDER} — wrong artifact family.`
		);
	}
	if (!SUPPORTED_SCHEMA_VERSIONS.includes(manifest.schema_version)) {
		throw new ConnectionFormatError(
			`Unsupported manifest schema_version ${manifest.schema_version}; expected one of ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}.`
		);
	}

	const connections = manifest.connections;
	if (!connections) throw new ConnectionFormatError('Release has no connection index.');
	assertConnectionGeometry(
		connections.magic,
		connections.header_bytes,
		connections.record_size_bytes
	);
	if (!Number.isInteger(connections.bucket_count) || connections.bucket_count <= 0) {
		throw new ConnectionFormatError('Manifest is missing a usable connections.bucket_count.');
	}

	// The frontend consumes `directionality_status` verbatim and has a label for each of the
	// five classes; a sixth would render as an unlabelled gap.
	const statuses = manifest.directionality?.statuses;
	if (!statuses || statuses.length !== 5) {
		throw new ConnectionFormatError(
			`Release declares ${statuses?.length ?? 0} directionality statuses; this frontend renders exactly 5.`
		);
	}

	if (!Array.isArray(manifest.authors?.dominant_genres) || !manifest.authors.columns) {
		throw new ConnectionFormatError('Manifest is missing the author column or genre declarations.');
	}
}

export async function loadRelease(): Promise<Release> {
	const base = artifactBase(env.PUBLIC_AUTHOR_FRONTEND_BASE, '');
	if (!base) {
		throw new ConnectionFormatError(
			'PUBLIC_AUTHOR_FRONTEND_BASE is required; author connections are served from Supabase Storage.'
		);
	}
	const webRoot = await resolveWebRoot(base, env.PUBLIC_AUTHOR_FRONTEND_VERSION);

	// Four small payloads in parallel. Neither `map_edges.json` nor `render_edges.json` is
	// fetched: relationships are drawn only around a selected author, from the connection
	// records, so the whole-map edge layers are 4.9 MB the site would never put on screen.
	const [manifest, authorsPayload, communitiesPayload, subcommunitiesPayload] = await Promise.all([
		fetchJson<AuthorTasteManifest>(joinUrl(base, webRoot, 'manifest.json')),
		fetchJson<CompactPayload>(joinUrl(base, webRoot, 'authors.json')),
		fetchJson<CompactPayload>(joinUrl(base, webRoot, 'communities.json')),
		fetchJson<CompactPayload>(joinUrl(base, webRoot, 'subcommunities.json'))
	]);

	validate(manifest);

	const index = buildAuthorIndex({
		rows: authorsPayload.rows,
		// The payload declares its own column order, and it is the one the rows were written
		// against — trusting it over the manifest keeps the two from drifting apart.
		columns: authorsPayload.columns,
		genres: manifest.authors.dominant_genres,
		communities: decodeCommunities(communitiesPayload.rows, communitiesPayload.columns),
		subcommunities: decodeSubcommunities(subcommunitiesPayload.rows, subcommunitiesPayload.columns),
		unassignedColor: manifest.authors.unassigned_color
	});

	return {
		base,
		webRoot,
		manifest,
		index
	};
}

/** Absolute URL for a connection bucket, built from the manifest's own padding rule. */
export function bucketUrl(release: Release, bucket: number): string {
	return joinUrl(
		release.base,
		release.webRoot,
		'connections',
		`${String(bucket).padStart(3, '0')}.bin`
	);
}
