import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';

export const ORIGIN = 'https://unread.world';
export const MAX_URLS = 50_000;
export const MAX_BYTES = 50 * 1024 * 1024;
export const PUBLIC_PAGES = ['/', '/faq'];
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MANIFEST = 'scripts/sitemaps/release.json';
const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const MANAGED_FILE = /^sitemap(?:-pages|-books-[1-9][0-9]*)?\.xml$/;
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const SLUG = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;
const hash = (text) => createHash('sha256').update(text).digest('hex');
const escapeXml = (text) =>
	text.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]
	);

function documentXml(locations, index = false) {
	const root = index ? 'sitemapindex' : 'urlset';
	const tag = index ? 'sitemap' : 'url';
	return `${DECLARATION}\n<${root} xmlns="${NS}">\n${locations.map((loc) => `  <${tag}><loc>${escapeXml(loc)}</loc></${tag}>\n`).join('')}</${root}>\n`;
}

export function bookUrl(slug) {
	assert.ok(
		typeof slug === 'string' && SLUG.test(slug) && slug === slug.toLowerCase(),
		'Invalid stored book slug'
	);
	// Matches src/lib/books/bookUrl.ts; no title-derived or ULID addresses.
	const url = `${ORIGIN}/books/${encodeURIComponent(slug)}`;
	assert.ok(url.length < 2048, 'A book URL exceeds the sitemap protocol limit');
	return url;
}

export function createSitemaps(books, { maxUrls = MAX_URLS, maxBytes = MAX_BYTES } = {}) {
	assert.ok(Number.isSafeInteger(maxUrls) && maxUrls > 0 && maxUrls <= MAX_URLS);
	assert.ok(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= MAX_BYTES);
	assert.ok(books.length > 0, 'Refusing to publish an empty catalog');
	const files = new Map();
	const ids = new Set();
	const urls = new Set();
	let chunk = [];
	let chunkBytes = Buffer.byteLength(documentXml([]));
	let shard = 0;
	const flush = () => {
		if (chunk.length) files.set(`sitemap-books-${++shard}.xml`, documentXml(chunk));
		chunk = [];
		chunkBytes = Buffer.byteLength(documentXml([]));
	};
	for (const book of books) {
		assert.ok(ULID.test(book.book_id) && !ids.has(book.book_id), 'Invalid or duplicate catalog ID');
		ids.add(book.book_id);
		const url = bookUrl(book.slug);
		assert.ok(!urls.has(url), 'Duplicate stored book URL');
		urls.add(url);
		const bytes = Buffer.byteLength(`  <url><loc>${escapeXml(url)}</loc></url>\n`);
		if (chunk.length >= maxUrls || chunkBytes + bytes > maxBytes) flush();
		assert.ok(chunkBytes + bytes <= maxBytes, 'A single URL exceeds the sitemap file-size budget');
		chunk.push(url);
		chunkBytes += bytes;
	}
	flush();
	files.set('sitemap-pages.xml', documentXml(PUBLIC_PAGES.map((path) => `${ORIGIN}${path}`)));
	files.set(
		'sitemap.xml',
		documentXml(
			[...files.keys()].map((name) => `${ORIGIN}/${name}`),
			true
		)
	);
	return files;
}

// Accept only our small, fully escaped XML format. This also rejects extra tags,
// declarations, queries, preview hosts and unpublished application routes.
export function parseLocations(xml, index = false) {
	const root = index ? 'sitemapindex' : 'urlset';
	const tag = index ? 'sitemap' : 'url';
	const lines = xml.split('\n');
	assert.equal(lines.shift(), DECLARATION, 'Missing UTF-8 XML declaration');
	assert.equal(lines.shift(), `<${root} xmlns="${NS}">`, 'Invalid sitemap namespace/root');
	assert.equal(lines.pop(), '', 'Missing final newline');
	assert.equal(lines.pop(), `</${root}>`, 'Invalid closing XML element');
	return lines.map((line) => {
		const match = new RegExp(`^  <${tag}><loc>([^<]*)</loc></${tag}>$`).exec(line);
		assert.ok(match, 'Invalid sitemap entry');
		assert.ok(!/&(?!(?:amp|lt|gt|quot|apos);)/.test(match[1]), 'Invalid XML entity');
		return match[1].replace(
			/&(amp|lt|gt|quot|apos);/g,
			(_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity]
		);
	});
}

