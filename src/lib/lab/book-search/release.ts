import { env } from '$env/dynamic/public';
import { artifactBase, fetchJson, joinUrl, resolveWebRoot } from '../release';
import {
	BookRankingFormatError,
	RANKING_MODES,
	type BookRankingManifest,
	type BookPopulation,
	type RankingMode,
	type RankingPayload
} from './types';
import { buildPopulation } from './ranking';

const DEFAULT_BASE = '/best-book-search-local';
const SUPPORTED_SCHEMA_VERSIONS = [1];

export interface Release {
	base: string;
	webRoot: string;
	manifest: BookRankingManifest;
}

function validate(manifest: BookRankingManifest): void {
	if (!SUPPORTED_SCHEMA_VERSIONS.includes(manifest.schema_version)) {
		throw new BookRankingFormatError(
			`Unsupported manifest schema_version ${manifest.schema_version}; expected one of ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}.`
		);
	}
	if (!Number.isInteger(manifest.display?.top_n) || manifest.display.top_n <= 0) {
		throw new BookRankingFormatError('Manifest is missing a usable display.top_n.');
	}

	for (const mode of RANKING_MODES) {
		const model = manifest.model?.[mode];
		if (!model || model.features.length !== 3) {
			throw new BookRankingFormatError(`Manifest model ${mode} must declare three features.`);
		}
		if (
			!Array.isArray(model.default_weights) ||
			model.default_weights.length !== model.features.length ||
			!Array.isArray(model.sigma_z) ||
			model.sigma_z.length !== model.features.length ||
			model.sigma_z.some((row) => !Array.isArray(row) || row.length !== model.features.length)
		) {
			throw new BookRankingFormatError(
				`Manifest model ${mode} has incompatible scoring dimensions.`
			);
		}
		if (!manifest.datasets?.[mode]) {
			throw new BookRankingFormatError(`Manifest does not name the ${mode} dataset.`);
		}
		if (!Array.isArray(manifest.presets?.[mode]) || manifest.presets[mode].length === 0) {
			throw new BookRankingFormatError(`Manifest ships no presets for ${mode}.`);
		}
		for (const preset of manifest.presets[mode]) {
			if (!Array.isArray(preset.weights) || preset.weights.length !== model.features.length) {
				throw new BookRankingFormatError(`Preset "${preset.name}" does not match ${mode}.`);
			}
		}
	}
}

export async function loadRelease(): Promise<Release> {
	const base = artifactBase(env.PUBLIC_BOOK_RANKINGS_BASE, DEFAULT_BASE);
	const webRoot = await resolveWebRoot(base, env.PUBLIC_BOOK_RANKINGS_VERSION);
	const manifest = await fetchJson<BookRankingManifest>(joinUrl(base, webRoot, 'manifest.json'));
	validate(manifest);
	return { base, webRoot, manifest };
}

export async function loadDataset(release: Release, mode: RankingMode): Promise<BookPopulation> {
	const payload = await fetchJson<RankingPayload>(
		joinUrl(release.base, release.webRoot, release.manifest.datasets[mode])
	);
	return buildPopulation(payload, release.manifest, mode);
}
