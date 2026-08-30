import { env } from '$env/dynamic/public';
import { artifactBase, fetchJson, joinUrl, resolveWebRoot } from '../release';
import { buildPopulation, MIN_RAW_VARIANCE, rawVariance, validateCorrelationMatrix } from './score';
import { validateReleaseSimplex } from './simplex';
import { PUBLIC_PRESET_NAME } from './contract';
import {
	ProminenceFormatError,
	type Population,
	type Preset,
	type ProminenceDetailManifest,
	type ProminenceManifest
} from './types';

const SUPPORTED_SCHEMA_VERSIONS = [2];
export const SUPPORTED_DETAIL_SCHEMA_VERSIONS = [1] as const;
const REQUIRED_FEATURES = ['regard', 'reach', 'recognition'] as const;
const WEIGHT_TOLERANCE = 0.000001;

export interface Release {
	base: string;
	webRoot: string;
	manifest: ProminenceManifest;
	population: Population;
	/** The tested default preset and correct initial selection. */
	settledPreset: Preset;
}

/** Resolve the required public artifact root without permitting a local fallback. */
export function resolveProminenceArtifactBase(configured: string | undefined): string {
	const base = artifactBase(configured, '');
	if (!base) {
		throw new ProminenceFormatError(
			'PUBLIC_AUTHOR_PROMINENCE_BASE is required; author prominence is served from Supabase Storage.'
		);
	}
	return base;
}