export function validateSitemaps(files, manifest) {
	assert.equal(manifest.schemaVersion, 1);
	assert.equal(manifest.origin, ORIGIN);
	assert.ok(
		/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(manifest.catalogRelease),
		'Missing release label'
	);
	assert.ok(Number.isFinite(Date.parse(manifest.generatedAt)), 'Invalid generation time');
	assert.ok(manifest.bookCount > 0 && Number.isSafeInteger(manifest.bookCount));
	assert.equal(files.size, manifest.files.length);
	assert.equal(new Set(manifest.files.map((f) => f.name)).size, files.size);
	const allUrls = new Set();
	let bookCount = 0;
	let pageCount = 0;
	for (const file of manifest.files) {
		assert.ok(
			MANAGED_FILE.test(file.name) && files.has(file.name),
			'Unexpected or missing sitemap file'
		);
		const xml = files.get(file.name);
		assert.equal(hash(xml), file.sha256, `Checksum mismatch: ${file.name}`);
		assert.equal(Buffer.byteLength(xml), file.bytes);
		assert.ok(file.bytes <= MAX_BYTES, 'Sitemap exceeds 50 MB uncompressed');
		const locations = parseLocations(xml, file.name === 'sitemap.xml');
		assert.ok(locations.length > 0 && locations.length <= MAX_URLS, 'Empty or oversized sitemap');
		assert.equal(locations.length, file.locations);
		if (file.name === 'sitemap.xml') {
			assert.deepEqual(
				new Set(locations),
				new Set(
					[...files.keys()]
						.filter((name) => name !== 'sitemap.xml')
						.map((name) => `${ORIGIN}/${name}`)
				)
			);
			assert.equal(new Set(locations).size, locations.length);
			continue;
		}
		for (const loc of locations) {
			const url = new URL(loc);
			assert.ok(
				loc.length < 2048 && url.origin === ORIGIN && url.href === loc && !url.search && !url.hash,
				'Non-canonical sitemap URL'
			);
			assert.ok(!allUrls.has(loc), 'URL duplicated across sitemaps');
			allUrls.add(loc);
			if (file.name === 'sitemap-pages.xml') {
				assert.ok(PUBLIC_PAGES.includes(url.pathname), 'Unapproved public page');
				pageCount++;
			} else {
				assert.ok(url.pathname.startsWith('/books/'));
				assert.equal(bookUrl(decodeURIComponent(url.pathname.slice('/books/'.length))), loc);
				bookCount++;
			}
		}
	}
	assert.ok(files.has('sitemap.xml') && files.has('sitemap-pages.xml'));
	assert.equal(bookCount, manifest.bookCount, 'Catalog URL count mismatch');
	assert.equal(pageCount, PUBLIC_PAGES.length);
	assert.equal(manifest.pageCount, pageCount);
	return {
		release: manifest.catalogRelease,
		books: bookCount,
		pages: pageCount,
		files: files.size
	};
}

export function releaseManifest(
	files,
	books,
	catalogRelease,
	source,
	generatedAt = new Date().toISOString()
) {
	return {
		schemaVersion: 1,
		catalogRelease,
		generatedAt,
		origin: ORIGIN,
		source,
		bookCount: books.length,
		pageCount: PUBLIC_PAGES.length,
		files: [...files].map(([name, xml]) => ({
			name,
			locations: parseLocations(xml, name === 'sitemap.xml').length,
			bytes: Buffer.byteLength(xml),
			sha256: hash(xml)
		}))
	};
}

export async function readCatalog({ url, key, fetcher = fetch, progress = () => {} }) {
	assert.ok(url && key, 'Missing public Supabase URL/key');
	const origin = new URL(url);
	assert.equal(origin.protocol, 'https:', 'Expected the hosted Supabase HTTPS URL');
	async function get(params) {
		const target = new URL('/rest/v1/books', origin);
		target.search = new URLSearchParams(params);
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				const response = await fetcher(target, {
					headers: {
						apikey: key,
						Authorization: `Bearer ${key}`
					},
					signal: AbortSignal.timeout(30000),
					redirect: 'error'
				});
				assert.ok(response.ok, `Catalog read failed: HTTP ${response.status}`);
				return { rows: await response.json() };
			} catch (error) {
				if (attempt === 2) throw error;
				await new Promise((done) => setTimeout(done, 1000 * (attempt + 1)));
			}
		}
	}
	const boundary = () => get({ select: 'book_id,slug', order: 'book_id.desc', limit: '1' });
	const before = await boundary();
	assert.ok(
		Array.isArray(before.rows) && before.rows.length === 1 && ULID.test(before.rows[0].book_id)
	);
	const highWatermark = before.rows[0].book_id;
	const books = [];
	async function walk(verifying) {
		let lastId = null;
		let read = 0;
		while (lastId !== highWatermark) {
			const { rows } = await get({
				select: 'book_id,slug',
				order: 'book_id.asc',
				limit: '1000',
				and: lastId
					? `(book_id.gt.${lastId},book_id.lte.${highWatermark})`
					: `(book_id.lte.${highWatermark})`
			});
			assert.ok(
				Array.isArray(rows) && rows.length > 0 && rows.length <= 1000,
				'Incomplete catalog page'
			);
			for (const row of rows) {
				assert.ok(
					ULID.test(row.book_id) &&
						(!lastId || row.book_id > lastId) &&
						row.book_id <= highWatermark,
					'Catalog pagination is not strictly ordered'
				);
				bookUrl(row.slug);
				if (verifying) {
					assert.ok(
						books[read]?.book_id === row.book_id && books[read]?.slug === row.slug,
						'Catalog changed between export and verification; retry after publication completes'
					);
				} else books.push(row);
				read++;
				lastId = row.book_id;
			}
			if (read % 20000 === 0 || lastId === highWatermark)
				progress(read, verifying ? books.length : null, verifying);
		}
		if (verifying) assert.equal(read, books.length, 'Incomplete verification pass');
	}
	// Avoid count=exact: whole-table counts can time out on the shared database.
	// Comparing complete ordered address sequences also detects equal-count replacements.
	await walk(false);
	await walk(true);
	const after = await boundary();
	assert.equal(after.rows[0]?.book_id, highWatermark, 'Catalog changed during export');
	return {
		books,
		source: {
			host: origin.hostname,
			table: 'public.books',
			fields: ['book_id', 'slug'],
			highWatermark,
			identitySha256: hash(books.map((book) => `${book.book_id}\0${book.slug}\n`).join('')),
			consistency:
				'Two matching ordered keyset reads of all IDs/slugs and unchanged high watermark; generate between catalog publications.'
		}
	};
}

