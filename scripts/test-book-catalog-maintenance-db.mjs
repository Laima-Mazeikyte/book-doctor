// Disposable local database only: actual pg_cron background workers, never .env/live Supabase.
// Requires the already-downloaded public.ecr.aws/supabase/postgres:17.11.0.006 image.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const container = `book-maintenance-${randomUUID().slice(0, 8)}`;
const image = 'public.ecr.aws/supabase/postgres:17.11.0.006';
const docker = (args, input) =>
	execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const args = [
	'exec',
	'-i',
	container,
	'psql',
	'-X',
	'-q',
	'-A',
	'-t',
	'-U',
	'postgres',
	'-v',
	'ON_ERROR_STOP=1'
];
const sql = (query) => docker(args, query).trim();
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const read = (name) => readFileSync(new URL(`maintenance/${name}`, import.meta.url), 'utf8');
const schedule = read('compact-book-catalog-background.sql');
const status = () => JSON.parse(sql(read('book-catalog-compaction-background-status.sql')));
const size = () => Number(sql("select pg_total_relation_size('public.books');"));
const snapshot = () =>
	sql(`select jsonb_build_object(
  'rows', md5(string_agg(to_jsonb(b)::text, E'\n' order by id)),
  'indexes', (select jsonb_agg(pg_get_indexdef(indexrelid) order by indexrelid)
    from pg_index where indrelid='public.books'::regclass),
  'access', (select jsonb_build_array(relrowsecurity, relacl::text) from pg_class where oid='public.books'::regclass),
  'policies', (select jsonb_agg(to_jsonb(p)) from pg_policies p where tablename='books')
) from books b;`);
const checks = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const observerCommand = () =>
	sql("select command from cron.job where jobname='book-doctor-books-compaction-observer';");
const waitForNativeRun = async () => {
	for (let i = 0; i < 200; i++) {
		const report = status();
		if (['succeeded', 'failed'].includes(report.latest_native_worker_run?.status)) return report;
		await sleep(100);
	}
	throw new Error('Native pg_cron worker did not finish within the fixture deadline');
};
const launchSoon = (workerId) =>
	sql(`select cron.alter_job(${workerId}, schedule := '5 seconds');`);