function finite(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function validateWeightVector(label: string, weights: unknown, length: number): void {
	if (!Array.isArray(weights) || weights.length !== length || !weights.every(finite))
		throw new ProminenceFormatError(`${label} must contain ${length} finite weights.`);
	if (weights.some((weight) => weight < 0))
		throw new ProminenceFormatError(`${label} cannot contain negative weights.`);
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	if (Math.abs(total - 1) > WEIGHT_TOLERANCE)
		throw new ProminenceFormatError(`${label} must sum to 1 within ${WEIGHT_TOLERANCE}.`);
}

function validatePositiveInteger(label: string, value: unknown): asserts value is number {
	if (!Number.isInteger(value) || (value as number) <= 0)
		throw new ProminenceFormatError(`${label} must be a positive integer.`);
}

/** Validate the lazy detail configuration without fetching any detail shard. */
export function validateDetailManifest(
	details: unknown,
	expectedAuthorCount?: number
): asserts details is ProminenceDetailManifest {
	if (!details || typeof details !== 'object')
		throw new ProminenceFormatError('Manifest is missing the author detail configuration.');
	const value = details as Partial<ProminenceDetailManifest>;
	if (!SUPPORTED_DETAIL_SCHEMA_VERSIONS.includes(value.schema_version as 1)) {
		throw new ProminenceFormatError(
			`Unsupported detail schema_version ${value.schema_version}; expected one of ${SUPPORTED_DETAIL_SCHEMA_VERSIONS.join(', ')}.`
		);
	}
	validatePositiveInteger('details.author_count', value.author_count);
	if (expectedAuthorCount !== undefined && value.author_count !== expectedAuthorCount)
		throw new ProminenceFormatError(
			`Detail manifest declares ${value.author_count} authors but authors.json contains ${expectedAuthorCount}.`
		);
	validatePositiveInteger('details.shard_size', value.shard_size);
	validatePositiveInteger('details.shard_count', value.shard_count);
	const expectedShardCount = Math.ceil(value.author_count / value.shard_size);
	if (value.shard_count !== expectedShardCount)
		throw new ProminenceFormatError(
			`details.shard_count must be ${expectedShardCount} for ${value.author_count} authors and shard_size ${value.shard_size}.`
		);
	if (value.index_base !== 0) throw new ProminenceFormatError('details.index_base must be 0.');
	if (typeof value.path_pattern !== 'string' || !value.path_pattern.trim())
		throw new ProminenceFormatError('details.path_pattern must be a non-empty relative JSON path.');
	const pathPattern = value.path_pattern.trim();
	const tokenCount = pathPattern.split('{shard}').length - 1;
	const pathParts = pathPattern.split('/');
	if (
		tokenCount !== 1 ||
		pathPattern.startsWith('/') ||
		pathPattern.includes('\\') ||
		pathPattern.includes('%') ||
		pathPattern.includes('?') ||
		pathPattern.includes('#') ||
		pathPattern.includes(':') ||
		!pathPattern.endsWith('.json') ||
		pathParts.some((part) => !part || part === '.' || part === '..') ||
		/[{}]/.test(pathPattern.replace('{shard}', ''))
	) {
		throw new ProminenceFormatError(
			'details.path_pattern must be a safe relative JSON path containing exactly one {shard}.'
		);
	}
	validatePositiveInteger('details.book_limit', value.book_limit);
	validatePositiveInteger('details.recognition_record_limit', value.recognition_record_limit);
	if (typeof value.peak_method !== 'string' || !value.peak_method.trim())
		throw new ProminenceFormatError('details.peak_method must be a non-empty string.');
	if (
		typeof value.peak_weight_quantum !== 'number' ||
		!Number.isFinite(value.peak_weight_quantum) ||
		value.peak_weight_quantum <= 0 ||
		value.peak_weight_quantum > 1
	)
		throw new ProminenceFormatError(
			'details.peak_weight_quantum must be a finite value in (0, 1].'
		);
	if (typeof value.generated_utc !== 'string' || !value.generated_utc.trim())
		throw new ProminenceFormatError('details.generated_utc must be present.');
}

/** Validate the complete schema-2 release contract before any UI or worker starts. */
export function validateManifest(manifest: ProminenceManifest, expectedAuthorCount?: number): void {
	if (!manifest || typeof manifest !== 'object')
		throw new ProminenceFormatError('Manifest must be a JSON object.');
	if (!SUPPORTED_SCHEMA_VERSIONS.includes(manifest?.schema_version)) {
		throw new ProminenceFormatError(
			`Unsupported manifest schema_version ${manifest?.schema_version}; expected one of ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}.`
		);
	}
	if (
		typeof manifest.version !== 'string' ||
		!manifest.version.trim() ||
		typeof manifest.generated_utc !== 'string' ||
		!manifest.generated_utc.trim()
	) {
		throw new ProminenceFormatError('Manifest must declare a release version and generated_utc.');
	}
	validateDetailManifest(manifest.details, expectedAuthorCount);
	const model = manifest.model;
	const features = model?.features;
	if (
		!Array.isArray(features) ||
		features.length !== REQUIRED_FEATURES.length ||
		new Set(features).size !== REQUIRED_FEATURES.length ||
		REQUIRED_FEATURES.some((feature) => !features.includes(feature))
	) {
		throw new ProminenceFormatError(
			`schema_version 2 must contain exactly one each of ${REQUIRED_FEATURES.join(', ')} in model.features.`
		);
	}
	for (const feature of REQUIRED_FEATURES) {
		if (
			typeof model.feature_labels?.[feature] !== 'string' ||
			!model.feature_labels[feature].trim()
		)
			throw new ProminenceFormatError(`Manifest is missing a label for ${feature}.`);
		if (
			typeof model.feature_blurbs?.[feature] !== 'string' ||
			!model.feature_blurbs[feature].trim()
		)
			throw new ProminenceFormatError(`Manifest is missing a blurb for ${feature}.`);
	}
	validateCorrelationMatrix(model.sigma_z, features.length);
	// Validate every non-negative lens, not only the named presets. The worker accepts
	// continuous weights, so a release that merely tests its presets can still expose an
	// undefined denominator through an interior or edge gesture.
	validateReleaseSimplex(model.sigma_z);
	validateWeightVector('model.default_weights', model.default_weights, features.length);
	const defaultVariance = rawVariance(model.default_weights, model.sigma_z);
	if (!Number.isFinite(defaultVariance) || defaultVariance <= MIN_RAW_VARIANCE)
		throw new ProminenceFormatError(
			'model.default_weights must have usable positive raw variance.'
		);
	if (
		!finite(model.index_base) ||
		!finite(model.index_scale) ||
		typeof model.index_is_calibrated_elo !== 'boolean'
	)
		throw new ProminenceFormatError('Manifest model calibration fields are not finite.');
	if (model.tier_weights !== undefined) {
		if (
			!Array.isArray(model.tier_weights) ||
			!model.tier_weights.length ||
			!model.tier_weights.every((value) => finite(value) && value >= 0)
		)
			throw new ProminenceFormatError('model.tier_weights must be finite and nonnegative.');
	}
	if (typeof model.mode !== 'string' || !model.mode.trim())
		throw new ProminenceFormatError('Manifest is missing a usable model mode.');
	if (model.gate !== undefined) {
		if (!model.gate || typeof model.gate !== 'object')
			throw new ProminenceFormatError('Manifest eligibility gate must be an object.');
		if (Object.prototype.hasOwnProperty.call(model.gate, 'min_clean_likes'))
			throw new ProminenceFormatError('schema_version 2 must not contain min_clean_likes.');
		if (
			model.gate.min_books !== undefined &&
			(!Number.isInteger(model.gate.min_books) || model.gate.min_books < 1)
		)
			throw new ProminenceFormatError(
				'model.gate.min_books must be a positive integer when supplied.'
			);
	}
	if (
		!Number.isInteger(manifest.display?.top_n) ||
		manifest.display.top_n < 1 ||
		manifest.display.top_n > 250
	)
		throw new ProminenceFormatError('display.top_n must be an integer between 1 and 250.');

	if (!Array.isArray(manifest.presets) || manifest.presets.length === 0)
		throw new ProminenceFormatError('Release ships no presets.');
	const presetNames = new Set<string>();
	let settledCount = 0;
	for (const preset of manifest.presets) {
		if (!preset || typeof preset !== 'object')
			throw new ProminenceFormatError('Every preset must be a JSON object.');
		if (!preset.name?.trim() || presetNames.has(preset.name))
			throw new ProminenceFormatError('Preset names must be non-empty and unique.');
		presetNames.add(preset.name);
		if (preset.settled) settledCount += 1;
		if (typeof preset.note !== 'string')
			throw new ProminenceFormatError(`Preset "${preset.name}" has no note.`);
		validateWeightVector(`Preset "${preset.name}"`, preset.weights, features.length);
		const variance = rawVariance(preset.weights, model.sigma_z);
		if (!Number.isFinite(variance) || variance <= MIN_RAW_VARIANCE)
			throw new ProminenceFormatError(`Preset "${preset.name}" has unusable raw variance.`);
	}
	if (settledCount !== 1)
		throw new ProminenceFormatError('Release must contain exactly one tested default preset.');
	const settledPreset = manifest.presets.find((preset) => preset.settled);
	if (!settledPreset || settledPreset.name !== PUBLIC_PRESET_NAME)
		throw new ProminenceFormatError(
			`The tested default preset must be named "${PUBLIC_PRESET_NAME}".`
		);
	if (
		settledPreset.weights.some(
			(weight, index) => Math.abs(weight - manifest.model.default_weights[index]) > WEIGHT_TOLERANCE
		)
	) {
		throw new ProminenceFormatError(
			'The tested default preset must match model.default_weights within the release tolerance.'
		);
	}
	if (!manifest.audit?.regard_only?.rule || !manifest.audit?.reach_only?.rule)
		throw new ProminenceFormatError('Manifest is missing the audit rules that drive the badges.');
	if (!finite(manifest.audit.regard_only.rule.min_regard_z))
		throw new ProminenceFormatError('The regard-only audit threshold is not finite.');
	if (
		!finite(manifest.audit.reach_only.rule.max_regard_z) ||
		!finite(manifest.audit.reach_only.rule.min_reach_z) ||
		!finite(manifest.audit.reach_only.rule.max_recognition_z) ||
		!finite(manifest.audit.reach_only.rule.min_reach_share) ||
		manifest.audit.reach_only.rule.min_reach_share < 0
	) {
		throw new ProminenceFormatError('The reach-only audit thresholds are not usable.');
	}
	if (
		typeof manifest.disclosure?.headline !== 'string' ||
		!manifest.disclosure.headline.trim() ||
		!Array.isArray(manifest.disclosure.items) ||
		manifest.disclosure.items.length < 2 ||
		!manifest.disclosure.items.every((item) => typeof item === 'string' && item.trim())
	)
		throw new ProminenceFormatError('Manifest disclosure copy is missing.');
	if (
		!Number.isInteger(manifest.quality?.eligible_authors) ||
		!Number.isInteger(manifest.quality.authors_in_source) ||
		manifest.quality.eligible_authors <= 0 ||
		manifest.quality.authors_in_source < manifest.quality.eligible_authors ||
		(manifest.quality.folds !== undefined &&
			(!Number.isInteger(manifest.quality.folds) || manifest.quality.folds <= 0))
	) {
		throw new ProminenceFormatError('Manifest quality metadata is not usable.');
	}
}

export async function loadRelease(): Promise<Release> {
	const base = resolveProminenceArtifactBase(env.PUBLIC_AUTHOR_PROMINENCE_BASE);
	const webRoot = await resolveWebRoot(base, env.PUBLIC_AUTHOR_PROMINENCE_VERSION);
	const [manifest, authorsPayload] = await Promise.all([
		fetchJson<ProminenceManifest>(joinUrl(base, webRoot, 'manifest.json')),
		fetchJson<{ columns: string[]; rows: unknown[][] }>(joinUrl(base, webRoot, 'authors.json'))
	]);
	validateManifest(manifest);
	const population = buildPopulation(authorsPayload, manifest);
	validateDetailManifest(manifest.details, population.count);
	if (population.count !== manifest.quality.eligible_authors)
		throw new ProminenceFormatError(
			`authors.json contains ${population.count} authors but release quality metadata declares ${manifest.quality.eligible_authors}.`
		);
	if (manifest.display.top_n > population.count)
		throw new ProminenceFormatError('display.top_n cannot exceed the eligible population.');
	const settledPreset = manifest.presets.find((preset) => preset.settled);
	if (!settledPreset) throw new ProminenceFormatError('Release has no tested default preset.');
	return { base, webRoot, manifest, population, settledPreset };
}
