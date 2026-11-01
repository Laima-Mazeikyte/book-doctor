// Validate local backend files and generate SQL Editor files. No network or database access.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Papa from 'papaparse';

const integer = (n) => Number.isInteger(n) && n >= 1 && n <= 2147483647;
const text = (s) => typeof s === 'string' && s.trim().length > 0 && s.length <= 200;
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (v, key) => Object.hasOwn(v, key);
const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
const csvString = (value) => `"${String(value).replaceAll('"', '""')}"`;
// Studio currently rejects SQL requests around 1 MB. Keep optional SQL chunks below it.
export const MAX_SQL_CHUNK_BYTES = 900_000;
function doBlock(body) {
	let delimiter = '$annotation_guard$';
	while (body.includes(delimiter)) delimiter = delimiter.replace('$', '$x');
	return `do ${delimiter}\n${body}\n${delimiter};`;
}

function band(rank, population) {
	for (const [name, share] of [
		['top_0_1_percent', 0.001],
		['top_1_percent', 0.01],
		['top_5_percent', 0.05],
		['top_10_percent', 0.1]
	]) {
		if (rank <= population * share) return name;
	}
	return null;
}

export function validateManifest(manifest) {
	assert.ok(plain(manifest), 'Manifest must be an object');
	assert.ok([1, 2].includes(manifest.schema_version), 'Unsupported annotation schema');
	assert.ok(text(manifest.export_version), 'Missing export version');
	assert.ok(
		typeof manifest.generated_at_utc === 'string' &&
			manifest.generated_at_utc.endsWith('Z') &&
			Number.isFinite(Date.parse(manifest.generated_at_utc)),
		'Invalid UTC export timestamp'
	);
	assert.ok(
		Number.isInteger(manifest.record_count) && manifest.record_count >= 0,
		'Invalid record count'
	);
	assert.equal(manifest.books_file, 'books.jsonl', 'books_file must be books.jsonl');
	for (const subject of ['book', 'author']) {
		const source = manifest.ranking_sources?.[subject];
		assert.ok(
			plain(source) && text(source.version) && integer(source.population_count),
			`Invalid ${subject} ranking source`
		);
		const weights = ['regard', 'reach', 'recognition'].map((key) => source.default_weights?.[key]);
		assert.ok(
			weights.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0) &&
				Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-6,
			`Invalid ${subject} default weights`
		);
	}
}

function ranking(value, source, subject) {
	if (value === null) return null;
	assert.ok(
		plain(value) &&
			integer(value.rank) &&
			value.rank <= source.population_count &&
			own(value, 'band'),
		`Invalid ${subject} ranking`
	);
	assert.equal(
		value.band,
		band(value.rank, source.population_count),
		`Incorrect ${subject} band for rank`
	);
	if (subject === 'book' && own(value, 'series_title'))
		assert.ok(
			value.series_title === null || typeof value.series_title === 'string',
			'Invalid series title'
		);
	return {
		rank: value.rank,
		band: value.band,
		...(subject === 'book' && own(value, 'series_title')
			? { series_title: value.series_title }
			: {})
	};
}

function awards(value) {
	if (value === null) return null;
	assert.ok(Array.isArray(value), 'Awards must be an array or null');
	return value.map((award) => {
		assert.ok(
			plain(award) &&
				[1, 2, 3, 4, 5].includes(award.tier) &&
				typeof award.name === 'string' &&
				award.name.trim() &&
				['winner', 'nominee'].includes(award.status) &&
				own(award, 'year'),
			'Invalid award entry'
		);
		assert.ok(
			award.year === null ||
				(Number.isInteger(award.year) && award.year >= -2147483648 && award.year <= 2147483647),
			'Invalid award year'
		);
		return { tier: award.tier, name: award.name, status: award.status, year: award.year };
	});
}

