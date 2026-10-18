// Requires Docker and postgres:17. Uses an isolated disposable database, never .env.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const container = `book-corrections-test-${randomUUID()}`;
const docker = (args, options = {}) =>
	execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
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
const sql = (query) => docker(psqlArgs, { input: query }).trim();
const uid = '11111111-1111-4111-8111-111111111111';
const otherUid = '22222222-2222-4222-8222-222222222222';
const rollingUid = '33333333-3333-4333-8333-333333333333';
const concurrentUid = '44444444-4444-4444-8444-444444444444';
const validationUid = '55555555-5555-4555-8555-555555555555';
const book = (index) => `01${String(index).padStart(24, '0')}`;
const userSql = (query, user = uid, anonymous = false) => `set role authenticated;
  set request.jwt.claims = '${JSON.stringify({ sub: user, is_anonymous: anonymous })}'; ${query}`;
const save = (index, id = randomUUID(), changes = { title: 'Corrected title' }) =>
	`select public.save_book_correction('${book(index)}', '${id}', '${JSON.stringify(changes).replaceAll("'", "''")}');`;
const context = (index, user = uid) =>
	JSON.parse(sql(userSql(`select public.get_book_correction_context('${book(index)}');`, user)));
const rejects = (query, pattern) => assert.throws(() => sql(query), pattern);
const concurrentSql = (query) =>
	new Promise((resolve, reject) => {
		const child = spawn('docker', psqlArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
		let stdout = '',
			stderr = '';
		child.stdout.on('data', (data) => {
			stdout += data;
		});
		child.stderr.on('data', (data) => {
			stderr += data;
		});
		child.on('error', reject);
		child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr))));
		child.stdin.end(query);
	});

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
			docker(['exec', container, 'pg_isready', '-U', 'postgres']);
			ready = true;
			break;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
	assert.ok(ready, 'Postgres started');
	sql(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema auth to authenticated;
    create table auth.users (id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as
      $$select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    insert into auth.users values ('${uid}'),('${otherUid}'),('${rollingUid}'),('${concurrentUid}'),('${validationUid}');
    create table public.books (
      book_id text primary key, book_name text, author text, summary text, year integer default 1998,
      genre1 text, genre2 text, genre3 text, genre4 text, genre5 text, genre6 text, genre7 text
    );
    insert into public.books(book_id, book_name, author, summary, genre1)
      select '01' || lpad(i::text,24,'0'), 'Original title', 'Original author', 'Original description', 'Fantasy'
      from generate_series(1,30) i;
    grant select on public.books to authenticated;
  `);
	sql(
		readFileSync(
			new URL('../supabase/migrations/20261017000000_book_corrections.sql', import.meta.url),
			'utf8'
		)
	);

	// Prove the upgrade intentionally clears old test proposals and old allowances.
	sql(
		userSql(
			save(30, randomUUID(), { title: 'Test title', summary: 'Test replacement' }),
			validationUid
		)
	);
	assert.equal(sql('select count(*) from public.book_corrections;'), '1');
	sql(
		readFileSync(
			new URL('../supabase/migrations/20261017010000_field_corrections.sql', import.meta.url),
			'utf8'
		)
	);
	assert.equal(sql('select count(*) from public.book_corrections;'), '0');
	assert.equal(sql('select count(*) from public.book_correction_daily_books;'), '0');
	assert.equal(sql('select count(*) from public.book_correction_submissions;'), '0');
	const preservedId = randomUUID();
	sql(userSql(save(30, preservedId, { title: 'Preserve this existing proposal' }), validationUid));
	sql(
		readFileSync(
			new URL(
				'../supabase/migrations/20261017020000_correction_year_and_validation.sql',
				import.meta.url
			),
			'utf8'
		)
	);
	assert.equal(
		context(30, validationUid).pending[0].id,
		preservedId,
		'publication-year upgrade preserves existing proposals'
	);
	assert.equal(
		sql('select count(*) from public.book_correction_submissions;'),
		'1',
		'year upgrade preserves quota entries'
	);
	sql(
		readFileSync(
			new URL('../supabase/migrations/20261017030000_description_categories.sql', import.meta.url),
			'utf8'
		)
	);
	assert.equal(context(30, validationUid).pending[0].id, preservedId);
	assert.equal(sql('select count(*) from public.book_correction_submissions;'), '1');
	const pending = (index, field, user = uid) =>
		context(index, user).pending.find((p) => p.field === field);

	rejects(userSql(save(1), uid, true), /registered account/);
	rejects(
		"set role anon; select public.get_book_correction_context('" + book(1) + "');",
		/permission denied/
	);
	rejects(
		userSql(
			"insert into public.book_correction_submissions values (gen_random_uuid(),'" +
				uid +
				"','fake','title',now());"
		),
		/permission denied/
	);
	rejects(userSql(save(1, randomUUID(), { title: 'Original title' })), /corrected title/);
	rejects(
		userSql(save(1, randomUUID(), { title: 'New title', author: 'New author' })),
		/one field/
	);
	rejects(userSql(save(1, randomUUID(), { summary: 'Replacement' })), /Unsupported/);
	rejects(userSql(save(1, randomUUID(), { status: 'approved' })), /Unsupported/);
	rejects(userSql(save(1, randomUUID(), { coverUrl: 'javascript:alert(1)' })), /HTTP or HTTPS/);
	for (const field of ['title', 'author'])
		rejects(userSql(save(1, randomUUID(), { [field]: 'a'.repeat(201) })), /200 characters/);
	for (const description of [
		{ category: 'factual', explanation: 'a'.repeat(601) },
		{ category: '', explanation: 'A problem' },
		{ category: 'generic', explanation: 'A problem' },
		{ category: 'other', explanation: '' },
		{ category: 'spoiler', explanation: 'Problem', extra: true },
		{ category: null, explanation: 'Problem' }
	])
		rejects(userSql(save(1, randomUUID(), { description })), /Please/);
	rejects(
		userSql(save(1, randomUUID(), { description: { category: '', explanation: '' } })),
		/Please provide a short description of the problem/
	);
	for (const year of ['', '0', '-0', '2000.5', '10000', '-10000', 'abc', 2000]) {
		rejects(userSql(save(1, randomUUID(), { year })), /valid publication year/);
	}
	rejects(userSql(save(1, randomUUID(), { year: '1998' })), /correct publication year/);
	const prefixUrl = 'https://images.example/';
	const longestCover = prefixUrl + 'a'.repeat(512 - prefixUrl.length);
	rejects(userSql(save(1, randomUUID(), { coverUrl: longestCover + 'a' })), /512 characters/);
	for (const label of ['SF', 'a'.repeat(41)])
		rejects(userSql(save(1, randomUUID(), { genres: { add: [label], remove: [] } })), /3–40/);
	rejects(
		userSql(save(1, randomUUID(), { genres: { add: ['Horror', 'horror'], remove: [] } })),
		/Duplicate/
	);
	rejects(
		userSql(
			save(1, randomUUID(), {
				genres: { add: Array.from({ length: 10 }, (_, i) => 'Niche ' + i), remove: [] }
			})
		),
		/up to 10/
	);
	assert.equal(context(1).remaining, 20, 'invalid requests consume no slots');

	const titleId = randomUUID();
	const authorId = randomUUID();
	const descriptionId = randomUUID();
	const genresId = randomUUID();
	sql(userSql(save(1, titleId, { title: 'New title' })));
	sql(userSql(save(1, authorId, { author: 'New author' })));
	sql(
		userSql(
			save(1, descriptionId, {
				description: { category: 'spoiler', explanation: ' Reveals the ending. ' }
			})
		)
	);
	sql(userSql(save(1, genresId, { genres: { add: ['  Solar   Gothic  '], remove: ['Fantasy'] } })));
	assert.equal(context(1).remaining, 16, 'four fields on one book consume four slots');
	assert.deepEqual(
		context(1)
			.pending.map((p) => p.field)
			.sort(),
		['author', 'description', 'genres', 'title']
	);
	assert.equal(pending(1, 'title').original_values.title, 'Original title');
	assert.deepEqual(pending(1, 'genres').proposed_changes.genres, {
		add: ['Solar Gothic'],
		remove: ['Fantasy']
	});
	assert.deepEqual(pending(1, 'description').proposed_changes, {
		description: { category: 'spoiler', explanation: 'Reveals the ending.' }
	});
	const descriptionDeadline = pending(1, 'description').review_due_at;
	sql(
		userSql(
			save(1, descriptionId, {
				description: { category: 'too_generic', explanation: 'Too vague to identify this book.' }
			})
		)
	);
	assert.deepEqual(pending(1, 'description').proposed_changes, {
		description: { category: 'too_generic', explanation: 'Too vague to identify this book.' }
	});
	assert.equal(pending(1, 'description').review_due_at, descriptionDeadline);
	assert.equal(context(1).remaining, 16, 'changing the description category is a free revision');
	assert.equal(
		Date.parse(pending(1, 'title').review_due_at) - Date.parse(pending(1, 'title').submitted_at),
		86400000
	);
	const deadline = pending(1, 'title').review_due_at;
	sql(userSql(save(1, titleId, { title: 'Revised title' })));
	assert.equal(context(1).remaining, 16, 'revisions use no additional slot');
	assert.equal(pending(1, 'title').review_due_at, deadline);
	rejects(userSql(save(1)), /pending proposal already exists/);
	rejects(
		userSql(save(1, titleId, { author: 'Cannot change proposal field' })),
		/no longer available/
	);
	assert.deepEqual(context(1, otherUid).pending, []);
	assert.equal(sql(userSql('select count(*) from public.book_corrections;', otherUid)), '0');
	assert.equal(
		sql(userSql('select count(*) from public.book_correction_submissions;', otherUid)),
		'0'
	);
	rejects(userSql(save(1, titleId), otherUid), /no longer available/);
	rejects(
		userSql("select public.withdraw_book_correction('" + titleId + "');", otherUid),
		/unavailable/
	);
	rejects(userSql("update public.book_corrections set status = 'approved';"), /permission denied/);

	// Fill the remaining sixteen slots using independent field corrections.
	sql(userSql(Array.from({ length: 16 }, (_, i) => save(i + 2)).join('\n')));
	assert.equal(context(1).remaining, 0);
	assert.ok(Date.parse(context(1).resetsAt) > Date.now() + 23 * 3600000);
	rejects(userSql(save(18)), /20 corrections/);
	sql(userSql(save(1, titleId, { title: 'Revised at the limit' })));
	sql(userSql("select public.withdraw_book_correction('" + titleId + "');"));
	assert.equal(context(1).remaining, 0, 'withdrawal does not refund allowance');
	assert.equal(pending(1, 'title'), undefined);
	assert.ok(pending(1, 'author'), 'withdrawing one field preserves the others');
	rejects(userSql(save(1)), /20 corrections/, 'resubmitting the same field needs a new slot');
	// Expiring one ledger entry opens exactly one slot, independent of calendar date.
	sql(
		"update public.book_correction_submissions set submitted_at = now() - interval '24 hours 1 second' where id = '" +
			titleId +
			"';"
	);
	assert.equal(context(1).remaining, 1);
	sql(userSql(save(1)));
	assert.equal(context(1).remaining, 0);

	// A 23-hour-old submission still counts; a 24-hour-old one no longer counts.
	const rollingId = randomUUID();
	sql(userSql(save(1, rollingId), rollingUid));
	sql(
		"update public.book_correction_submissions set submitted_at = now() - interval '23 hours' where id = '" +
			rollingId +
			"';"
	);
	assert.equal(context(1, rollingUid).remaining, 19);
	sql(
		"update public.book_correction_submissions set submitted_at = now() - interval '24 hours 1 second' where id = '" +
			rollingId +
			"';"
	);
	assert.equal(context(1, rollingUid).remaining, 20);
	const rollingDeadline = pending(1, 'title', rollingUid).review_due_at;
	sql(userSql(save(1, rollingId, { title: 'Revision after ledger expiry' }), rollingUid));
	assert.equal(context(1, rollingUid).remaining, 20, 'revisions stay free after 24 hours');
	assert.equal(pending(1, 'title', rollingUid).review_due_at, rollingDeadline);

	// Boundary values are accepted at the database boundary, and SQL-looking text
	// stays data even if a user bypasses the app endpoint.
	const validationTitleId = randomUUID();
	const validationYearId = randomUUID();
	sql(userSql(save(1, validationYearId, { year: '-0300' }), validationUid));
	assert.equal(context(1, validationUid).catalog.year, '1998');
	assert.deepEqual(pending(1, 'year', validationUid).proposed_changes, { year: '-300' });
	assert.equal(pending(1, 'year', validationUid).original_values.year, '1998');
	sql(userSql(save(1, validationYearId, { year: '2001' }), validationUid));
	assert.deepEqual(pending(1, 'year', validationUid).proposed_changes, { year: '2001' });
	sql(userSql(save(1, validationTitleId, { title: 'a'.repeat(200) }), validationUid));
	const sqlLikeText = "O'Brien'); DROP TABLE public.books; --";
	sql(userSql(save(1, validationTitleId, { title: sqlLikeText }), validationUid));
	assert.equal(pending(1, 'title', validationUid).proposed_changes.title, sqlLikeText);
	sql(userSql(save(1, randomUUID(), { author: 'a'.repeat(200) }), validationUid));
	sql(userSql(save(1, randomUUID(), { coverUrl: longestCover }), validationUid));
	sql(
		userSql(
			save(1, randomUUID(), { description: { category: 'factual', explanation: 'a'.repeat(600) } }),
			validationUid
		)
	);
	sql(
		userSql(
			save(1, randomUUID(), { genres: { add: ['Art', 'a'.repeat(40)], remove: ['Fantasy'] } }),
			validationUid
		)
	);
	assert.equal(
		pending(1, 'description', validationUid).proposed_changes.description.explanation.length,
		600
	);
	sql("update public.books set genre2 = 'YA' where book_id = '" + book(2) + "';");
	sql(userSql(save(2, randomUUID(), { genres: { add: [], remove: ['YA'] } }), validationUid));
	assert.deepEqual(pending(2, 'genres', validationUid).proposed_changes.genres.remove, ['YA']);

	sql(userSql(Array.from({ length: 19 }, (_, i) => save(i + 1)).join('\n'), concurrentUid));
	const races = await Promise.allSettled([
		concurrentSql(userSql(save(20), concurrentUid)),
		concurrentSql(userSql(save(21), concurrentUid))
	]);
	assert.equal(
		races.filter((r) => r.status === 'fulfilled').length,
		1,
		'only one racing correction takes the twentieth slot'
	);
	assert.match(races.find((r) => r.status === 'rejected').reason.message, /20 corrections/);
	assert.equal(context(1, concurrentUid).remaining, 0);

	const reviewId = randomUUID();
	sql(userSql(save(2, reviewId), otherUid));
	sql(
		"update public.book_corrections set status = 'declined', reviewed_at = now() where id = '" +
			reviewId +
			"';"
	);
	assert.deepEqual(context(2, otherUid).pending, []);
	rejects(userSql(save(2, reviewId), otherUid), /no longer available/);
	assert.equal(
		sql(
			"select count(*) from public.books where book_name <> 'Original title' or author <> 'Original author' or summary <> 'Original description' or genre1 <> 'Fantasy';"
		),
		'0',
		'catalog stays unchanged'
	);
	assert.equal(
		sql('select count(*) from public.books;'),
		'30',
		'SQL-like input cannot execute a statement'
	);
	console.log(
		'Field correction database checks passed (test-data cleanup, single-field records, description issues, permissions, validation, rolling 20/24h quota, independent withdrawal, concurrent writes, unchanged catalog).'
	);
} finally {
	try {
		docker(['stop', container]);
	} catch {
		/* Already stopped or never started. */
	}
}