export async function checkRelease() {
	const manifest = JSON.parse(await readFile(resolve(ROOT, MANIFEST), 'utf8'));
	const names = (await readdir(resolve(ROOT, 'static'))).filter((name) => MANAGED_FILE.test(name));
	const files = new Map(
		await Promise.all(
			names.map(async (name) => [name, await readFile(resolve(ROOT, 'static', name), 'utf8')])
		)
	);
	const result = validateSitemaps(files, manifest);
	const robots = await readFile(resolve(ROOT, 'static/robots.txt'), 'utf8');
	assert.ok(
		robots.split(/\r?\n/).some((line) => line === `Sitemap: ${ORIGIN}/sitemap.xml`),
		'robots.txt is missing the sitemap index'
	);
	return result;
}

async function generate(catalogRelease) {
	assert.ok(
		typeof catalogRelease === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(catalogRelease),
		'Provide --release v3 (or the newly published catalog label)'
	);
	let env = {};
	for (const name of ['.env', '.env.local']) {
		try {
			env = { ...env, ...parseEnv(await readFile(resolve(ROOT, name), 'utf8')) };
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
		}
	}
	env = { ...env, ...process.env };
	const { books, source } = await readCatalog({
		url: env.VITE_SUPABASE_URL || env.PUBLIC_SUPABASE_URL,
		key: env.VITE_SUPABASE_ANON_KEY || env.PUBLIC_SUPABASE_ANON_KEY,
		progress: (read, total, verifying) =>
			console.log(
				`${verifying ? 'Verified' : 'Read'} ${read}${total ? `/${total}` : ''} public book addresses`
			)
	});
	const files = createSitemaps(books);
	const manifest = releaseManifest(files, books, catalogRelease, source);
	validateSitemaps(files, manifest);
	const manifestPath = resolve(ROOT, MANIFEST);
	const { format, resolveConfig } = await import('prettier');
	const manifestText = await format(JSON.stringify(manifest), {
		...(await resolveConfig(manifestPath)),
		filepath: manifestPath
	});
	const staging = resolve(ROOT, 'temp', `sitemaps-${randomUUID()}`);
	await mkdir(staging, { recursive: true });
	for (const [name, xml] of files) await writeFile(resolve(staging, name), xml);
	const destination = resolve(ROOT, 'static');
	// Publish only after the full export validates. The manifest is written last:
	// interrupted replacement fails the offline build check instead of deploying a mix.
	for (const name of files.keys()) {
		const target = resolve(destination, name);
		assert.ok(MANAGED_FILE.test(name) && dirname(target) === destination);
		await rename(resolve(staging, name), target);
	}
	for (const name of await readdir(destination)) {
		if (MANAGED_FILE.test(name) && !files.has(name)) await unlink(resolve(destination, name));
	}
	await writeFile(manifestPath, manifestText);
	console.log(JSON.stringify(await checkRelease(), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const { positionals, values } = parseArgs({
			args: process.argv.slice(2),
			allowPositionals: true,
			options: { release: { type: 'string' } }
		});
		assert.equal(positionals.length, 1, 'Use generate --release v3 or check');
		if (positionals[0] === 'generate') await generate(values.release);
		else if (positionals[0] === 'check') console.log(JSON.stringify(await checkRelease(), null, 2));
		else throw new Error('Use generate --release v3 or check');
	} catch (error) {
		console.error(`Sitemap ${process.argv[2] ?? 'command'} failed: ${error.message}`);
		process.exitCode = 1;
	}
}
