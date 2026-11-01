// Read public lab artifacts and embed a compact comparison reference in the SQL inventory.
// No database connection, account/session access, or remote writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const BAND_LIMITS = [
	['top_0_1_percent', 0.001],
	['top_1_percent', 0.01],
	['top_5_percent', 0.05],
	['top_10_percent', 0.1],
	['top_25_percent', 0.25],
	['below_top_25', 1]
];

/** Independent default-score reference; preserves the lab's combined population and ties. */
export function buildReference(manifest, payload) {
	assert.equal(manifest.schema_version, 2);
	const model = manifest.model.best_items;
	assert.deepEqual([...model.features].sort(), ['reach', 'recognition', 'regard']);
	assert.equal(model.default_weights.length, 3);
	assert.ok(model.default_weights.every((w) => Number.isFinite(w) && w > 0));
	assert.ok(Math.abs(model.default_weights.reduce((a, b) => a + b, 0) - 1) < 1e-6);
	assert.equal(payload.rows.length, manifest.quality.items.best_items);
	assert.ok(payload.rows.length > 0);
	const at = Object.fromEntries(payload.columns.map((name, i) => [name, i]));
	for (const name of [
		'title',
		'item_type',
		'constituent_book_ids',
		...model.features.map((f) => `${f}_z`)
	]) {
		assert.ok(Number.isInteger(at[name]), `Missing ${name}`);
	}
	const variance = model.default_weights.reduce(
		(sum, w, i) =>
			sum +
			model.default_weights.reduce((inner, other, j) => inner + w * model.sigma_z[i][j] * other, 0),
		0
	);
	assert.ok(Number.isFinite(variance) && variance > 0);
	const denominator = Math.sqrt(variance);
	const ranked = payload.rows.map((row, index) => {
		assert.ok(['book', 'series'].includes(row[at.item_type]));
		assert.ok(Array.isArray(row[at.constituent_book_ids]));
		let score = 0;
		for (let f = 0; f < 3; f++) {
			const value = row[at[`${model.features[f]}_z`]];
			assert.ok(typeof value === 'number' && Number.isFinite(value));
			score += model.default_weights[f] * value;
		}
		return { row, index, score: score / denominator };
	});
	ranked.sort(
		(a, b) =>
			b.score - a.score ||
			(a.row[at.title] < b.row[at.title]
				? -1
				: a.row[at.title] > b.row[at.title]
					? 1
					: a.index - b.index)
	);
	const memberships = new Map();
	const ambiguous = new Set();
	for (let position = 0; position < ranked.length; position++) {
		const band = BAND_LIMITS.find(([, limit]) => position + 1 <= ranked.length * limit)[0];
		for (const id of new Set(ranked[position].row[at.constituent_book_ids])) {
			assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
			if (memberships.has(id)) ambiguous.add(id);
			else memberships.set(id, band);
		}
	}
	for (const id of ambiguous) memberships.delete(id);
	const bands = BAND_LIMITS.map(([band]) => {
		const ids = [...memberships]
			.filter(([, value]) => value === band)
			.map(([id]) => id)
			.sort();
		return {
			band,
			book_count: ids.length,
			ids_md5: createHash('md5').update(ids.join('\n'), 'utf8').digest('hex')
		};
	});
	return {
		memberships,
		reference: {
			version: manifest.version,
			population_items: ranked.length,
			series_items: payload.rows.filter((row) => row[at.item_type] === 'series').length,
			mapped_catalog_ids: memberships.size,
			ambiguous_ids_excluded: ambiguous.size,
			features: model.features,
			default_weights: model.default_weights,
			band_rule:
				'1-based default composite rank <= combined population * band share; all mapped series volumes inherit the item band',
			fingerprint_rule:
				'md5 of UTF-8 catalog IDs sorted bytewise, joined with LF, without trailing LF; accidental-difference check, not a security signature',
			bands
		}
	};
}

async function main() {
	const base = new URL(process.argv[2] ?? process.env.PUBLIC_BOOK_RANKINGS_BASE);
	assert.ok(['http:', 'https:'].includes(base.protocol));
	assert.ok(
		!base.username && !base.password && !base.search && !base.hash,
		'Use a public artifact root without credentials or query parameters'
	);
	const fetchBytes = async (path) => {
		const response = await fetch(`${base.href.replace(/\/$/, '')}/${path}`, {
			signal: AbortSignal.timeout(30_000)
		});
		assert.equal(response.status, 200, `Artifact read failed: ${path}`);
		return Buffer.from(await response.arrayBuffer());
	};
	const pointer = JSON.parse(await fetchBytes('current_release.json'));
	const root = pointer.web_root ?? `versions/${pointer.version}/web`;
	assert.match(root, /^versions\/[A-Za-z0-9._-]+\/web$/);
	const manifest = JSON.parse(await fetchBytes(`${root}/manifest.json`));
	assert.match(manifest.datasets.best_items, /^rankings\/[A-Za-z0-9._-]+\.json$/);
	const bytes = await fetchBytes(`${root}/${manifest.datasets.best_items}`);
	const { reference } = buildReference(manifest, JSON.parse(bytes));
	Object.assign(reference, {
		captured_at_utc: new Date().toISOString(),
		artifact_base: base.href.replace(/\/$/, ''),
		web_root: root,
		payload_sha256: createHash('sha256').update(bytes).digest('hex')
	});
	assert.ok(
		!JSON.stringify(reference).includes('$reference$'),
		'Unexpected SQL dollar-quote delimiter in reference metadata'
	);
	const path = new URL('inspect-book-annotations.sql', import.meta.url);
	const sql = await readFile(path, 'utf8');
	const pattern = /-- BEGIN BOOK ANNOTATION REFERENCE[\s\S]*?-- END BOOK ANNOTATION REFERENCE/g;
	assert.equal([...sql.matchAll(pattern)].length, 1, 'Expected exactly one SQL reference block');
	const block = `-- BEGIN BOOK ANNOTATION REFERENCE\n  v_reference jsonb := $reference$\n${JSON.stringify(reference, null, 2)}\n$reference$::jsonb;\n  -- END BOOK ANNOTATION REFERENCE`;
	await writeFile(
		path,
		sql.replace(pattern, () => block)
	);
	console.log(
		JSON.stringify(
			{
				version: reference.version,
				population_items: reference.population_items,
				mapped_catalog_ids: reference.mapped_catalog_ids,
				ambiguous_ids_excluded: reference.ambiguous_ids_excluded,
				bands: reference.bands,
				sql: 'scripts/catalog/inspect-book-annotations.sql'
			},
			null,
			2
		)
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
