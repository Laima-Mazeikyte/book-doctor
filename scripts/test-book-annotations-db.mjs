// Docker-only integration check. Never reads .env or contacts a live database.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import {
	MAX_SQL_CHUNK_BYTES,
	prepareImport,
	backgroundApplySql
} from './prepare-book-annotation-import.mjs';

const container = `book-annotations-${randomUUID().slice(0, 8)}`;
const docker = (args, input) =>
	execFileSync('docker', args, {
		input,
		encoding: 'utf8',
		stdio: ['pipe', 'pipe', 'pipe'],
		maxBuffer: 8 * 1024 * 1024
	});
const sql = (query) =>
	docker(
		[
			'exec',
			'-i',
			container,
			'psql',
			'-X',
			'-q',
			'-A',
			'-t',
			'-v',
			'ON_ERROR_STOP=1',
			'-U',
			'postgres'
		],
		query
	).trim();
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const id = (i) => `01${String(i).padStart(24, '0')}`;
const uid = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const user = (query, owner = uid) =>
	JSON.parse(
		sql(
			`begin read only; set local role authenticated; set local request.jwt.claims = '${JSON.stringify({ sub: owner, role: 'authenticated' })}'; ${query} commit;`
		)
	);
const quote = (v) => `'${v.replaceAll("'", "''")}'`;
const preview = (version) =>
	JSON.parse(
		sql(
			read('scripts/catalog/preview-book-annotation-import.sql').replace(
				"'book-annotations-test-001'::text",
				() => `${quote(version)}::text`
			)
		)
	);
const manifest = (version, count) => ({
	schema_version: 1,
	export_version: version,
	generated_at_utc: '2026-10-26T04:30:00Z',
	record_count: count,
	books_file: 'books.jsonl',
	ranking_sources: {
		book: {
			version: 'v9',
			population_count: 1000,
			default_weights: { regard: 0.4, reach: 0.3, recognition: 0.3 }
		},
		author: {
			version: 'v3',
			population_count: 1000,
			default_weights: { regard: 0.35, reach: 0.35, recognition: 0.3 }
		}
	}
});
const award = {
	tier: 1,
	name: "Readers' Choice $annotation_guard$; --",
	status: 'winner',
	year: null
};
const row = (i) => ({
	book_id: id(i),
	book_ranking: { rank: 10, band: 'top_1_percent', series_title: 'Example Series' },
	author_ranking: { rank: 100, band: 'top_10_percent' },
	awards: [award]
});
const prepare = (version, rows, size = 1) =>
	prepareImport(
		manifest(version, rows.length),
		rows.map((r) => JSON.stringify(r)).join('\n'),
		size
	);
const apply = (prepared) => {
	for (const file of prepared.files) sql(file.sql);
};
const checks = [];

