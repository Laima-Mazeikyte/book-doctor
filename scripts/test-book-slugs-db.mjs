// Isolated Docker PostgreSQL only. Never reads .env or connects to production.
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
	prepareSlugBackground,
	SLUG_JOB_NAME,
	SLUG_JOB_MARKER
} from './prepare-book-slug-background.mjs';

const container = `book-slugs-${randomUUID().slice(0, 8)}`;
const docker = (args, input) =>
	execFileSync('docker', args, {
		input,
		encoding: 'utf8',
		stdio: ['pipe', 'pipe', 'pipe'],
		maxBuffer: 32 * 1024 * 1024
	});
const psqlArgs = [
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
];
const sql = (query) => docker(psqlArgs, query).trim();
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const uid = '11111111-1111-4111-8111-111111111111';
const checks = [];
const fixture = [
	{
		book_id: '01TEST00000000000000000001',
		book_name: 'Émile & the Sea!',
		author: 'An Author',
		year: 2000
	},
	{
		book_id: '01TEST00000000000000000002',
		book_name: 'Ouran High School Host Club, Vol. 1',
		author: 'Bisco Hatori',
		year: 2003
	},
	{
		book_id: '01TEST00000000000000000003',
		book_name: 'Ouran High School Host Club, Vol. 2',
		author: 'Bisco Hatori',
		year: 2004
	}
];
const snapshotArg = process.argv.indexOf('--catalog-snapshot');
const books =
	snapshotArg >= 0
		? JSON.parse(readFileSync(process.argv[snapshotArg + 1], 'utf8')).books
		: fixture;