function series(row) {
	assert.ok(own(row, 'series_title') && own(row, 'series_number'), 'Missing series fields');
	if (row.series_title === null && row.series_number === null)
		return { series_title: null, series_number: null };
	assert.ok(
		typeof row.series_title === 'string' &&
			row.series_title.trim() === row.series_title &&
			row.series_title.length > 0 &&
			!['NA', 'N/A'].includes(row.series_title.toUpperCase()) &&
			typeof row.series_number === 'number' &&
			Number.isFinite(row.series_number) &&
			row.series_number >= 0.01,
		'Invalid series membership: expected canonical title and finite decimal >= 0.01, or null/null'
	);
	return { series_title: row.series_title, series_number: row.series_number };
}

/** A short SQL Editor request schedules the existing atomic importer, then returns. */
export function backgroundApplySql(manifest, hash) {
	const version = sqlString(manifest.export_version);
	const job = sqlString(`book-annotations-${hash.slice(0, 16)}-apply`);
	const run =
		`set statement_timeout = '5min';\nset lock_timeout = '2s';\n` +
		doBlock(`declare
  v_started timestamptz := clock_timestamp();
  v_error_state text;
  v_error_message text;
begin
  begin
    perform private.apply_book_annotation_import(${version});
  exception when query_canceled or others then
    v_error_state := sqlstate;
    v_error_message := sqlerrm;
  end;
  if v_error_state is not null then
    update private.book_annotation_exports set summary = jsonb_build_object(
      'last_background_attempt', jsonb_build_object('status', 'failed',
        'started_at', v_started, 'finished_at', clock_timestamp(),
        'sqlstate', v_error_state, 'message', v_error_message))
    where export_version = ${version} and state = 'staging';
  end if;
  perform cron.unschedule(${job});
end;`);
	return (
		'-- Run INSTEAD OF 99-apply.sql after a successful preview. Database / postgres.\n' +
		'-- Requires existing pg_cron. The job starts at the next minute and removes itself.\n' +
		'-- Failed publication rolls back; inspect 91-status.sql before any retry.\n' +
		transaction(
			doBlock(`begin
  if current_user <> 'postgres' then raise exception 'Run as postgres'; end if;
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron is not installed; use 99-apply.sql or a direct connection';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(19730101, 20261025) then
    raise exception 'An importer transaction is already open; inspect status';
  end if;
  perform 1 from private.book_annotation_exports where export_version = ${version} for update;
  if not found then raise exception 'Export registration is missing'; end if;
  if exists (select 1 from private.book_annotation_exports where export_version = ${version} and state = 'applied') then return; end if;
  if not exists (select 1 from private.book_annotation_exports
    where export_version = ${version} and state = 'staging'
      and payload_sha256 = '${hash}' and manifest = ${sqlString(JSON.stringify(manifest))}::jsonb) then
    raise exception 'Export identity does not match this prepared delivery';
  end if;
  if (select count(*) from private.book_annotation_import_rows where export_version = ${version}) <> ${manifest.record_count} then
    raise exception 'Staging is incomplete';
  end if;
  if exists (select 1 from cron.job where jobname = ${job}) then
    raise exception 'An import job already exists; inspect status';
  end if;
  perform cron.schedule(${job}, '* * * * *', ${sqlString(run)});
end;`)
		) +
		`select jsonb_build_object('export_version', ${version},
  'state', (select state from private.book_annotation_exports where export_version = ${version}),
  'scheduled_job', (select jsonb_build_object('job_id', jobid, 'active', active, 'schedule', schedule)
    from cron.job where jobname = ${job})) as book_annotation_background_schedule;\n`
	);
}

const transaction = (body, timeout = '20s') =>
	`begin;\nset local standard_conforming_strings = on;\nset local statement_timeout = '${timeout}';\nset local lock_timeout = '2s';\n${body}\ncommit;\n`;