try {
	docker([
		'run',
		'--rm',
		'-d',
		'--name',
		container,
		'-e',
		'POSTGRES_HOST_AUTH_METHOD=trust',
		'postgres:17'
	]);
	let ready = false;
	for (let attempt = 0; attempt < 60; attempt++) {
		try {
			docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']);
			ready = true;
			break;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}
	assert.ok(ready);
	sql(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; grant usage on schema auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
create table public.books(id uuid default gen_random_uuid() primary key, book_id text unique not null, book_name text not null, author text not null, summary text, year integer,
 ${Array.from({ length: 7 }, (_, i) => `genre${i + 1} text`).join(',')}, type text, popularity double precision, quality_band text, quality_percentile numeric,
 ${['pace', 'vocabulary', 'depth', 'originality', 'discussion_potential', 'violence', 'spice', 'atmosphere', 'entry_barrier'].map((n) => `${n}_value double precision`).join(',')},
 ${Array.from({ length: 10 }, (_, i) => `keyword${i + 1} text`).join(',')});
insert into books(book_id,book_name,author,quality_band,quality_percentile,pace_value,keyword1) values
 ${[1, 2, 3, 4, 5].map((i) => `('${id(i)}','Book ${i}','Author','top_25_percent',80,.8,'Imagination')`).join(',')};
create table public.feed_requests(id bigint primary key,user_id uuid,status text,error_message text,created_at timestamptz);
create table public.feed_items(request_id text,user_id uuid,book_id text,rank integer);
create table public.user_ratings(user_id uuid,book_id text);
create table public.user_bookmarks(user_id uuid,book_id text);
create table public.user_not_interested(user_id uuid,book_id text);
create table public.top_100_books(book_id text,genre text,display_order smallint);
insert into feed_requests values (42,'${uid}','completed',null,now()-interval '1 minute'),(43,'${uid}','processing',null,now()),(70,'${other}','completed',null,now());
insert into feed_items values ('42','${uid}','${id(1)}',1),('42','${uid}','${id(2)}',2),('42','${uid}','${id(3)}',3),('70','${other}','${id(4)}',1);
insert into user_ratings values ('${uid}','${id(1)}');
insert into top_100_books values ('${id(1)}','Fantasy',1),('${id(2)}','Fantasy',2),('${id(4)}','Fantasy',3);
alter table books enable row level security; create policy books_public on books for select using(true);
alter table top_100_books enable row level security; create policy top_public on top_100_books for select using(true);
${['feed_requests', 'feed_items', 'user_ratings', 'user_bookmarks', 'user_not_interested'].map((name) => `alter table ${name} enable row level security; create policy own_rows on ${name} for select to authenticated using(user_id=auth.uid());`).join('\n')}
grant select on all tables in schema public to authenticated;
grant select on books,top_100_books to anon;
grant select,update on books to service_role;`);
	// Versioned legacy contracts; no dependency on a local schema inventory or baseline.
	sql(read('scripts/fixtures/legacy-book-read-rpcs.sql'));
	sql(read('supabase/migrations/20261024000000_rate_feed_bootstrap.sql'));
	const definitions = () =>
		sql(
			"select jsonb_object_agg(proname,pg_get_functiondef(oid)) from pg_proc where pronamespace='public'::regnamespace and proname in ('get_books_excluding_ids','get_eligible_feed_books','get_eligible_top_100_books','get_latest_rate_feed_state','get_rate_feed_bootstrap');"
		);
	const before = definitions();
	const legacyPayload = user('select public.get_rate_feed_bootstrap(50);');
	sql(read('supabase/migrations/20261025000000_book_annotations.sql'));
	sql(read('supabase/migrations/20261025010000_annotated_book_reads.sql'));
	assert.equal(definitions(), before);
	assert.deepEqual(user('select public.get_rate_feed_bootstrap(50);'), legacyPayload);
	checks.push(
		'Additive migrations preserve all five legacy RPC definitions and the legacy bootstrap response'
	);
	const locationSql = read('scripts/catalog/locate-book-annotation-import.sql');
	const importStatusSql = (version) =>
		read('scripts/catalog/book-annotation-import-status.sql').replace(
			"'book-annotations-test-001'::text",
			() => `${quote(version)}::text`
		);
	const importStatus = (version) => JSON.parse(sql(importStatusSql(version)));
	assert.equal(importStatus('not-registered').export_found, false);
	const initialLocation = JSON.parse(sql(locationSql));
	assert.equal(initialLocation.target_export_present, false);
	assert.equal(initialLocation.private_staging_rows_all_exports, 0);
	assert.equal(initialLocation.staging_export_foreign_keys.length, 1);
	sql('create table public."01-staging-lf"(export_version text, book_id text, record jsonb);');
	const wrongTableLocation = JSON.parse(sql(locationSql));
	assert.ok(
		wrongTableLocation.candidate_import_tables.some(
			(table) => table.schema === 'public' && table.table === '01-staging-lf'
		)
	);
	assert.ok(
		wrongTableLocation.candidate_import_tables.some(
			(table) => table.schema === 'private' && table.table === 'book_annotation_import_rows'
		)
	);
	checks.push(
		'Import-location diagnostic detects missing registration and candidate CSV tables using catalogs without reading their rows'
	);

	// Reproduce an upload into a recreated table: rows exist without registration/FK.
	const repairSql = read('scripts/catalog/repair-book-annotation-staging.sql');
	const recovery = prepare('recovery-fixture', [row(2)]);
	sql(`drop table private.book_annotation_import_rows;
create table private.book_annotation_import_rows(export_version text, book_id text, record jsonb);
grant select, insert on private.book_annotation_import_rows to anon, authenticated, service_role;
insert into private.book_annotation_import_rows values
('recovery-fixture', '${id(2)}', ${quote(JSON.stringify(row(2)))}::jsonb);`);
	assert.throws(() => sql(repairSql), /violates foreign key constraint/);
	assert.equal(sql('select count(*) from private.book_annotation_import_rows;'), '1');
	assert.equal(
		sql(
			"select count(*) from pg_constraint where conrelid='private.book_annotation_import_rows'::regclass;"
		),
		'0'
	);
	sql(recovery.files[0].sql);
	for (let pass = 0; pass < 2; pass++) {
		const restored = JSON.parse(sql(repairSql));
		assert.equal(restored.staged_books, 1);
		assert.equal(restored.import_key_unique, true);
		assert.equal(restored.rls_enabled, true);
		assert.equal(restored.validated_recovery_constraints, 3);
		assert.equal(restored.authenticated_can_select, false);
		assert.equal(restored.anon_can_select, false);
		assert.equal(restored.service_role_can_select, false);
	}
	assert.deepEqual(
		JSON.parse(sql('select record from private.book_annotation_import_rows;')),
		row(2)
	);
	assert.equal(preview('recovery-fixture').ready_to_apply, true);
	assert.equal(sql('select count(*) from books where annotation_export_version is not null;'), '0');
	assert.throws(
		() => sql("update private.book_annotation_import_rows set record = '{}'::jsonb;"),
		/violates check constraint/
	);
	assert.throws(
		() =>
			sql(
				'insert into private.book_annotation_import_rows select * from private.book_annotation_import_rows;'
			),
		/duplicate key/
	);
	// A dashboard-created table can have an automatic ID primary key. Retain it.
	sql(`drop table private.book_annotation_import_rows;
create table private.book_annotation_import_rows(
  id bigint generated by default as identity primary key,
  export_version text, book_id text, record jsonb);
insert into private.book_annotation_import_rows(export_version, book_id, record) values
('recovery-fixture', '${id(2)}', ${quote(JSON.stringify(row(2)))}::jsonb),
('recovery-fixture', '${id(2)}', ${quote(JSON.stringify(row(2)))}::jsonb);`);
	assert.throws(() => sql(repairSql), /could not create unique index/);
	assert.equal(sql('select count(*) from private.book_annotation_import_rows;'), '2');
	assert.equal(
		sql(
			"select pg_get_constraintdef(oid) from pg_constraint where conrelid='private.book_annotation_import_rows'::regclass and contype='p';"
		),
		'PRIMARY KEY (id)'
	);
	sql('delete from private.book_annotation_import_rows where id=2;');
	for (let pass = 0; pass < 2; pass++) {
		const restored = JSON.parse(sql(repairSql));
		assert.equal(restored.staged_books, 1);
		assert.equal(restored.primary_key, 'PRIMARY KEY (id)');
		assert.equal(restored.import_key_unique, true);
	}
	assert.deepEqual(
		JSON.parse(
			sql(
				"select jsonb_build_object('id', id, 'record', record) from private.book_annotation_import_rows;"
			)
		),
		{ id: 1, record: row(2) }
	);
	assert.throws(
		() =>
			sql(
				'insert into private.book_annotation_import_rows(export_version,book_id,record) select export_version,book_id,record from private.book_annotation_import_rows;'
			),
		/book_annotation_recovery_import_key/
	);
	sql(
		"delete from private.book_annotation_import_rows; delete from private.book_annotation_exports where export_version='recovery-fixture';"
	);
	checks.push(
		'Staging recovery preserves uploaded rows and existing ID primary keys, rolls back unregistered/duplicate imports, restores checks/RLS/grants, and supports repeat execution without publishing books'
	);

	const prepared = prepare("fixture '$annotation_guard$", [row(2), row(3), row(99)]);
	assert.equal(preview("fixture '$annotation_guard$").export_found, false);
	sql(prepared.files[0].sql);
	sql(prepared.files[1].sql);
	const statusBeforeApply = importStatus("fixture '$annotation_guard$");
	assert.equal(statusBeforeApply.state, 'staging');
	assert.equal(statusBeforeApply.remaining_staged_books, 1);
	assert.deepEqual(statusBeforeApply.importer_transactions, []);
	const statusWithImportLock = JSON.parse(
		sql(
			`begin; select pg_advisory_xact_lock(19730101, 20261025);
${importStatusSql("fixture '$annotation_guard$")}
commit;`
		)
	);
	assert.equal(statusWithImportLock.importer_transactions.length, 1);
	assert.equal(statusWithImportLock.importer_transactions[0].import_lock_granted, true);
	const partialPreview = preview("fixture '$annotation_guard$");
	assert.equal(partialPreview.staged_books, 1);
	assert.equal(partialPreview.ready_to_apply, false);
	assert.throws(() => sql(prepared.files.at(-1).sql), /Incomplete annotation staging/);
	assert.equal(sql('select count(*) from books where awards is not null;'), '0');
	for (const file of prepared.files.slice(2, -1)) sql(file.sql);
	const completePreview = preview("fixture '$annotation_guard$");
	assert.equal(completePreview.staged_books, 3);
	assert.equal(completePreview.matching_books, 2);
	assert.equal(completePreview.unmatched_export_ids, 1);
	assert.equal(completePreview.invalid_annotation_rows, 0);
	assert.equal(completePreview.ready_to_apply, true);
	const stagedLocation = JSON.parse(sql(locationSql));
	assert.equal(stagedLocation.private_staging_rows_all_exports, 3);
	assert.equal(
		stagedLocation.private_staging_by_export[0].export_version,
		"fixture '$annotation_guard$"
	);
	const diagnosisSnapshot = () =>
		sql(`select jsonb_build_object(
  'books', (select jsonb_agg(to_jsonb(b) order by book_id) from books b),
  'staging', (select jsonb_agg(to_jsonb(s) order by book_id) from private.book_annotation_import_rows s));`);
	const beforeApplyDiagnosis = diagnosisSnapshot();
	sql(`create function public.annotation_diagnostic_guard() returns trigger language plpgsql as $$
begin raise exception 'Diagnostic must never execute an update'; end; $$;
create trigger annotation_diagnostic_guard before update on books for each row execute function public.annotation_diagnostic_guard();`);
	const applyDiagnosis = JSON.parse(
		sql(
			read('scripts/catalog/diagnose-book-annotation-apply.sql').replace(
				"v_version text := 'book-annotations-test-001';",
				() => `v_version text := ${quote("fixture '$annotation_guard$")};`
			)
		)
	);
	assert.equal(applyDiagnosis.transaction_read_only, 'on');
	assert.equal(applyDiagnosis.plans_are_estimates_only, true);
	assert.equal(applyDiagnosis.plans.update[0].Plan.Operation, 'Update');
	assert.equal(applyDiagnosis.plans.cleanup[0].Plan.Operation, 'Delete');
	assert.ok(!JSON.stringify(applyDiagnosis.plans).includes('Actual Rows'));
	assert.ok(
		applyDiagnosis.triggers_without_arguments_or_bodies.some(
			(trigger) =>
				trigger.name === 'annotation_diagnostic_guard' && trigger.per_row && trigger.fires_on_update
		)
	);
	assert.equal(diagnosisSnapshot(), beforeApplyDiagnosis);
	sql(
		'drop trigger annotation_diagnostic_guard on books; drop function public.annotation_diagnostic_guard();'
	);
	checks.push(
		'Apply diagnosis plans update/count/cleanup in a read-only transaction without firing triggers or changing catalog/staging rows'
	);
	sql(`update books set book_name='' where book_id='${id(2)}';`);
	assert.equal(preview("fixture '$annotation_guard$").invalid_core_identities, 1);
	assert.equal(preview("fixture '$annotation_guard$").ready_to_apply, false);
	sql(`update books set book_name='Book 2' where book_id='${id(2)}';`);
	const summary = JSON.parse(sql(prepared.files.at(-1).sql));
	const statusAfterApply = importStatus("fixture '$annotation_guard$");
	assert.equal(statusAfterApply.state, 'applied');
	assert.equal(statusAfterApply.remaining_staged_books, 0);
	assert.deepEqual(statusAfterApply.summary, summary);
	checks.push(
		'Read-only timeout status distinguishes absent/staging/applied exports, reports committed summary and staging count, and detects the held importer transaction lock'
	);
	assert.equal(preview("fixture '$annotation_guard$").state, 'applied');
	assert.equal(preview("fixture '$annotation_guard$").ready_to_apply, false);
	assert.equal(summary.updated_books, 2);
	assert.equal(summary.unmatched_export_ids, 1);
	assert.deepEqual(JSON.parse(sql(prepared.files.at(-1).sql)), summary);
	assert.equal(sql('select count(*) from books;'), '5');
	assert.equal(sql("select count(*) from books where quality_band='top_25_percent';"), '5');
	assert.equal(sql('select count(*) from private.book_annotation_import_rows;'), '0');
	assert.equal(
		sql(
			`select count(*) from books where book_id='${id(5)}' and annotation_export_version is null;`
		),
		'1'
	);
	assert.deepEqual(JSON.parse(sql(`select awards from books where book_id='${id(2)}';`)), [award]);
	checks.push(
		'Chunked staging is invisible until publication; omitted/unmatched IDs, SQL quoting, null years, legacy fields, cleanup, and apply retry are correct'
	);
	checks.push(
		'Read-only preview handles absent/partial/applied exports, reports matched and unmatched IDs, and rejects invalid core identity before publication'
	);

	const boot = user('select public.get_rate_feed_bootstrap_annotated(50);');
	assert.deepEqual(
		boot.books.map((b) => b.book_id),
		[id(2), id(3)]
	);
	assert.equal(boot.books[0].book_ranking.population_count, 1000);
	assert.equal(boot.books[0].author_ranking.version, 'v3');
	assert.equal(boot.books[0].pace_value, 0.8);
	assert.equal(boot.books[0].keyword1, 'Imagination');
	assert.ok(!Object.hasOwn(boot.books[0], 'awards'));
	assert.equal(boot.latest_request_status, 'processing');
	assert.deepEqual(user("select public.get_eligible_feed_books_annotated('70',50);"), []);
	assert.deepEqual(user("select public.get_eligible_feed_books_annotated('42',50);", other), []);
	assert.deepEqual(
		user('select public.get_eligible_top_100_books_annotated();').map((b) => b.book_id),
		[id(2), id(4)]
	);
	checks.push(
		'Annotated bootstrap/poll/popular reads preserve eligibility and cross-account RLS while carrying rankings, scores, and keywords without full award arrays'
	);

	assert.throws(
		() => sql('set role anon; select public.get_rate_feed_bootstrap_annotated(50);'),
		/permission denied/
	);
	assert.throws(
		() => sql('set role authenticated; select * from private.book_annotation_exports;'),
		/permission denied/
	);
	assert.throws(
		() => sql("set role authenticated; update books set awards='[]';"),
		/permission denied/
	);
	assert.throws(
		() =>
			sql(
				`set role service_role; select private.apply_book_annotation_import(${quote(manifest('x', 0).export_version)});`
			),
		/permission denied/
	);
	sql(
		"set role service_role; update books set summary='Trusted catalog update' where book_id='" +
			id(2) +
			"';"
	);
	checks.push(
		'Anonymous RPC denial, private staging/write restrictions, and existing service-role catalog updates are preserved'
	);

	apply(
		prepare('clear-test', [
			{ book_id: id(2), book_ranking: null, author_ranking: null, awards: null }
		])
	);
	assert.equal(
		sql(
			`select count(*) from books where book_id='${id(2)}' and book_ranking is null and author_ranking is null and awards is null;`
		),
		'1'
	);
	assert.equal(
		sql(`select count(*) from books where book_id='${id(3)}' and awards is not null;`),
		'1'
	);
	checks.push(
		'Explicit null clears exported annotations; omitted books retain their previous publication'
	);

	assert.throws(
		() => prepare('bad-award', [{ ...row(2), awards: [{ ...award, tier: 0 }] }]),
		/Invalid award/
	);
	assert.throws(
		() => prepare('bad-status', [{ ...row(2), awards: [{ ...award, status: 'shortlist' }] }]),
		/Invalid award/
	);
	assert.throws(
		() => prepare('bad-band', [{ ...row(2), book_ranking: { rank: 100, band: 'top_1_percent' } }]),
		/Incorrect book band/
	);
	assert.throws(
		() => prepareImport(manifest('bad-count', 3), JSON.stringify(row(2))),
		/record count/
	);
	assert.throws(() => prepare('duplicate', [row(2), row(2)]), /Repeated book ID/);
	const invalid = prepare('atomic-test', [row(2), row(3)]);
	for (const file of invalid.files.slice(0, -1)) sql(file.sql);
	sql(
		`update private.book_annotation_import_rows set record=jsonb_set(record,'{awards}', '[{"tier":9,"name":"Invalid","status":"winner","year":null}]') where export_version='atomic-test' and book_id='${id(3)}';`
	);
	assert.equal(preview('atomic-test').invalid_annotation_rows, 1);
	assert.equal(preview('atomic-test').ready_to_apply, false);
	assert.throws(() => sql(invalid.files.at(-1).sql), /books_awards_valid/);
	assert.equal(sql(`select count(*) from books where book_id='${id(2)}' and awards is null;`), '1');
	assert.equal(
		sql("select state from private.book_annotation_exports where export_version='atomic-test';"),
		'staging'
	);
	checks.push(
		'Invalid files are rejected before generation; database validation rolls back an invalid publication without losing previous data'
	);
	const csvVersion = 'csv "review"\nwith apostrophe\'s';
	const csvRows = [
		{ ...row(4), awards: [{ ...award, name: 'Readers, "Choice"\nÉtoile 読書' }] },
		{ book_id: id(99), book_ranking: null, author_ranking: null, awards: [] }
	];
	const csvPrepared = prepare(csvVersion, csvRows);
	const csvParsed = Papa.parse(csvPrepared.stagingCsv, {
		header: true,
		dynamicTyping: false,
		skipEmptyLines: true
	});
	assert.equal(csvParsed.errors.length, 0);
	assert.deepEqual(csvParsed.meta.fields, ['export_version', 'book_id', 'record']);
	assert.deepEqual(
		csvParsed.data.map((r) => JSON.parse(r.record)),
		csvRows
	);
	assert.ok(csvParsed.data.every((r) => r.export_version === csvVersion));
	const lineEndingFixture = prepare('csv-line-ending-regression', [row(2), row(3)]).stagingCsv;
	const legacyCrLf = lineEndingFixture.replaceAll('\n', '\r\n');
	const boundary = legacyCrLf.indexOf('\r\n', legacyCrLf.indexOf('\r\n') + 2) + 1;
	const parseChunks = (text) => {
		const data = [];
		const errors = [];
		Papa.parse(text, {
			header: true,
			dynamicTyping: false,
			skipEmptyLines: true,
			chunkSize: boundary,
			chunk(result) {
				data.push(...result.data);
				errors.push(...result.errors);
			}
		});
		return { data, errors };
	};
	assert.ok(parseChunks(legacyCrLf).errors.length > 0, 'Fixture must reproduce the CRLF chunk bug');
	const lfStreamed = parseChunks(lineEndingFixture);
	assert.equal(lfStreamed.errors.length, 0);
	assert.deepEqual(
		lfStreamed.data.map((r) => JSON.parse(r.record)),
		[row(2), row(3)]
	);
	sql(csvPrepared.files[0].sql);
	sql(csvPrepared.files[1].sql);
	assert.equal(preview(csvVersion).staged_books, 1);
	sql(csvPrepared.resetStaging.sql);
	assert.equal(preview(csvVersion).staged_books, 0);
	assert.equal(preview('atomic-test').staged_books, 2);
	docker(
		[
			'exec',
			'-i',
			container,
			'psql',
			'-X',
			'-q',
			'-v',
			'ON_ERROR_STOP=1',
			'-U',
			'postgres',
			'-c',
			'copy private.book_annotation_import_rows(export_version,book_id,record) from stdin with (format csv, header true)'
		],
		csvPrepared.stagingCsv
	);
	assert.deepEqual(
		JSON.parse(
			sql(
				`select record from private.book_annotation_import_rows where export_version=${quote(csvVersion)} and book_id='${id(4)}';`
			)
		),
		csvRows[0]
	);
	assert.equal(preview(csvVersion).ready_to_apply, true);
	const csvSummary = JSON.parse(sql(csvPrepared.files.at(-1).sql));
	assert.equal(csvSummary.updated_books, 1);
	assert.equal(csvSummary.unmatched_export_ids, 1);
	assert.deepEqual(
		JSON.parse(sql(`select awards from books where book_id='${id(4)}';`)),
		csvRows[0].awards
	);
	assert.throws(() => sql(csvPrepared.resetStaging.sql), /already applied/);
	const largeRows = [2, 3].map((i) => ({
		...row(i),
		awards: [{ ...award, name: 'É'.repeat(300000) }]
	}));
	const bounded = prepareImport(
		manifest('byte-limit', 2),
		largeRows.map(JSON.stringify).join('\n'),
		5000
	);
	assert.equal(bounded.files.filter((f) => f.name.startsWith('01-stage-')).length, 2);
	assert.ok(bounded.files.every((f) => Buffer.byteLength(f.sql) <= MAX_SQL_CHUNK_BYTES));
	checks.push(
		'CSV preserves JSON, Unicode, quotes, commas, newlines and nulls; LF streaming avoids the CRLF chunk error; guarded staging reset and bounded SQL chunks work'
	);
	// Model Cron's scheduling API; execute its stored command as one PostgreSQL
	// protocol message, as pg_cron does. This tests SQL/transaction handling, not timers.
	const backgroundSource = read('scripts/catalog/apply-book-annotations-background.sql');
	assert.throws(() => sql(backgroundSource), /pg_cron is not installed/);
	sql(`create schema cron;
create table cron.job(jobid bigint generated always as identity primary key,
  jobname text unique, schedule text, command text, database name default current_database(),
  username name default current_user, active boolean default true);
create function cron.schedule(text,text,text) returns bigint language sql as $$
  insert into cron.job(jobname,schedule,command) values ($1,$2,$3) returning jobid; $$;
create function cron.unschedule(text) returns boolean language sql as $$
  with removed as (delete from cron.job where jobname=$1 returning jobid)
  select exists(select 1 from removed); $$;`);
	for (const outcome of ['success', 'failure', 'timeout']) {
		const version = `background-${outcome}`;
		const bg = prepare(version, [row(4), row(99)]);
		for (const file of bg.files.slice(0, -1)) sql(file.sql);
		const backgroundSql = backgroundSource
			.replaceAll('book-annotations-test-001', version)
			.replaceAll(
				'1d3eb7bbcef444aba1fe9d2650be8b731d9c35d0338a04707931eef75aa88bea',
				bg.payloadSha256
			)
			.replaceAll('116528', '2')
			.replace("extname = 'pg_cron'", "extname = 'plpgsql'");
		const bookSnapshot = () => sql('select jsonb_agg(to_jsonb(b) order by book_id) from books b;');
		const beforeBackground = bookSnapshot();
		const schedule = JSON.parse(sql(backgroundSql));
		assert.equal(schedule.state, 'staging');
		assert.equal(schedule.scheduled_job.active, true);
		assert.equal(bookSnapshot(), beforeBackground);
		assert.throws(() => sql(backgroundSql), /An import job already exists/);
		if (outcome !== 'success') {
			sql(`create function public.background_fixture_guard() returns trigger language plpgsql as $$
begin ${outcome === 'timeout' ? 'perform pg_sleep(1); return new;' : "raise exception 'background fixture failure';"} end; $$;
create trigger background_fixture_guard before update on books for each row execute function public.background_fixture_guard();`);
		}
		let command = sql(`select command from cron.job where jobname=${quote(`${version}-apply`)};`);
		if (outcome === 'timeout')
			command = command.replace("statement_timeout = '5min'", "statement_timeout = '100ms'");
		docker([
			'exec',
			container,
			'psql',
			'-X',
			'-q',
			'-A',
			'-t',
			'-v',
			'ON_ERROR_STOP=1',
			'-U',
			'postgres',
			'-c',
			command
		]);
		const status = importStatus(version);
		assert.equal(
			sql(`select count(*) from cron.job where jobname=${quote(`${version}-apply`)};`),
			'0'
		);
		if (outcome === 'success') {
			assert.equal(status.state, 'applied');
			assert.equal(status.summary.updated_books, 1);
			assert.equal(status.remaining_staged_books, 0);
			const repeat = JSON.parse(sql(backgroundSql));
			assert.equal(repeat.state, 'applied');
			assert.equal(repeat.scheduled_job, null);
		} else {
			assert.equal(status.state, 'staging');
			assert.equal(status.remaining_staged_books, 2);
			assert.equal(status.summary.last_background_attempt.status, 'failed');
			assert.equal(
				status.summary.last_background_attempt.sqlstate,
				outcome === 'timeout' ? '57014' : 'P0001'
			);
			assert.equal(bookSnapshot(), beforeBackground);
			sql(
				'drop trigger background_fixture_guard on books; drop function public.background_fixture_guard();'
			);
			sql(bg.resetStaging.sql);
		}
	}
	assert.equal(definitions(), before);
	checks.push(
		'Background SQL wrapper schedules without publishing, prevents duplicate jobs, preserves atomicity, records SQL errors/timeouts, removes completed jobs, and skips already-applied versions (Cron scheduling API modeled locally)'
	);
	const verification = JSON.parse(sql(read('scripts/catalog/verify-book-annotations.sql')));
	assert.equal(verification.books.invalid_annotations, 0);
	assert.equal(verification.read_rpcs.length, 3);
	assert.ok(
		verification.read_rpcs.every(
			(rpc) => !rpc.security_definer && rpc.authenticated_can_execute && !rpc.anon_can_execute
		)
	);
	assert.ok(
		Object.values(verification.private_import_access).every((allowed) => allowed === false)
	);
	const reclaimSql = read('scripts/maintenance/reclaim-book-annotation-staging.sql');
	assert.throws(() => sql(reclaimSql), /Staged rows remain; nothing was truncated/);
	assert.equal(preview('atomic-test').staged_books, 2);
	sql(invalid.resetStaging.sql);
	const maintenanceSnapshot = () =>
		sql(`select jsonb_build_object(
  'books', (select jsonb_agg(to_jsonb(b) order by book_id) from books b),
  'exports', (select jsonb_agg(to_jsonb(e) order by export_version) from private.book_annotation_exports e),
  'constraints', (select jsonb_agg(pg_get_constraintdef(oid) order by conname)
    from pg_constraint where conrelid='private.book_annotation_import_rows'::regclass),
  'rls', (select relrowsecurity from pg_class where oid='private.book_annotation_import_rows'::regclass),
  'acl', (select relacl::text from pg_class where oid='private.book_annotation_import_rows'::regclass));`);
	const beforeMaintenance = maintenanceSnapshot();
	for (let pass = 0; pass < 2; pass++) {
		const space = JSON.parse(sql(reclaimSql));
		assert.ok(space.bytes_after <= space.bytes_before);
		assert.equal(sql('select count(*) from private.book_annotation_import_rows;'), '0');
		assert.equal(maintenanceSnapshot(), beforeMaintenance);
	}
	checks.push(
		'Empty staging space reclamation refuses pending rows across exports and preserves published books, audit history, keys, RLS and grants'
	);
	sql(`create schema migration_archive;
create table migration_archive.books_before_ulid_20260603(id integer primary key, title text);
insert into migration_archive.books_before_ulid_20260603 values (1,'INVENTORY_MUST_NOT_EXPORT_ROW');
create table public.active_archive_reference(id integer references migration_archive.books_before_ulid_20260603(id));
insert into public.active_archive_reference values (1);
create view public.archive_dependent_view as select id from migration_archive.books_before_ulid_20260603;
create function private.archive_reference_test() returns void language plpgsql as $$
begin -- migration_archive.books_before_ulid_20260603
  raise exception 'Inventory must not execute application functions'; end; $$;
insert into cron.job(jobname,schedule,command) values
('inventory-reference-test','* * * * *','select * from migration_archive.books_before_ulid_20260603; -- INVENTORY_MUST_NOT_EXPORT_COMMAND');`);
	const beforeInventory = maintenanceSnapshot();
	const storageInventory = JSON.parse(
		sql(read('scripts/maintenance/supabase-storage-inventory.sql'))
	);
	assert.equal(storageInventory.transaction_read_only, 'on');
	assert.ok(storageInventory.cluster_shared_tables_total_bytes > 0);
	assert.ok(storageInventory.cluster_shared_tables.every((table) => table.cluster_shared));
	assert.ok(storageInventory.largest_tables.every((table) => !table.cluster_shared));
	assert.equal(
		storageInventory.listed_tables_total_bytes,
		storageInventory.schema_totals.reduce((sum, schema) => sum + schema.total_bytes, 0)
	);
	assert.ok(storageInventory.current_database_bytes > 0);
	assert.equal(storageInventory.archive_tables.length, 1);
	const archive = storageInventory.archive_tables[0];
	assert.equal(archive.table, 'books_before_ulid_20260603');
	assert.equal(archive.review_group, 'legacy_snapshot_candidate');
	assert.equal(archive.foreign_keys_touching_table.length, 1);
	assert.ok(archive.dependent_views.some((view) => view.name === 'archive_dependent_view'));
	assert.ok(
		archive.routine_text_reference_hints.some(
			(routine) => routine.name === 'archive_reference_test'
		)
	);
	assert.equal(storageInventory.archive_total_bytes, archive.total_bytes);
	assert.equal(archive.table_bytes_including_toast + archive.index_bytes, archive.total_bytes);
	assert.equal(storageInventory.annotation_staging.table, 'book_annotation_import_rows');
	assert.equal(
		storageInventory.cron_metadata_without_commands.jobs[0].archive_text_reference_hint,
		true
	);
	assert.ok(!JSON.stringify(storageInventory).includes('INVENTORY_MUST_NOT_EXPORT'));
	assert.equal(maintenanceSnapshot(), beforeInventory);
	assert.equal(
		sql("select current_setting('book_doctor_diagnostics.storage_inventory', true);"),
		''
	);
	checks.push(
		'Read-only storage inventory measures allocations without double-counting TOAST, exposes archive FK/view/routine/cron hints, and returns no row values or job commands'
	);
	sql(`create table private.author_comparison_datasets(dataset_version text primary key,
  is_active boolean, complete_corpus boolean, loaded_at timestamptz default now(),
  method_version text, source_author_graph_version text, source_handoff_version text, author_count integer);
insert into private.author_comparison_datasets values ('active-data',true,true,now(),'method','graph','handoff',2),
  ('old-data',false,true,now(),'method','old-graph','old-handoff',2);
create table private.author_reaction_sets(dataset_version text references private.author_comparison_datasets,
  author_id integer, author_name text, like_reader_ids integer[]);
insert into private.author_reaction_sets values ('active-data',1,'AUTHOR_NAME_MUST_STAY_PRIVATE',array[1648392019]);
create table private.validated_author_comparisons(dataset_version text references private.author_comparison_datasets,
  author_a_id integer, author_b_id integer);
insert into private.validated_author_comparisons values ('active-data',1,2);
create table private.author_comparison_cache(dataset_version text references private.author_comparison_datasets);
create table private.author_map_nodes(release_id text, author_id integer, primary key(release_id,author_id));
create table private.author_map_neighbors(release_id text, author_id integer, neighbor_author_id integer,
  foreign key(release_id,author_id) references private.author_map_nodes(release_id,author_id),
  foreign key(release_id,neighbor_author_id) references private.author_map_nodes(release_id,author_id));
insert into private.author_map_nodes values ('map-test',1),('map-test',2);
insert into private.author_map_neighbors values ('map-test',1,2),('map-test',2,1);
alter table private.author_map_nodes enable row level security;
alter table private.author_map_neighbors enable row level security;
create function private.comparison_dependency_test() returns void language plpgsql as $$
begin -- author_reaction_sets and validated_author_comparisons
raise exception 'Diagnostic must not invoke comparison code'; end; $$;`);
	const retention = JSON.parse(sql(read('scripts/maintenance/inspect-author-data-retention.sql')));
	assert.equal(retention.comparison_datasets[0].dataset_version, 'active-data');
	assert.equal(retention.comparison_datasets[0].reaction_rows, 1);
	assert.equal(retention.comparison_datasets[0].validated_pair_rows, 1);
	assert.equal(retention.comparison_datasets[1].is_active, false);
	assert.deepEqual(retention.map_releases, [
		{ release_id: 'map-test', node_rows: 2, neighbor_rows: 2 }
	]);
	assert.ok(
		retention.table_dependencies
			.find((table) => table.table === 'author_reaction_sets')
			.routine_reference_hints.some((routine) => routine.name === 'comparison_dependency_test')
	);
	assert.ok(!JSON.stringify(retention).includes('AUTHOR_NAME_MUST_STAY_PRIVATE'));
	assert.ok(!JSON.stringify(retention).includes('1648392019'));
	checks.push(
		'Author retention inspection returns version counts and dependency hints without reader memberships or author names'
	);
	const reclaimMapSql = read('scripts/maintenance/reclaim-unused-author-map-data.sql');
	const mapCounts = () =>
		sql(`select jsonb_build_array(
  (select count(*) from private.author_map_nodes), (select count(*) from private.author_map_neighbors));`);
	const blockedMapCleanup = (pattern) => {
		assert.throws(() => sql(reclaimMapSql), pattern);
		assert.equal(mapCounts(), '[2, 2]');
	};
	sql(`create function private.map_consumer_test() returns void language plpgsql as $$
begin -- author_map_nodes
raise exception 'Must not execute'; end; $$;`);
	blockedMapCleanup(/Stored routines reference the map tables/);
	sql('drop function private.map_consumer_test();');
	sql(
		'create function private.rowtype_consumer_test(private.author_map_nodes) returns integer language sql as $$select 1$$;'
	);
	blockedMapCleanup(/Stored routines reference the map tables/);
	sql('drop function private.rowtype_consumer_test(private.author_map_nodes);');
	sql('create view public.map_consumer_view as select * from private.author_map_nodes;');
	blockedMapCleanup(/Views reference the map data/);
	sql('drop view public.map_consumer_view;');
	sql(`create table public.map_dependent(release_id text, author_id integer,
  foreign key(release_id,author_id) references private.author_map_nodes(release_id,author_id));`);
	blockedMapCleanup(/Other tables reference the map data/);
	sql('drop table public.map_dependent;');
	sql(
		"insert into cron.job(jobname,schedule,command) values ('map-consumer','* * * * *','select * from private.author_map_neighbors');"
	);
	blockedMapCleanup(/Cron commands reference map tables/);
	sql("delete from cron.job where jobname='map-consumer';");
	sql(`create function private.map_trigger_test() returns trigger language plpgsql as $$
begin raise exception 'Must not fire'; end; $$;
create trigger map_trigger_test before truncate on private.author_map_nodes execute function private.map_trigger_test();`);
	blockedMapCleanup(/Custom map-table triggers need review/);
	sql(
		'drop trigger map_trigger_test on private.author_map_nodes; drop function private.map_trigger_test();'
	);
	const authorPreservationSnapshot = () =>
		sql(`select jsonb_build_object(
  'datasets', (select jsonb_agg(to_jsonb(d) order by dataset_version) from private.author_comparison_datasets d),
  'reactions', (select jsonb_agg(to_jsonb(r)) from private.author_reaction_sets r),
  'comparisons', (select jsonb_agg(to_jsonb(v)) from private.validated_author_comparisons v),
  'cache', (select count(*) from private.author_comparison_cache),
  'map_constraints', (select jsonb_agg(pg_get_constraintdef(c.oid) order by c.conname) from pg_constraint c
    where c.conrelid in ('private.author_map_nodes'::regclass,'private.author_map_neighbors'::regclass)),
  'map_access', (select jsonb_agg(jsonb_build_object('table',relname,'rls',relrowsecurity,'acl',relacl::text) order by relname)
    from pg_class where oid in ('private.author_map_nodes'::regclass,'private.author_map_neighbors'::regclass)));`);
	const beforeMapPreservation = authorPreservationSnapshot();
	const beforeMapBookSnapshot = maintenanceSnapshot();
	const mapCleanup = JSON.parse(sql(reclaimMapSql));
	assert.equal(mapCleanup.removed_node_rows, 2);
	assert.equal(mapCleanup.removed_neighbor_rows, 2);
	assert.equal(mapCounts(), '[0, 0]');
	assert.equal(authorPreservationSnapshot(), beforeMapPreservation);
	assert.equal(maintenanceSnapshot(), beforeMapBookSnapshot);
	assert.equal(JSON.parse(sql(reclaimMapSql)).removed_node_rows, 0);
	checks.push(
		'Map-export cleanup refuses routine/rowtype/view/FK/trigger/cron consumers and preserves comparison data, published books, table keys and access controls'
	);
	const beforeStorage = maintenanceSnapshot();
	sql(read('supabase/migrations/20261028000000_book_series.sql'));
	assert.equal(maintenanceSnapshot(), beforeStorage);
	assert.equal(
		JSON.parse(sql(read('scripts/catalog/verify-book-series.sql'))).series_detail_rpc,
		null
	);
	const noSlugManifest = { ...manifest('series-without-slugs', 1), schema_version: 2 };
	const noSlugRecord = { ...row(1), series_title: 'Import without URLs', series_number: 109 };
	const noSlugResult = JSON.parse(
		sql(`begin;
insert into private.book_annotation_exports(export_version,manifest,payload_sha256)
values ('series-without-slugs',${quote(JSON.stringify(noSlugManifest))}::jsonb,repeat('a',64));
insert into private.book_annotation_import_rows(export_version,book_id,record)
values ('series-without-slugs','${id(1)}',${quote(JSON.stringify(noSlugRecord))}::jsonb);
select private.apply_book_annotation_import('series-without-slugs');
rollback;`)
	);
	assert.equal(noSlugResult.updated_books, 1);
	assert.equal(noSlugResult.series_memberships_written, 1);
	assert.equal(
		sql(
			"select exists(select 1 from pg_attribute where attrelid='public.books'::regclass and attname='slug' and not attisdropped);"
		),
		'f'
	);
	assert.equal(maintenanceSnapshot(), beforeStorage);
	checks.push(
		'Series storage, v2 registration/publication and verification work without slugs; storage installation leaves catalog rows unchanged'
	);
	const beforeMissingSlug = maintenanceSnapshot();
	assert.throws(
		() => sql(read('supabase/migrations/20261028020000_series_book_detail.sql')),
		/Install 20261027000000_public_book_slugs.sql before the series detail function/
	);
	assert.equal(maintenanceSnapshot(), beforeMissingSlug);
	assert.equal(
		sql(
			"select to_regclass('public.book_series') is not null and to_regclass('public.book_series_members') is not null and to_regprocedure('public.get_book_detail_with_series(text)') is null;"
		),
		't'
	);
	checks.push(
		'Missing slugs prevent only the page function installation and preserve series storage and installed annotations'
	);
	sql(read('supabase/migrations/20261027000000_public_book_slugs.sql'));
	const slugFor = (i) => 'book-' + i + '-author';
	const detailFor = (i) =>
		user(`select coalesce(public.get_book_detail_with_series('${slugFor(i)}'), 'null'::jsonb);`);
	const beforeSeriesMigration = maintenanceSnapshot();
	const oldPublicFunctions = JSON.parse(
		sql(
			"select jsonb_object_agg(oid::regprocedure::text,pg_get_functiondef(oid)) from pg_proc where pronamespace='public'::regnamespace and prokind='f';"
		)
	);
	sql(read('supabase/migrations/20261028020000_series_book_detail.sql'));
	sql(read('supabase/migrations/20261028020000_series_book_detail.sql'));
	// Simulate the original installed 100-volume limit, then exercise the upgrade.
	sql(`alter table public.book_series_members drop constraint book_series_members_series_number_check;
alter table public.book_series_members add constraint book_series_members_series_number_check check (series_number between 0.01 and 100);`);
	const legacySeriesValidator = read('supabase/migrations/20261028000000_book_series.sql')
		.match(/create function private\.valid_book_series_record\(p_record jsonb\)[\s\S]*?\$\$;/)[0]
		.replace('create function', 'create or replace function')
		.replace(
			/and \(p_record->>'series_number'\)::numeric >= 0\.01\s+and \(p_record->>'series_number'\)::numeric not in \([^;]+\);/,
			"and (p_record->>'series_number')::numeric between 0.01 and 100;"
		);
	sql(legacySeriesValidator);
	assert.equal(
		sql(
			`select private.valid_book_series_record('{"series_title":"Long Series","series_number":109}'::jsonb);`
		),
		'f'
	);
	sql(read('supabase/migrations/20261028010000_series_number_range.sql'));
	sql(read('supabase/migrations/20261028010000_series_number_range.sql'));
	assert.equal(
		sql(
			`select private.valid_book_series_record('{"series_title":"Long Series","series_number":109}'::jsonb);`
		),
		't'
	);
	checks.push(
		'The range upgrade supports earlier 100-volume installations, allows larger finite numbers, is repeatable, and leaves published book rows unchanged'
	);
	assert.equal(maintenanceSnapshot(), beforeSeriesMigration);
	const afterPublicFunctions = JSON.parse(
		sql(
			"select jsonb_object_agg(oid::regprocedure::text,pg_get_functiondef(oid)) from pg_proc where pronamespace='public'::regnamespace and prokind='f';"
		)
	);
	for (const [signature, body] of Object.entries(oldPublicFunctions))
		assert.equal(afterPublicFunctions[signature], body);
	assert.equal(detailFor(1).series, null);
	assert.equal(detailFor(98), null);
	checks.push(
		'Series migration leaves published catalog rows and every existing public RPC definition unchanged; no membership is inferred from ranking context'
	);

	const seriesName = "Shared '$annotation_guard$ (Author A)";
	const v2rows = [
		{ ...row(1), series_title: seriesName, series_number: 0.01 },
		{ ...row(2), series_title: seriesName, series_number: 1.5 },
		{ ...row(3), book_ranking: null, series_title: seriesName, series_number: 10 },
		{ ...row(4), series_title: 'Shared (Author B)', series_number: 109 },
		{ ...row(5), series_title: seriesName, series_number: 1.5 },
		{ ...row(99), series_title: 'Unknown book only', series_number: 1 }
	];
	const v2manifest = {
		...manifest("series-v2 '$annotation_guard$", v2rows.length),
		schema_version: 2
	};
	const prepareV2 = (version, rows) =>
		prepareImport(
			{ ...v2manifest, export_version: version, record_count: rows.length },
			rows.map(JSON.stringify).join('\n')
		);
	const v2 = prepareImport(v2manifest, v2rows.map(JSON.stringify).join('\n'));
	const previewSeries = (version) =>
		JSON.parse(
			sql(
				read('scripts/catalog/preview-book-series-import.sql').replace(
					"'book-annotations-test-001'::text",
					() => `${quote(version)}::text`
				)
			)
		);
	for (const file of v2.files.slice(0, -1)) sql(file.sql);
	const v2Preview = previewSeries(v2manifest.export_version);
	assert.equal(v2Preview.ready_to_apply, true);
	assert.equal(v2Preview.series_memberships_in_update, 5);
	assert.equal(v2Preview.unmatched_export_ids, 1);
	const v2result = JSON.parse(sql(v2.files.at(-1).sql));
	assert.equal(v2result.series_memberships_written, 5);
	assert.equal(v2result.unmatched_export_ids, 1);
	assert.deepEqual(JSON.parse(sql(v2.files.at(-1).sql)), v2result);
	assert.equal(sql('select count(*) from public.book_series;'), '2');
	assert.equal(detailFor(4).series.number, 109);
	for (const invalidNumber of ['NaN', 'Infinity', '-Infinity', '0.001'])
		assert.throws(
			() =>
				sql(
					`update public.book_series_members set series_number = '${invalidNumber}'::numeric where book_id='${id(4)}';`
				),
			/check constraint/
		);
	assert.equal(sql('select count(*) from public.books;'), '5');
	const detail = detailFor(3);
	assert.equal(detail.book.book_ranking, null);
	assert.equal(detail.series.title, seriesName);
	assert.equal(detail.series.number, 10);
	assert.deepEqual(
		detail.series.members.map((m) => [m.book_id, m.number]),
		[
			[id(1), 0.01],
			[id(2), 1.5],
			[id(5), 1.5],
			[id(3), 10]
		]
	);
	assert.deepEqual(Object.keys(detail.series.members[0]).sort(), [
		'book_id',
		'number',
		'slug',
		'title'
	]);
	const anonDetail = JSON.parse(
		sql(
			`begin read only; set local role anon; select public.get_book_detail_with_series('${slugFor(3)}'); commit;`
		)
	);
	assert.deepEqual(anonDetail, detail);
	const seriesVerification = () => JSON.parse(sql(read('scripts/catalog/verify-book-series.sql')));
	let seriesVerified = seriesVerification();
	assert.equal(seriesVerified.invalid_memberships, 0);
	assert.equal(seriesVerified.orphan_series, 0);
	assert.equal(seriesVerified.series_detail_rpc.security_definer, false);
	assert.equal(seriesVerified.series_detail_rpc.volatility, 's');
	for (const table of seriesVerified.tables) {
		assert.equal(table.rls_enabled, true);
		assert.equal(table.anon_can_select, true);
		assert.equal(table.authenticated_can_select, true);
		assert.equal(table.anon_can_write, false);
		assert.equal(table.authenticated_can_write, false);
	}
	assert.deepEqual(Object.values(seriesVerified.private_import_access), [false, false, false]);
	assert.throws(
		() =>
			sql(
				"begin; set local role anon; insert into public.book_series(series_title) values ('denied'); commit;"
			),
		/permission denied/
	);
	checks.push(
		'V2 publication shares canonical names, preserves decimal and tied positions, ignores unmatched IDs, returns minimal ordered members to anon/authenticated readers, and denies reader writes/private import'
	);

	const seriesSnapshot = () =>
		sql(
			'select jsonb_build_array((select jsonb_agg(to_jsonb(s) order by id) from public.book_series s),(select jsonb_agg(to_jsonb(m) order by book_id) from public.book_series_members m));'
		);
	const bad = prepareV2('invalid-series', [{ ...row(4), series_title: 'Valid', series_number: 1 }]);
	for (const file of bad.files.slice(0, -1)) sql(file.sql);
	sql(
		"update private.book_annotation_import_rows set record = jsonb_set(record,'{series_title}','null'::jsonb) where export_version='invalid-series';"
	);
	assert.equal(previewSeries('invalid-series').ready_to_apply, false);
	const beforeInvalidSeries = seriesSnapshot();
	const beforeInvalidBooks = maintenanceSnapshot();
	assert.throws(() => sql(bad.files.at(-1).sql), /Invalid series membership/);
	assert.equal(seriesSnapshot(), beforeInvalidSeries);
	assert.equal(maintenanceSnapshot(), beforeInvalidBooks);
	assert.equal(importStatus('invalid-series').state, 'staging');
	sql("delete from private.book_annotation_import_rows where export_version='invalid-series';");

	const beforeV1 = seriesSnapshot();
	apply(prepare('v1-after-v2', [row(2)]));
	assert.equal(seriesSnapshot(), beforeV1);
	apply(
		prepareV2('series-replace', [
			{ ...row(2), series_title: null, series_number: null },
			{ ...row(3), series_title: 'Renamed Series', series_number: 2.25 },
			{ ...row(4), series_title: null, series_number: null }
		])
	);
	assert.equal(detailFor(2).series, null);
	assert.equal(detailFor(3).series.number, 2.25);
	assert.equal(detailFor(1).series.title, seriesName);
	assert.equal(seriesVerification().orphan_series, 0);
	assert.equal(sql('select count(*) from public.book_series;'), '2');
	checks.push(
		'Invalid series staging rolls back publication; v1 updates retain membership, v2 null clears it, replacements move books, omitted books remain untouched, and unused series rows are removed'
	);

	// Prove detail reads use caller RLS even for peers in an otherwise readable series.
	sql(`drop policy books_public on public.books;
create policy books_public on public.books for select using (book_id <> '${id(5)}');`);
	assert.equal(detailFor(5), null);
	assert.deepEqual(
		detailFor(1).series.members.map((m) => m.book_id),
		[id(1)]
	);
	checks.push(
		'The detail RPC honors book RLS for both the requested book and other series members'
	);

	for (const invalid of [
		{ series_title: null, series_number: 1 },
		{ series_title: 'X', series_number: null },
		{ series_title: 'X', series_number: '1' },
		{ series_title: 'X', series_number: 0 },
		{ series_title: 'X', series_number: 0.001 },
		{ series_title: 'NA', series_number: 1 },
		{}
	]) {
		assert.throws(() => prepareV2('bad-local', [{ ...row(1), ...invalid }]), /series/);
		assert.equal(
			sql(`select private.valid_book_series_record(${quote(JSON.stringify(invalid))}::jsonb);`),
			'f'
		);
	}
	// The generated background SQL must safely quote arbitrary export names, not just this fixture.
	for (const outcome of ['success', 'failure', 'timeout']) {
		const version = `series-bg-${outcome} '$annotation_guard$`;
		const rows = [{ ...row(4), series_title: 'Background Series', series_number: 3.5 }];
		const bgManifest = { ...v2manifest, export_version: version, record_count: rows.length };
		const bg = prepareV2(version, rows);
		for (const file of bg.files.slice(0, -1)) sql(file.sql);
		const job = `book-annotations-${bg.payloadSha256.slice(0, 16)}-apply`;
		const background = backgroundApplySql(bgManifest, bg.payloadSha256).replace(
			"extname = 'pg_cron'",
			"extname = 'plpgsql'"
		);
		assert.equal(JSON.parse(sql(background)).state, 'staging');
		assert.throws(() => sql(background), /An import job already exists/);
		const beforeRun = sql('select jsonb_agg(to_jsonb(b) order by book_id) from books b;');
		const beforeSeries = seriesSnapshot();
		if (outcome !== 'success')
			sql(`create function public.generated_background_guard() returns trigger language plpgsql as $$
begin ${outcome === 'timeout' ? 'perform pg_sleep(1); return new;' : "raise exception 'generated fixture failure';"} end; $$;
create trigger generated_background_guard before update on books for each row execute function public.generated_background_guard();`);
		let command = sql(`select command from cron.job where jobname=${quote(job)};`);
		if (outcome === 'timeout')
			command = command.replace("statement_timeout = '5min'", "statement_timeout = '100ms'");
		docker([
			'exec',
			container,
			'psql',
			'-X',
			'-q',
			'-A',
			'-t',
			'-v',
			'ON_ERROR_STOP=1',
			'-U',
			'postgres',
			'-c',
			command
		]);
		assert.equal(sql(`select count(*) from cron.job where jobname=${quote(job)};`), '0');
		const status = importStatus(version);
		if (outcome === 'success') {
			assert.equal(status.state, 'applied');
			assert.equal(status.summary.series_memberships_written, 1);
			assert.equal(JSON.parse(sql(background)).scheduled_job, null);
		} else {
			assert.equal(status.state, 'staging');
			assert.equal(
				status.summary.last_background_attempt.sqlstate,
				outcome === 'timeout' ? '57014' : 'P0001'
			);
			assert.equal(sql('select jsonb_agg(to_jsonb(b) order by book_id) from books b;'), beforeRun);
			assert.equal(seriesSnapshot(), beforeSeries);
			sql(
				'drop trigger generated_background_guard on books; drop function public.generated_background_guard();'
			);
			sql(bg.resetStaging.sql);
		}
	}
	checks.push(
		'Local v2 preparation and SQL reject malformed series fields; generated background SQL safely handles quotes/dollar delimiters, prevents duplicate jobs, rolls back books AND series on failure/timeout, and removes its job (Cron API modeled)'
	);
	console.log(
		JSON.stringify({ passed: checks.length, checks, live_database_access: false }, null, 2)
	);
} finally {
	try {
		docker(['stop', container]);
	} catch {
		/* Only the owned disposable container. */
	}
}