if (!Array.isArray(books) || books.length < 3)
	throw new Error('Expected at least three catalog records');

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
	for (let i = 0; i < 100; i++) {
		try {
			docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']);
			ready = true;
			break;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}
	assert.ok(ready, 'PostgreSQL startup');
	const textColumns = [
		'genre1',
		'genre2',
		'genre3',
		'genre4',
		'genre5',
		'genre6',
		'genre7',
		'type',
		'quality_band',
		...Array.from({ length: 10 }, (_, i) => `keyword${i + 1}`)
	];
	const numberColumns = [
		'pace_value',
		'vocabulary_value',
		'depth_value',
		'originality_value',
		'discussion_potential_value',
		'violence_value',
		'spice_value',
		'atmosphere_value',
		'entry_barrier_value'
	];
	sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create table public.books(id uuid default gen_random_uuid(),book_id text primary key,book_name text,author text,year integer,summary text,
      ${textColumns.map((c) => `${c} text`).join(',')},${numberColumns.map((c) => `${c} double precision`).join(',')},book_ranking jsonb,author_ranking jsonb,awards jsonb);
    create table public.feed_requests(id bigint,user_id uuid,status text,error_message text,created_at timestamptz);
    create table public.feed_items(request_id text,book_id text,rank integer);
    create table public.user_ratings(user_id uuid,book_id text);
    create table public.user_bookmarks(user_id uuid,book_id text);
    create table public.user_not_interested(user_id uuid,book_id text);
    create table public.top_100_books(book_id text,genre text,display_order smallint);
    alter table books enable row level security;
    create policy public_books on books for select using(true);
    grant select on all tables in schema public to anon,authenticated;
  `);
	const csv = (value) => (value == null ? '' : `"${String(value).replaceAll('"', '""')}"`);
	sql(
		`copy public.books(book_id,book_name,author,year) from stdin with(format csv);\n${books.map((b) => [b.book_id, b.book_name, b.author, b.year].map(csv).join(',')).join('\n')}\n\\.\n`
	);
	const installationStatus = () =>
		JSON.parse(sql(read('scripts/catalog/check-book-series-installation.sql')));
	assert.equal(installationStatus().slug_column_present, false);
	// A disconnected dashboard can leave a real transaction holding both these locks.
	// The catalog-only status query must still return without waiting on the books lock.
	const heldMigration = promisify(execFile)(
		'docker',
		[
			...psqlArgs,
			'-c',
			'begin; lock table public.books in access exclusive mode; select pg_advisory_xact_lock(20261027,1); select pg_sleep(3); rollback;'
		],
		{ encoding: 'utf8' }
	);
	let observedMigration;
	for (let attempt = 0; attempt < 15; attempt++) {
		observedMigration = installationStatus();
		if (
			observedMigration.observed_migration_sessions.some(
				(s) => s.slug_allocation_lock && s.catalog_schema_lock
			)
		)
			break;
		await new Promise((resolve) => setTimeout(resolve, 40));
	}
	await heldMigration;
	assert.equal(observedMigration.slug_column_present, false);
	assert.ok(
		observedMigration.observed_migration_sessions.some(
			(s) => s.slug_allocation_lock && s.catalog_schema_lock
		)
	);
	assert.equal(installationStatus().observed_migration_sessions.length, 0);
	checks.push(
		'Read-only installation status detects an active allocation/schema transaction without blocking on books or claiming an uncommitted installation succeeded'
	);
	let backfillMs = 0;
	const slugMigration = read('supabase/migrations/20261027000000_public_book_slugs.sql');
	const backgroundSql = prepareSlugBackground(slugMigration);
	assert.equal(backgroundSql, read('scripts/catalog/apply-book-slugs-background.sql'));
	assert.throws(() => sql(backgroundSql), /pg_cron is not installed/);
	// Model Cron's API/history; execute its command as a single protocol message.
	// The real hosted timer and history writer are not exercised in this fixture.
	sql(`create schema cron;
create table cron.job(jobid bigint generated always as identity primary key,
  jobname text unique, schedule text, command text, database name default current_database(),
  username name default current_user, active boolean default true);
create table cron.job_run_details(runid bigint generated always as identity primary key,
  jobid bigint, job_pid integer, database name default current_database(), username name default current_user,
  command text, status text, return_message text, start_time timestamptz default now(), end_time timestamptz);
create function cron.schedule(text,text,text) returns bigint language sql as $$
  insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid; $$;
create function cron.unschedule(text) returns boolean language sql as $$
  with removed as(delete from cron.job where jobname=$1 returning jobid)
  select exists(select 1 from removed); $$;`);
	const scheduleSql = backgroundSql.replace("extname = 'pg_cron'", "extname = 'plpgsql'");
	const backgroundStatus = () =>
		JSON.parse(sql(read('scripts/catalog/book-slug-background-status.sql')));
	const bookFingerprint = () =>
		sql(
			"select md5(string_agg(md5(to_jsonb(b)::text), E'\\n' order by book_id)) from public.books b;"
		);
	for (const outcome of ['failure', 'timeout', 'success']) {
		const beforeBooks = bookFingerprint();
		const scheduled = JSON.parse(sql(scheduleSql));
		assert.ok(scheduled.scheduled_job.active);
		assert.throws(() => sql(scheduleSql), /already scheduled/);
		assert.equal(installationStatus().slug_column_present, false);
		let command = sql(`select command from cron.job where jobname=${quote(SLUG_JOB_NAME)};`);
		assert.ok(command.startsWith('-- ' + SLUG_JOB_MARKER));
		assert.equal(backgroundStatus().scheduled_job.job_id, scheduled.scheduled_job.job_id);
		if (outcome !== 'success') {
			sql(`create function public.slug_background_fixture_guard() returns trigger language plpgsql as $$
begin ${outcome === 'failure' ? "raise exception 'slug fixture failure';" : 'perform pg_sleep(1); return new;'} end; $$;
create trigger slug_background_fixture_guard before update on public.books
for each row execute function public.slug_background_fixture_guard();`);
			if (outcome === 'timeout')
				command = command.replaceAll("statement_timeout = '5min'", "statement_timeout = '100ms'");
		}
		const runId = sql(`insert into cron.job_run_details(jobid,job_pid,command,status)
values(${scheduled.scheduled_job.job_id},pg_backend_pid(),${quote(command)},'running') returning runid;`);
		const run = () => docker([...psqlArgs, '-c', command]);
		const runStarted = performance.now();
		run();
		if (outcome === 'success') {
			backfillMs = Math.round(performance.now() - runStarted);
			sql(
				`update cron.job_run_details set status='succeeded', end_time=now(), return_message='COMMIT' where runid=${runId};`
			);
		} else {
			sql(
				`update cron.job_run_details set status='succeeded', end_time=now(), return_message='DO' where runid=${runId};`
			);
			assert.equal(bookFingerprint(), beforeBooks);
			assert.equal(installationStatus().slug_column_present, false);
			sql(
				'drop trigger slug_background_fixture_guard on public.books; drop function public.slug_background_fixture_guard();'
			);
		}
		assert.equal(sql(`select count(*) from cron.job where jobname=${quote(SLUG_JOB_NAME)};`), '0');
		const status = backgroundStatus();
		assert.equal(status.scheduled_job, null);
		assert.equal(status.recorded_attempt.state, outcome === 'success' ? 'completed' : 'failed');
		assert.equal(status.recent_migration_runs[0].status, 'succeeded');
		if (outcome !== 'success')
			assert.equal(
				status.recorded_attempt.error_sqlstate,
				outcome === 'timeout' ? '57014' : 'P0001'
			);
	}
	assert.throws(() => sql(scheduleSql), /books.slug already exists/);
	checks.push(
		'Background install guards duplicate/installed jobs; migration SQL error/timeout rolls back all DDL/backfill, records the true result privately, then removes the job (Cron API/history modeled)'
	);
	const installed = installationStatus();
	for (const key of [
		'slug_column_present',
		'slug_column_not_null',
		'slug_unique_index_valid',
		'slug_allocation_trigger_present'
	])
		assert.equal(installed[key], true);
	assert.equal(installed.series_table, null);
	const catalog = JSON.parse(
		sql(
			`select json_build_object('books',count(*),'uniqueSlugs',count(distinct slug),'missingSlugs',count(*) filter(where slug is null),'maximumLength',max(length(slug)),'suffixesAllocated',count(*) filter(where slug <> private.book_slug_base(book_name,author))) from books;`
		)
	);
	assert.equal(catalog.books, books.length);
	assert.equal(catalog.uniqueSlugs, books.length);
	assert.equal(catalog.missingSlugs, 0);
	checks.push(`Backfilled ${books.length} catalog books with unique non-null stored slugs`);
	const examples = [
		['Émile & the Sea!', 'An Author', 'emile-the-sea-an-author'],
		['夜の本', '著者', '夜の本-著者'],
		[
			'The Hitchhiker’s Guide to the Galaxy',
			'Douglas Adams',
			'the-hitchhikers-guide-to-the-galaxy-douglas-adams'
		],
		[
			'A report',
			'National Commission on Terrorist Attacks Upon the United States',
			'a-report-9-11-commission'
		]
	];
	for (const [title, author, expected] of examples)
		assert.equal(sql(`select private.book_slug_base(${quote(title)},${quote(author)});`), expected);
	const volumeTitle = 'Cherry Magic! Thirty Years of Virginity Can Make You a Wizard?!, Vol. 2';
	assert.match(
		sql(`select private.book_slug_base(${quote(volumeTitle)},'Yuu Toyota');`),
		/-vol-2-yuu-toyota$/
	);
	assert.match(
		sql(
			`select private.book_slug_base('Everything You Wanted to Know About Indians But Were Afraid to Ask: Young Readers Edition','Anton Treuer');`
		),
		/-young-readers-edition-anton-treuer$/
	);
	checks.push(
		'Accent/non-Latin handling, apostrophes, institution labels and distinguishing qualifiers'
	);
	const stored = sql(`select slug from books where book_id=${quote(books[0].book_id)};`);
	sql(
		`update books set book_name='A corrected title',author='A corrected author' where book_id=${quote(books[0].book_id)};`
	);
	assert.equal(sql(`select slug from books where book_id=${quote(books[0].book_id)};`), stored);
	assert.throws(
		() =>
			sql(`update books set slug='replacement-address' where book_id=${quote(books[0].book_id)};`),
		/permanent/
	);
	assert.throws(
		() =>
			sql(
				"insert into books(book_id,book_name,author,slug) values ('invalid','Title','Author','invalid/slug');"
			),
		/books_slug_format/
	);
	assert.throws(
		() =>
			sql(
				`insert into books(book_id,book_name,author,slug) values ('duplicate','Title','Author',${quote(stored)});`
			),
		/books_slug_key/
	);
	checks.push(
		'Metadata corrections preserve addresses; mutation, malformed slugs and duplicates are rejected'
	);
	const asyncExec = promisify(execFile);
	await Promise.all(
		[1, 2].map((n) =>
			asyncExec('docker', [
				...psqlArgs,
				'-c',
				`begin; insert into books(book_id,book_name,author) values ('concurrent-${n}','Concurrent book','Same Author'); select pg_sleep(0.1); commit;`
			])
		)
	);
	assert.deepEqual(
		JSON.parse(
			sql("select json_agg(slug order by slug) from books where book_id like 'concurrent-%';")
		),
		['concurrent-book-same-author', 'concurrent-book-same-author-2']
	);
	checks.push('Concurrent inserts allocate distinct, short suffixes for identical labels');

	sql(read('supabase/migrations/20261027010000_slug_book_reads.sql'));
	sql(`insert into user_ratings values ('${uid}',${quote(books[2].book_id)});
    insert into feed_requests values(42,'${uid}','completed',null,now());
    insert into feed_items values('42',${quote(books[0].book_id)},1),('42',${quote(books[1].book_id)},2);
    insert into top_100_books values(${quote(books[0].book_id)},'Fantasy',1);`);
	const asUser = (query) =>
		JSON.parse(
			sql(
				`begin read only; set local role authenticated; set local test.uid='${uid}'; ${query} commit;`
			)
		);
	assert.equal(
		asUser('select public.get_rate_feed_bootstrap_annotated(50);').books[0].slug,
		stored
	);
	assert.equal(
		asUser("select public.get_eligible_feed_books_annotated('42',100);")[0].slug,
		stored
	);
	assert.equal(asUser('select public.get_eligible_top_100_books_annotated();')[0].slug, stored);
	checks.push('All three annotated feed functions return persisted slugs to authenticated readers');

	const seriesMigration = read('supabase/migrations/20261028020000_series_book_detail.sql');
	const detailStart = seriesMigration.indexOf(
		'create or replace function public.get_book_detail_with_series('
	);
	assert.ok(detailStart > 0);
	sql(`create table public.book_series(id bigint primary key,series_title text);
    create table public.book_series_members(book_id text,series_id bigint,series_number numeric);
    grant select on public.book_series,public.book_series_members to anon,authenticated;
    insert into book_series values(1,'Example series');
    insert into book_series_members values(${quote(books[0].book_id)},1,1),(${quote(books[1].book_id)},1,1.5);`);
	sql(seriesMigration.slice(detailStart, seriesMigration.indexOf('notify pgrst', detailStart)));
	const detail = JSON.parse(
		sql(
			`begin read only; set local role anon; select public.get_book_detail_with_series(${quote(stored)}); commit;`
		)
	);
	assert.equal(detail.book.slug, stored);
	assert.equal(detail.series.members.length, 2);
	assert.ok(detail.series.members.every((m) => m.slug));
	assert.equal(sql("select public.get_book_detail_with_series('not-a-real-book') is null;"), 't');
	assert.equal(
		sql("select has_function_privilege('anon','private.assign_book_slug()','execute');"),
		'f'
	);
	checks.push(
		'Anonymous detail lookup returns stored addresses for the book and its ordered series members'
	);
	const inventory = JSON.parse(sql(read('scripts/catalog/verify-book-urls.sql')));
	assert.equal(inventory.catalog_books, books.length + 2);
	assert.equal(inventory.unique_slugs, inventory.catalog_books);
	assert.equal(inventory.missing_slugs, 0);
	assert.equal(inventory.detail_rpc, true);
	assert.equal(inventory.allocation_trigger, true);
	checks.push(
		'Post-installation verification SQL reports complete unique addresses and required database objects'
	);
	const report = { books: books.length, backfillMs, catalog, checks };
	if (process.argv.includes('--report'))
		writeFileSync('temp/book-slug-db-validation.json', JSON.stringify(report, null, 2) + '\n');
	console.log(JSON.stringify(report, null, 2));
} finally {
	docker(['rm', '-f', container]);
}