/** Pure preparation, also used by the isolated database integration check. */
export function prepareImport(manifest, jsonl, rowsPerFile = 1000) {
	validateManifest(manifest);
	assert.ok(integer(rowsPerFile), 'rowsPerFile must be a positive integer');
	const ids = new Set();
	const rows = jsonl
		.split(/\r?\n/)
		.filter((line) => line.trim())
		.map((line, i) => {
			let row;
			try {
				row = JSON.parse(line);
			} catch {
				throw new Error(`Invalid JSONL at record ${i + 1}`);
			}
			assert.ok(
				plain(row) &&
					['book_id', 'book_ranking', 'author_ranking', 'awards'].every((key) => own(row, key)),
				`Missing required field at record ${i + 1}`
			);
			assert.match(
				row.book_id,
				/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/,
				`Invalid book ID at record ${i + 1}`
			);
			assert.ok(!ids.has(row.book_id), `Repeated book ID at record ${i + 1}`);
			ids.add(row.book_id);
			return {
				book_id: row.book_id,
				book_ranking: ranking(row.book_ranking, manifest.ranking_sources.book, 'book'),
				author_ranking: ranking(row.author_ranking, manifest.ranking_sources.author, 'author'),
				awards: awards(row.awards),
				...(manifest.schema_version === 2 ? series(row) : {})
			};
		});
	assert.equal(rows.length, manifest.record_count, 'Manifest record count does not match JSONL');
	const hash = createHash('sha256').update(jsonl, 'utf8').digest('hex');
	const version = sqlString(manifest.export_version);
	const manifestSql = `${sqlString(JSON.stringify(manifest))}::jsonb`;
	const stageGuard = doBlock(
		`begin\n  perform 1 from private.book_annotation_exports where export_version = ${version} for update;\n  if not exists (select 1 from private.book_annotation_exports where export_version = ${version}\n    and state = 'staging' and payload_sha256 = '${hash}' and manifest = ${manifestSql}) then\n    raise exception 'Export version is absent, already applied, or belongs to different files';\n  end if;\nend;`
	);
	const files = [
		{
			name: '00-begin.sql',
			sql: transaction(
				`insert into private.book_annotation_exports(export_version, manifest, payload_sha256)\nvalues (${version}, ${manifestSql}, '${hash}') on conflict (export_version) do nothing;\n${stageGuard}`
			)
		}
	];
	const rowJson = rows.map((row) => JSON.stringify(row));
	const stagePrefix = `${stageGuard}\ninsert into private.book_annotation_import_rows(export_version, book_id, record)\nselect ${version}, r->>'book_id', r from jsonb_array_elements(`;
	const stageSuffix = ') r\non conflict (export_version, book_id) do nothing;';
	const stageOverhead = Buffer.byteLength(transaction(`${stagePrefix}'[]'::jsonb${stageSuffix}`));
	for (let offset = 0; offset < rows.length; ) {
		let end = offset;
		let bytes = stageOverhead;
		while (end < rows.length && end - offset < rowsPerFile) {
			const nextBytes =
				Buffer.byteLength(rowJson[end].replaceAll("'", "''")) + Number(end > offset);
			if (end > offset && bytes + nextBytes > MAX_SQL_CHUNK_BYTES) break;
			bytes += nextBytes;
			end++;
		}
		const data = `${sqlString(`[${rowJson.slice(offset, end).join(',')}]`)}::jsonb`;
		files.push({
			name: `01-stage-${String(files.length).padStart(4, '0')}.sql`,
			sql: transaction(`${stagePrefix}${data}${stageSuffix}`)
		});
		offset = end;
	}
	files.push({
		name: '99-apply.sql',
		sql: transaction(
			`select private.apply_book_annotation_import(${version}) as book_annotation_import;`,
			'60s'
		)
	});
	const stagingCsv =
		// LF avoids Papa Parse's CRLF chunk-boundary error in Dashboard file uploads.
		'export_version,book_id,record\n' +
		rows
			.map((row, index) =>
				[manifest.export_version, row.book_id, rowJson[index]].map(csvString).join(',')
			)
			.join('\n') +
		(rows.length ? '\n' : '');
	// Exercise both Studio chunk sizes; whole-file parsing misses boundary failures.
	for (const chunkSize of [256 * 1024, 0.1 * 1024 * 1024]) {
		let index = 0;
		Papa.parse(stagingCsv, {
			header: true,
			dynamicTyping: false,
			skipEmptyLines: true,
			chunkSize,
			chunk(result) {
				assert.equal(result.errors.length, 0, 'CSV streaming validation failed');
				for (const record of result.data) {
					assert.ok(
						record.export_version === manifest.export_version &&
							record.book_id === rows[index]?.book_id &&
							record.record === rowJson[index],
						'CSV streaming round-trip changed a record'
					);
					index++;
				}
			}
		});
		assert.equal(index, rows.length, 'CSV streaming row count differs');
	}
	const resetStaging = {
		name: 'reset-staging.sql',
		sql:
			"-- Recovery only: remove this export's private staging rows before retrying a CSV upload.\n" +
			'-- Requires the same reviewed manifest/hash and an export still in staging state.\n' +
			transaction(
				`${stageGuard}\ndelete from private.book_annotation_import_rows where export_version = ${version};`
			)
	};
	return { files, stagingCsv, resetStaging, recordCount: rows.length, payloadSha256: hash };
}

