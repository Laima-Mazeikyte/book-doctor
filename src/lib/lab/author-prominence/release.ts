import { env } from '$env/dynamic/public';
import { artifactBase, fetchJson, joinUrl, resolveWebRoot } from '../release';
import { buildPopulation } from './score';
import {
	ProminenceFormatError,
	type Population,
	type Preset,
	type ProminenceManifest
} from './types';

/**
 * Resolves and validates an author-prominence release. Store mechanics — base URL, version
 * pointer, JSON fetching — are shared with every other lab project in `../release.ts`;
 * only the env var names and the manifest validation are specific to this one.
 */

const DEFAULT_BASE = '/author-prominence-local';
const SUPPORTED_SCHEMA_VERSIONS = [1];

export interface Release {
	base: string;
	webRoot: string;
	manifest: ProminenceManifest;
	population: Population;
	/** The tested default preset — the correct initial selection. */
	settledPreset: Preset;
}

function validate(manifest: ProminenceManifest): void {
	if (!SUPPORTED_SCHEMA_VERSIONS.includes(manifest.schema_version)) {
		throw new ProminenceFormatError(
			`Unsupported manifest schema_version ${manifest.schema_version}; expected one of ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}.`
		);
	}

	const model = manifest.model;
	const features = model.features;
	if (!Array.isArray(features) || features.length === 0) {
		throw new ProminenceFormatError('Manifest declares no model features.');
	}

	// `sigma_z` and every weight vector are indexed by `features` order, so a mismatch
	// here would silently score the wrong feature rather than fail.
	if (!Array.isArray(model.sigma_z) || model.sigma_z.length !== features.length) {
		throw new ProminenceFormatError(
			`sigma_z must be ${features.length}×${features.length} to match model.features.`
		);
	}
	for (const row of model.sigma_z) {
		if (!Array.isArray(row) || row.length !== features.length) {
			throw new ProminenceFormatError(
				`sigma_z must be ${features.length}×${features.length} to match model.features.`
			);
		}
	}
	if (!Array.isArray(model.default_weights) || model.default_weights.length !== features.length) {
		throw new ProminenceFormatError('default_weights does not match model.features.');
	}

	if (!Array.isArray(manifest.presets) || manifest.presets.length === 0) {
		throw new ProminenceFormatError('Release ships no presets.');
	}
	for (const preset of manifest.presets) {
		if (!Array.isArray(preset.weights) || preset.weights.length !== features.length) {
			throw new ProminenceFormatError(`Preset "${preset.name}" does not match model.features.`);
		}
	}

	if (!manifest.audit?.regard_only?.rule || !manifest.audit?.reach_only?.rule) {
		throw new ProminenceFormatError('Manifest is missing the audit rules that drive the badges.');
	}

	if (!Number.isFinite(manifest.display?.top_n) || manifest.display.top_n <= 0) {
		throw new ProminenceFormatError('Manifest is missing a usable display.top_n.');
	}
}

export async function loadRelease(): Promise<Release> {
	const base = artifactBase(env.PUBLIC_AUTHOR_PROMINENCE_BASE, DEFAULT_BASE);
	const webRoot = await resolveWebRoot(base, env.PUBLIC_AUTHOR_PROMINENCE_VERSION);

	const [manifest, authorsPayload] = await Promise.all([
		fetchJson<ProminenceManifest>(joinUrl(base, webRoot, 'manifest.json')),
		fetchJson<{ columns: string[]; rows: unknown[][] }>(joinUrl(base, webRoot, 'authors.json'))
	]);

	validate(manifest);

	return {
		base,
		webRoot,
		manifest,
		population: buildPopulation(authorsPayload, manifest),
		// Exactly one preset is settled, but an unsettled release is still displayable.
		settledPreset: manifest.presets.find((preset) => preset.settled) ?? manifest.presets[0]
	};
}