try {
	docker(['image', 'inspect', image]); // Do not pull images or contact a service.
	docker([
		'run',
		'--rm',
		'-d',
		'--name',
		container,
		'--user',
		'postgres',
		'--entrypoint',
		'/bin/bash',
		image,
		'-c',
		'set -e\ninitdb -D /tmp/book-maintenance-db -A trust >/dev/null\nexec postgres -D /tmp/book-maintenance-db -c shared_preload_libraries=pg_cron -c cron.database_name=postgres -c cron.use_background_workers=on -c cron.log_run=on -c cron.timezone=America/Chicago'
	]);
	let ready = false;
	for (let i = 0; i < 100; i++) {
		try {
			docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']);
			ready = true;
			break;
		} catch {
			await sleep(200);
		}
	}
	assert.ok(ready, 'Disposable PostgreSQL must start');
	sql(`create role anon; create role authenticated; create role service_role bypassrls;
create table books(id integer primary key, slug text unique, annotation jsonb, padding text) with (autovacuum_enabled=false);
create index books_padding_idx on books(padding);
insert into books select i,'book-'||i,jsonb_build_object('rank',i),repeat(md5(i::text),20) from generate_series(1,3000)i;
alter table books enable row level security; create policy catalog_read on books for select using(true);
grant select on books to anon, authenticated;
update books set padding=padding||'a'; update books set padding=padding||'b';`);
	sql('vacuum books;');
	const original = snapshot();
	assert.throws(() => sql(schedule), /Existing pg_cron with run history is required/);
	assert.equal(sql("select to_regclass('private.book_catalog_compaction') is null;"), 't');
	sql('create extension pg_cron;');
	assert.equal(sql('show cron.use_background_workers;'), 'on');
	const result = JSON.parse(sql(schedule));
	const first = result.attempt;
	const localRun = sql(
		`select to_char(${quote(first.scheduled_for)}::timestamptz at time zone 'America/Chicago', 'MI FMHH24 FMDD FMMM') || ' *';`
	);
	assert.equal(
		sql(`select schedule from cron.job where jobid=${first.worker_job_id};`),
		localRun.replace(/^0([0-9]) /, '$1 ')
	);
	const worker = sql(`select command from cron.job where jobid=${first.worker_job_id};`);
	assert.match(
		worker,
		/^-- book-doctor:books-compaction\s+vacuum \(full, analyze, skip_locked\) public\.books;$/
	);
	assert.throws(() => sql(schedule), /compaction job already exists/);
	assert.equal(status().attempt.attempt, 1);
	assert.equal(snapshot(), original);
	for (const role of ['anon', 'authenticated', 'service_role'])
		assert.equal(
			sql(
				`select has_table_privilege('${role}','private.book_catalog_compaction','SELECT, INSERT, UPDATE, DELETE');`
			),
			'f'
		);
	checks.push(
		'Missing Cron rolls back; scheduling preserves data, isolates private audit, honors Cron timezone and refuses duplicates'
	);
	const observer = observerCommand();
	const before = size();
	launchSoon(first.worker_job_id); // Fixture-only timer acceleration; deployed worker is calendar scheduled.
	let report = await waitForNativeRun();
	assert.equal(report.latest_native_worker_run.status, 'succeeded');
	sql(observer);
	report = status();
	assert.equal(report.attempt.state, 'finished');
	assert.ok(report.attempt.recorded_bytes_reclaimed > 0);
	assert.ok(size() < before);
	assert.deepEqual(report.remaining_jobs, []);
	assert.equal(snapshot(), original);
	checks.push(
		'Real pg_cron background worker executes standalone VACUUM, reduces allocation and preserves book values, slugs, indexes, RLS, policies and grants'
	);

	const failed = JSON.parse(sql(schedule)).attempt;
	const failureObserver = observerCommand();
	const beforeFailure = size();
	sql(`select cron.alter_job(${failed.worker_job_id}, command := 'select 1/0;');`); // Inject a native SQL failure.
	launchSoon(failed.worker_job_id);
	report = await waitForNativeRun();
	assert.equal(report.latest_native_worker_run.status, 'failed');
	sql(failureObserver);
	report = status();
	assert.equal(report.attempt.state, 'failed');
	assert.match(report.attempt.message, /division by zero/);
	assert.deepEqual(report.remaining_jobs, []);
	assert.equal(size(), beforeFailure);
	assert.equal(snapshot(), original);
	checks.push(
		'Native SQL failure is recorded as failed and both jobs are removed without automatic retry'
	);

	const expired = JSON.parse(sql(schedule)).attempt;
	const expiryObserver = observerCommand();
	sql(
		"update private.book_catalog_compaction set scheduled_for=clock_timestamp()-interval '16 minutes';"
	);
	sql(expiryObserver);
	report = status();
	assert.equal(report.attempt.state, 'not_started');
	assert.equal(report.latest_native_worker_run, null);
	assert.deepEqual(report.remaining_jobs, []);
	assert.equal(snapshot(), original);
	assert.ok(expired.worker_job_id > failed.worker_job_id);
	checks.push('A missed calendar run expires without leaving an annual maintenance retry');

	const skipped = JSON.parse(sql(schedule)).attempt;
	const skipObserver = observerCommand();
	const heldSize = size();
	const holder = spawn('docker', args, { stdio: ['pipe', 'ignore', 'pipe'] });
	let holderError = '';
	holder.stderr.on('data', (chunk) => {
		holderError += chunk;
	});
	const held = new Promise((resolve) =>
		holder.on('exit', (code) => resolve({ code, holderError }))
	);
	holder.stdin.end('begin; lock books in access exclusive mode; select pg_sleep(9); rollback;');
	for (let i = 0; i < 40; i++) {
		if (
			sql(
				"select exists(select 1 from pg_locks where relation='books'::regclass and mode='AccessExclusiveLock' and granted);"
			) === 't'
		)
			break;
		await sleep(25);
	}
	launchSoon(skipped.worker_job_id);
	report = await waitForNativeRun();
	assert.equal(report.latest_native_worker_run.status, 'succeeded');
	// Stop future fixture-only 5-second runs while this attempt is still held open.
	sql(`select cron.alter_job(${skipped.worker_job_id}, schedule := '0 0 1 1 *');`);
	assert.equal((await held).code, 0);
	sql(skipObserver);
	report = status();
	assert.equal(report.attempt.state, 'finished');
	assert.equal(report.attempt.recorded_bytes_reclaimed, 0);
	assert.deepEqual(report.remaining_jobs, []);
	assert.equal(size(), heldSize);
	assert.equal(snapshot(), original);
	checks.push(
		'A busy table can yield native success with zero recovered bytes; observer removes jobs and status stays readable during the lock'
	);
	console.log(
		JSON.stringify(
			{
				passed: checks.length,
				checks,
				native_pg_cron_background_workers: true,
				live_database_access: false
			},
			null,
			2
		)
	);
} finally {
	docker(['rm', '-f', container]);
}