async function main() {
	const args = process.argv.slice(2).filter((arg) => arg !== '--');
	const sqlChunksFlag = args.includes('--sql-chunks');
	const [manifestPath, outputPath, batchArg] = args.filter((arg) => arg !== '--sql-chunks');
	// Preserve the old numeric third argument as an explicit request for SQL chunks.
	const includeSqlChunks = sqlChunksFlag || batchArg !== undefined;
	assert.ok(
		manifestPath && outputPath,
		'Usage: node scripts/prepare-book-annotation-import.mjs <manifest.json> <empty-output-directory> [--sql-chunks] [rows-per-file=1000]'
	);
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	validateManifest(manifest);
	const jsonl = await readFile(join(dirname(resolve(manifestPath)), manifest.books_file), 'utf8');
	const prepared = prepareImport(manifest, jsonl, batchArg === undefined ? 1000 : Number(batchArg));
	const sqlFiles = includeSqlChunks ? prepared.files : [prepared.files[0], prepared.files.at(-1)];
	if (includeSqlChunks)
		assert.ok(
			sqlFiles.every((file) => Buffer.byteLength(file.sql) <= MAX_SQL_CHUNK_BYTES),
			'A record is too large for SQL Editor chunks. Use the default CSV package instead.'
		);
	const preview = (
		await readFile(
			new URL(
				manifest.schema_version === 2
					? 'catalog/preview-book-series-import.sql'
					: 'catalog/preview-book-annotation-import.sql',
				import.meta.url
			),
			'utf8'
		)
	).replace(
		"'book-annotations-test-001'::text",
		() => `${sqlString(manifest.export_version)}::text`
	);
	await mkdir(outputPath, { recursive: true });
	assert.equal((await readdir(outputPath)).length, 0, 'Output directory must be empty');
	for (const file of [...sqlFiles, { name: '90-preview.sql', sql: preview }, prepared.resetStaging])
		await writeFile(join(outputPath, file.name), file.sql, { flag: 'wx' });
	await writeFile(
		join(outputPath, '98-apply-background.sql'),
		backgroundApplySql(manifest, prepared.payloadSha256),
		{ flag: 'wx' }
	);
	const status = (
		await readFile(new URL('catalog/book-annotation-import-status.sql', import.meta.url), 'utf8')
	).replace(
		"'book-annotations-test-001'::text",
		() => `${sqlString(manifest.export_version)}::text`
	);
	await writeFile(join(outputPath, '91-status.sql'), status, { flag: 'wx' });
	if (manifest.schema_version === 2)
		await writeFile(
			join(outputPath, '00-series-number-range.sql'),
			await readFile(
				new URL('../supabase/migrations/20261028010000_series_number_range.sql', import.meta.url),
				'utf8'
			),
			{ flag: 'wx' }
		);
	if (manifest.schema_version === 2)
		await writeFile(
			join(outputPath, 'verify-series.sql'),
			await readFile(new URL('catalog/verify-book-series.sql', import.meta.url), 'utf8'),
			{ flag: 'wx' }
		);
	await writeFile(join(outputPath, '01-staging.csv'), prepared.stagingCsv, { flag: 'wx' });
	await writeFile(
		join(outputPath, 'README.md'),
		`# Dashboard import: ${manifest.export_version}\n\n` +
			`This package contains ${prepared.recordCount.toLocaleString('en')} validated records. It preserves the backend export as supplied, including any known source-data issues.\n\n` +
			'The CSV uses LF line endings and is checked with both Dashboard streaming chunk sizes. This avoids the parser error caused by a CRLF pair split between chunks.\n\n' +
			(manifest.schema_version === 2
				? "Install supabase/migrations/20261028000000_book_series.sql once, then run this package's 00-series-number-range.sql before staging. Series storage/import does not require slugs. The separate 20261028020000_series_book_detail.sql page function can wait until public book slugs are installed. The range update supports real volumes above 100 on both earlier and current series installations. No live database was accessed while creating this package.\n\n"
				: 'Use the existing installed v1 annotation schema. No new migration or extra table permissions are needed. No live database was accessed while creating this package.\n\n') +
			'## Import with one CSV upload\n\n' +
			"1. Run 00-begin.sql in SQL Editor, source Database, role postgres. If you already ran this exact export's begin file successfully, continue to the upload.\n" +
			'2. In Table Editor select schema private, table book_annotation_import_rows, and role postgres. Choose Insert > Import data from CSV and select 01-staging.csv. Keep all three columns: export_version, book_id, record. The dashboard uploads its own chunks automatically; wait for completion. Import into the existing table, not public.books or a new table.\n' +
			`3. Run 90-preview.sql in SQL Editor. staged_books must be ${prepared.recordCount}; invalid counts must be zero and ready_to_apply true.\n` +
			'4. Run 98-apply-background.sql to publish atomically through existing pg_cron without waiting on the Dashboard request. Then run 91-status.sql: state must become applied. Alternatively run 99-apply.sql directly; do not run both. Inspect status after any timeout before retrying.\n' +
			'5. Run scripts/catalog/verify-book-annotations.sql again. invalid_annotations must be zero.\n\n' +
			(manifest.schema_version === 2
				? 'Also run verify-series.sql. invalid_memberships and orphan_series must be zero. series_detail_rpc may be null while the separate page function is deferred; once installed, it must be stable/security invoker and executable by anon/authenticated readers.\n\n'
				: '') +
			'Only final apply updates visible book annotations. Omitted books remain unchanged; unmatched IDs are not inserted; explicit null clears the corresponding previous annotation. The existing books.updated_at trigger advances on updated books.\n\n' +
			'## If the CSV upload was interrupted\n\n' +
			"Dashboard CSV inserts do not upsert duplicate keys. If this export is partially staged, run reset-staging.sql and then upload the entire CSV again. The reset removes only this export's private staging rows, checks the manifest/hash, and refuses an already-applied export. It never clears book annotations. If preview already shows all expected rows, skip re-uploading and continue with preview/apply.\n\n" +
			'After publication, both apply paths recognize the applied version; background scheduling becomes a no-op. Begin/reset/upload are staging operations, not publication retries. Use a new export_version for corrected source files once this version has been staged or applied.\n\n' +
			(includeSqlChunks
				? '## Optional SQL chunks\n\nIndividual 01-stage-*.sql files are also included as an alternative transport. They are byte-limited below the SQL Editor request cap. Use either CSV or SQL chunks for staging, not both.\n\n'
				: '') +
			`Original JSONL SHA-256: ${prepared.payloadSha256}\n`,
		{ flag: 'wx' }
	);
	console.log(
		JSON.stringify(
			{
				records: prepared.recordCount,
				preferred_transport: 'dashboard_csv',
				staging_csv: '01-staging.csv',
				staging_csv_bytes: Buffer.byteLength(prepared.stagingCsv),
				sql_files: sqlFiles.length + 4 + 2 * Number(manifest.schema_version === 2),
				optional_sql_chunks: includeSqlChunks,
				output_directory: resolve(outputPath),
				payload_sha256: prepared.payloadSha256,
				live_database_access: false
			},
			null,
			2
		)
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
