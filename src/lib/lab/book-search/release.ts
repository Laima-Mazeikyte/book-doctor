import { env } from '$env/dynamic/public';
import { artifactBase, fetchJson, joinUrl, resolveWebRoot } from '../release';
import {
	BookRankingFormatError,
	FEATURE_COUNT,
	RANKING_MODES,
	type BookRankingManifest,
	type BookPopulation,
	type RankingMode,
	type RankingPayload
} from './types';
import { buildPopulation } from './ranking';

const DEFAULT_BASE = '/best-book-search-local';
const SUPPORTED_SCHEMA_VERSIONS = [2];

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
	for (const mode of RANKING_MODES) {
		const model = manifest.model?.[mode];
		if (!model || !Array.isArray(model.features) || model.features.length !== FEATURE_COUNT) {
			throw new BookRankingFormatError(`Manifest model ${mode} must declare three features.`);
		}
		if (
			!Array.isArray(model.default_weights) ||
			model.default_weights.length !== FEATURE_COUNT ||
			!Array.isArray(model.sigma_z) ||
			model.sigma_z.length !== FEATURE_COUNT ||
			model.sigma_z.some((row) => !Array.isArray(row) || row.length !== FEATURE_COUNT)
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
			if (!Array.isArray(preset.weights) || preset.weights.length !== FEATURE_COUNT) {
				throw new BookRankingFormatError(`Preset "${preset.name}" does not match ${mode}.`);
			}
		}
		const itemCount = manifest.quality?.items?.[mode];
		if (!Number.isInteger(itemCount) || itemCount < 0) {
			throw new BookRankingFormatError(`Manifest does not report the ${mode} item count.`);
		}
	}
}

export async function loadRelease(): Promise<Release> {
	const base = artifactBase(env.PUBLIC_BOOK_RANKINGS_BASE, DEFAULT_BASE);
	const webRoot = await resolveWebRoot(base);
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
