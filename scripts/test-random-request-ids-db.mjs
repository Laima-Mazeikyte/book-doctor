// Disposable PostgreSQL only. Does not read .env or connect to the shared database.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const container = `random-request-ids-${randomUUID().slice(0, 8)}`;
const docker = (args, input) =>
	execFileSync('docker', args, {
		input,
		encoding: 'utf8',
		stdio: ['pipe', 'pipe', 'pipe']
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
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const asUser = (uid, query) =>
	`set role authenticated; set request.jwt.claim.sub = '${uid}'; ${query}`;
const tables = ['recommendation_requests', 'feed_requests'];
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
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']);
			ready = true;
			break;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}
	assert.ok(ready, 'PostgreSQL starts');
	sql(`
		create role anon; create role authenticated; create role service_role bypassrls;
		create schema auth;
		grant usage on schema auth to authenticated;
		create function auth.uid() returns uuid language sql stable as
		$$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
	`);
	sql(read('supabase/migrations/20260317000000_add_recommendation_requests.sql'));
	sql(read('supabase/migrations/20260327000000_feed_requests_and_items.sql'));
	sql(`
		grant usage on all sequences in schema public to authenticated;
		grant select, insert on public.recommendation_requests, public.feed_requests to authenticated;
		grant all on public.recommendation_requests, public.feed_requests to service_role;
		insert into public.recommendation_requests (user_id) values ('${userA}');
		insert into public.feed_requests (user_id) values ('${userA}');
		insert into public.feed_items (request_id, user_id, book_id, rank)
		values ('1', '${userA}', 'legacy-book', 1);
		create table public.webhook_records (kind text, payload jsonb);
		create function public.capture_webhook() returns trigger language plpgsql security definer set search_path = '' as $$
		begin
			insert into public.webhook_records values (tg_table_name, to_jsonb(new));
			return new;
		end; $$;
		create trigger webhook after insert on public.recommendation_requests
		for each row execute function public.capture_webhook();
		create trigger webhook after insert on public.feed_requests
		for each row execute function public.capture_webhook();
	`);
	sql(`create function public.get_rate_feed_bootstrap_annotated(p_limit integer default 100)
 returns jsonb language sql stable as $$select jsonb_build_object(
 'request_id', '1', 'latest_request_id', '1', 'books', '[]'::jsonb, 'limit', p_limit)$$;`);
	const candidateFunction = () =>
		sql("select pg_get_functiondef('private.random_request_id_candidate()'::regprocedure);");
	sql(read('supabase/migrations/20261105000000_random_request_ids.sql'));
	const originalCandidateFunction = candidateFunction();
	assert.equal(sql("select request_id from public.feed_items where book_id = 'legacy-book'"), '1');
	for (const table of tables) {
		assert.equal(sql(asUser(userA, `select id from public.${table} where id = 1;`)), '1');
		assert.equal(
			sql(
				`select attidentity from pg_attribute where attrelid = 'public.${table}'::regclass and attname = 'id';`
			),
			'a'
		);
		const id = Number(
			sql(asUser(userA, `insert into public.${table} (user_id) values ('${userA}') returning id;`))
		);
		assert.equal(id, 2);
		const alias = sql(asUser(userA, `select public_id from public.${table} where id = ${id};`));
		assert.match(alias, /^[A-Za-z0-9]{8}$/);
		assert.match(alias, /[A-Za-z]/);
		assert.match(sql(`select public_id from public.${table} where id = 1;`), /^[A-Za-z0-9]{8}$/);
		assert.throws(
			() => sql(`update public.${table} set public_id = 'Changed1' where id = 1;`),
			/cannot be changed/
		);
		assert.throws(
			() => sql(`insert into public.${table}(user_id, public_id) values ('${userA}', 'Chosen01');`),
			/generated automatically/
		);
		assert.ok(Number.isSafeInteger(id));
		assert.equal(sql(asUser(userB, `select count(*) from public.${table} where id = ${id};`)), '0');
		assert.throws(
			() => sql(asUser(userB, `insert into public.${table} (user_id) values ('${userA}');`)),
			/row-level security/
		);
		assert.throws(
			() =>
				sql(asUser(userA, `insert into public.${table} (id, user_id) values (42, '${userA}');`)),
			/non-DEFAULT value/
		);
		assert.equal(
			sql(
				`select payload->>'id' from public.webhook_records where kind = '${table}' and payload->>'id' = '${id}';`
			),
			String(id)
		);
	}
	checks.push(
		'Legacy keys/references and numeric webhook IDs stay intact; random aliases are generated, immutable, and protected by ownership'
	);
	assert.equal(
		sql(
			"select has_function_privilege('authenticated', 'public.assign_random_request_public_id()', 'execute');"
		),
		'f'
	);
	assert.equal(
		sql(
			"select has_function_privilege('authenticated', 'private.random_request_id_candidate()', 'execute');"
		),
		'f'
	);
	checks.push(
		'ID generation works through inserts without granting direct execution of privileged functions'
	);

	// Force a collision with a row hidden from the inserting account by RLS.
	for (const [index, table] of tables.entries()) {
		const occupied = `TakenId${index}`;
		const next = `FreshId${index}`;
		sql(`
			create or replace function private.random_request_id_candidate() returns text
			language sql volatile set search_path = '' as $$select '${occupied}'::text$$;
			insert into public.${table} (user_id) values ('${userA}');
			create sequence public.forced_candidates;
			create or replace function private.random_request_id_candidate() returns text
			language sql volatile set search_path = '' as $$
				select case when nextval('public.forced_candidates') = 1 then '${occupied}'::text else '${next}'::text end
			$$;
		`);
		assert.equal(
			sql(
				asUser(
					userB,
					`insert into public.${table} (user_id) values ('${userB}') returning public_id;`
				)
			),
			String(next)
		);
		assert.equal(sql('select last_value from public.forced_candidates;'), '2');
		sql('drop sequence public.forced_candidates;');
	}
	checks.push(
		'Occupied IDs retry transparently even when the existing row belongs to another account'
	);

	// Hold the first candidate in another session and prove allocation retries it
	// without waiting for that transaction or risking a batch lock deadlock.
	const blocked = 'Blocked1';
	sql(`
		create sequence public.forced_candidates;
		create or replace function private.random_request_id_candidate() returns text
		language sql volatile set search_path = '' as $$
			select case when nextval('public.forced_candidates') = 1 then '${blocked}'::text else 'NextId01'::text end
		$$;
	`);
	const holder = execFile('docker', [
		...psqlArgs,
		'-c',
		`begin;
		select pg_advisory_xact_lock(hashtext('public.recommendation_requests'), hashtext('${blocked}'));
		select pg_sleep(30); commit;`
	]);
	const holderDone = new Promise((resolve) => holder.on('exit', resolve));
	try {
		let locked = false;
		for (let attempt = 0; attempt < 30; attempt++) {
			locked =
				sql(`select exists(select 1 from pg_locks where locktype = 'advisory' and granted);`) ===
				't';
			if (locked) break;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		assert.ok(locked, 'Other session holds candidate lock');
		assert.equal(
			sql(
				asUser(
					userB,
					`set statement_timeout = '2s'; insert into public.recommendation_requests (user_id) values ('${userB}') returning public_id;`
				)
			),
			'NextId01'
		);
	} finally {
		sql(
			"select pg_terminate_backend(pid) from pg_stat_activity where pid <> pg_backend_pid() and query like '%pg_sleep(30)%';"
		);
		await holderDone;
	}
	sql('drop sequence public.forced_candidates;');
	sql(originalCandidateFunction);
	checks.push('Concurrent candidate reservations retry immediately');

	// Real cryptographic generator, multiple clients, and multi-row inserts.
	const run = promisify(execFile);
	await Promise.all(
		Array.from({ length: 4 }, (_, index) =>
			run('docker', [
				...psqlArgs,
				'-c',
				asUser(
					index % 2 ? userA : userB,
					tables
						.map(
							(table) =>
								`insert into public.${table} (user_id) select '${index % 2 ? userA : userB}'::uuid from generate_series(1, 500);`
						)
						.join('\n')
				)
			])
		)
	);
	for (const table of tables) {
		const ids = JSON.parse(
			sql(
				`select json_agg(payload->>'public_id' order by ctid) from public.webhook_records where kind = '${table}';`
			)
		);
		assert.ok(ids.length >= 2000);
		assert.equal(new Set(ids).size, ids.length);
		assert.ok(ids.every((id) => /^[A-Za-z0-9]{8}$/.test(id) && /[A-Za-z]/.test(id)));
		assert.ok(ids.some((id, index) => index > 0 && id < ids[index - 1]));
		assert.ok(ids.some((id, index) => index > 0 && id > ids[index - 1]));
	}
	checks.push(
		'4,000 concurrent bulk inserts have unique 8-character public IDs with no sequence ordering'
	);
	const feedId = sql(
		`insert into public.feed_requests (user_id) values ('${userA}') returning id;`
	);
	sql(
		`set role service_role; update public.feed_requests set status = 'completed', result_count = 1 where id = ${feedId};`
	);
	assert.equal(
		sql(asUser(userA, `select status from public.feed_requests where id = ${feedId};`)),
		'completed'
	);
	checks.push('Backend lifecycle updates still use numeric internal IDs');
	const payload = JSON.parse(
		sql(asUser(userA, 'select public.get_rate_feed_bootstrap_public(17);'))
	);
	assert.match(payload.request_id, /^[A-Za-z0-9]{8}$/);
	assert.equal(payload.latest_request_id, payload.request_id);
	assert.equal(payload.limit, 17);
	const hidden = JSON.parse(sql(asUser(userB, 'select public.get_rate_feed_bootstrap_public();')));
	assert.equal(hidden.request_id, '');
	assert.equal(hidden.latest_request_id, null);
	checks.push(
		'Single-call bootstrap returns public aliases with RLS and preserves its other fields'
	);
	for (const check of checks) console.log(`PASS ${check}`);
} finally {
	docker(['rm', '-f', container]);
}
