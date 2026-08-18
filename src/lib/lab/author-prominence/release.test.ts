import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProminenceFormatError, type ProminenceManifest } from './types';
import { validateManifest } from './release';

function fixture(): ProminenceManifest {
	return JSON.parse(
		readFileSync(
			resolve(process.cwd(), 'temp/author_prominence/versions/v1/web/manifest.json'),
			'utf8'
		)
	) as ProminenceManifest;
}

describe('schema-1 release contract', () => {
	it('accepts the checked-in release artifact', () => {
		expect(() => validateManifest(fixture())).not.toThrow();
	});

	it('rejects swapped or duplicated feature axes', () => {
		const manifest = fixture();
		manifest.model.features = ['regard', 'regard', 'recognition'];
		expect(() => validateManifest(manifest)).toThrow(ProminenceFormatError);
		const reordered = fixture();
		reordered.model.features = ['recognition', 'regard', 'reach'];
		expect(() => validateManifest(reordered)).not.toThrow();
	});

	it('rejects non-finite or asymmetric covariance', () => {
		const manifest = fixture();
		manifest.model.sigma_z[0][1] = Number.NaN;
		expect(() => validateManifest(manifest)).toThrow(/finite/);
		const asymmetric = fixture();
		asymmetric.model.sigma_z[0][1] = 0.4;
		expect(() => validateManifest(asymmetric)).toThrow(/symmetric/);
	});

	it('requires a positive-definite correlation matrix', () => {
		const indefinite = fixture();
		indefinite.model.sigma_z = [
			[1, -0.6, -0.6],
			[-0.6, 1, -0.6],
			[-0.6, -0.6, 1]
		];
		expect(() => validateManifest(indefinite)).toThrow(/positive-definite/);

		const singular = fixture();
		singular.model.sigma_z = [
			[1, 1, 0],
			[1, 1, 0],
			[0, 0, 1]
		];
		expect(() => validateManifest(singular)).toThrow(/positive-definite/);
	});

	it('enforces correlation diagonals and off-diagonal bounds', () => {
		const diagonal = fixture();
		diagonal.model.sigma_z[0][0] = 1.0001;
		expect(() => validateManifest(diagonal)).toThrow(/diagonal/);

		const outOfRange = fixture();
		outOfRange.model.sigma_z[0][1] = 1.1;
		outOfRange.model.sigma_z[1][0] = 1.1;
		expect(() => validateManifest(outOfRange)).toThrow(/\[-1, 1\]/);
	});

	it('accepts generated floating-point boundary noise', () => {
		const manifest = fixture();
		manifest.model.sigma_z[0][0] = 1 + 5e-9;
		manifest.model.sigma_z[1][1] = 1 - 5e-9;
		expect(() => validateManifest(manifest)).not.toThrow();
	});

	it('rejects a valid matrix when a default or preset has unusable raw variance', () => {
		const manifest = fixture();
		const delta = 1e-13;
		manifest.model.sigma_z = [
			[1, -1 + delta, 0],
			[-1 + delta, 1, 0],
			[0, 0, 1]
		];
		manifest.model.default_weights = [0.5, 0.5, 0];
		manifest.presets[0].weights = [0.5, 0.5, 0];
		expect(() => validateManifest(manifest)).toThrow(/raw variance/);
	});

	it('requires exactly one tested default and normalized nonnegative weights', () => {
		const manifest = fixture();
		manifest.presets[1].settled = true;
		expect(() => validateManifest(manifest)).toThrow(/exactly one/);
		const invalid = fixture();
		invalid.model.default_weights = [2, 0, 0];
		expect(() => validateManifest(invalid)).toThrow(/sum to 1/);
	});
});
