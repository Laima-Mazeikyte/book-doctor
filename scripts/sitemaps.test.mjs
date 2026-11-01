import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ORIGIN,
	createSitemaps,
	bookUrl,
	parseLocations,
	releaseManifest,
	validateSitemaps,
	readCatalog
} from './sitemaps.mjs';

const row = (n, slug = `book-${n}-author`) => ({
	book_id: `01${String(n).padStart(24, '0')}`,
	slug
});
const books = Array.from({ length: 5 }, (_, i) => row(i + 1));
const manifestFor = (files) =>
	releaseManifest(files, books, 'v3', { host: 'fixture.invalid' }, '2026-10-30T00:00:00Z');

test('partitions every book exactly once and indexes all public files', () => {
	const files = createSitemaps(books, { maxUrls: 2 });
	assert.deepEqual(validateSitemaps(files, manifestFor(files)), {
		release: 'v3',
		books: 5,
		pages: 2,
		files: 5
	});
	assert.deepEqual(parseLocations(files.get('sitemap-books-3.xml')), [
		`${ORIGIN}/books/book-5-author`
	]);
	assert.deepEqual(parseLocations(files.get('sitemap-pages.xml')), [`${ORIGIN}/`, `${ORIGIN}/faq`]);
	assert.equal(parseLocations(files.get('sitemap.xml'), true).length, 4);
	assert.ok(!files.get('sitemap.xml').includes('lastmod'));
});

test('also partitions by uncompressed byte size, not only URL count', () => {
	const singleBytes = Buffer.byteLength(createSitemaps([books[0]]).get('sitemap-books-1.xml'));
	const files = createSitemaps(books, { maxBytes: singleBytes });
	const shards = [...files].filter(([name]) => name.startsWith('sitemap-books-'));
	assert.equal(shards.length, books.length);
	assert.ok(shards.every(([, xml]) => Buffer.byteLength(xml) <= singleBytes));
	assert.throws(() => createSitemaps(books, { maxBytes: singleBytes - 1 }), /single URL/);
});

test('uses stored Unicode addresses and rejects missing, duplicate or invalid identities', () => {
	const url = bookUrl('夜の本-著者');
	assert.ok(url.startsWith(`${ORIGIN}/books/%E5%A4%9C`));
	assert.equal(decodeURIComponent(url), `${ORIGIN}/books/夜の本-著者`);
	assert.throws(() => createSitemaps([row(1), row(2, 'book-1-author')]), /Duplicate stored/);
	assert.throws(() => createSitemaps([row(1), row(1, 'another-book')]), /duplicate catalog ID/);
	for (const slug of [null, '', 'Bad-Case', '../book', 'book--author', 'a'.repeat(2048)])
		assert.throws(() => bookUrl(slug));
	assert.throws(() => createSitemaps([]), /empty catalog/);
});

test('offline validation detects changed artifacts, count mismatches and stale shards', () => {
	const files = createSitemaps(books);
	const manifest = manifestFor(files);
	assert.throws(() => validateSitemaps(files, { ...manifest, bookCount: 4 }), /count mismatch/);
	const changed = new Map(files);
	changed.set(
		'sitemap-books-1.xml',
		changed.get('sitemap-books-1.xml').replace('book-1-author', 'other-author')
	);
	assert.throws(() => validateSitemaps(changed, manifest), /Checksum/);
	const stale = new Map(files);
	stale.set('sitemap-books-9.xml', files.get('sitemap-books-1.xml'));
	assert.throws(() => validateSitemaps(stale, manifest));
	assert.throws(
		() => parseLocations(files.get('sitemap-pages.xml').replace('/faq', '/faq?bad=1&bad=2')),
		/XML entity/
	);
});

function catalogFetcher({
	moveBoundary = false,
	changeSlug = false,
	emptyPage = false,
	reverse = false
} = {}) {
	const records = books.slice(0, 3);
	let boundaries = 0;
	let walks = 0;
	const requests = [];
	const fetcher = async (target, options) => {
		const url = new URL(target);
		requests.push({ url, options });
		assert.equal(url.searchParams.get('select'), 'book_id,slug');
		if (url.searchParams.get('order') === 'book_id.desc') {
			boundaries++;
			return Response.json([moveBoundary && boundaries > 1 ? row(4) : records.at(-1)]);
		}
		const last = url.searchParams.get('and').match(/book_id\.gt\.([0-9A-Z]+)/)?.[1];
		if (!last) walks++;
		const matches = records.filter((r) => !last || r.book_id > last).slice(0, 2);
		if (changeSlug && walks > 1 && !last) matches[0] = { ...matches[0], slug: 'changed-address' };
		return Response.json(emptyPage ? [] : reverse ? matches.reverse() : matches);
	};
	return { fetcher, requests };
}

test('reads a capped catalog using indexed keyset pages and read-only public requests', async () => {
	const { fetcher, requests } = catalogFetcher();
	const snapshot = await readCatalog({
		url: 'https://fixture.invalid',
		key: 'public-test-key',
		fetcher
	});
	assert.deepEqual(snapshot.books, books.slice(0, 3));
	assert.equal(requests.length, 6);
	assert.ok(
		requests.every(
			({ url, options }) =>
				!url.searchParams.has('offset') && options.method === undefined && !options.headers.Prefer
		)
	);
	assert.equal(
		requests[2].url.searchParams.get('and'),
		`(book_id.gt.${books[1].book_id},book_id.lte.${books[2].book_id})`
	);
});

test('refuses incomplete, reordered or changing catalogs instead of publishing partial XML', async () => {
	for (const fixture of [
		{ emptyPage: true },
		{ reverse: true },
		{ moveBoundary: true },
		{ changeSlug: true }
	]) {
		await assert.rejects(
			readCatalog({
				url: 'https://fixture.invalid',
				key: 'public-test-key',
				fetcher: catalogFetcher(fixture).fetcher
			})
		);
	}
});
