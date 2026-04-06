import { encode } from '@msgpack/msgpack';
import { Index } from 'flexsearch';
import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEARCH_ASSET_VERSION = 1;
const FETCH_PAGE_SIZE = 1000;
const OUT_DIR_NAME = 'search';
const BOOK_SELECT = [
	'id',
	'book_id',
	'book_name',
	'author',
	'cover_url',
	'summary',
	'year',
	'genre1',
	'genre2',
	'genre3',
	'genre4',
	'genre5',
	'genre6',
	'genre7',
	'type'
].join(', ');

const FIELD_CONFIG = {
	title: {
		file: 'title.msgpack',
		weight: 5,
		loadPhase: 'focus',
		indexOptions: {
			tokenize: 'forward',
			encoder: 'LatinBalance',
			resolution: 9,
			cache: 100
		}
	},
	author: {
		file: 'author.msgpack',
		weight: 3,
		loadPhase: 'deferred',
		indexOptions: {
			tokenize: 'forward',
			encoder: 'LatinBalance',
			resolution: 9,
			cache: 100
		}
	},
	keyword: {
		file: 'keyword.msgpack',
		weight: 1,
		loadPhase: 'deferred',
		indexOptions: {
			tokenize: 'strict',
			encoder: 'LatinBalance',
			resolution: 7,
			cache: 100
		}
	}
};

const STOP_WORDS = new Set([
	'the',
	'and',
	'for',
	'that',
	'with',
	'this',
	'from',
	'into',
	'they',
	'their',
	'there',
	'have',
	'were',
	'what',
	'when',
	'where',
	'which',
	'while',
	'about',
	'after',
	'before',
	'through',
	'story',
	'novel',
	'book',
	'his',
	'her',
	'she',
	'him',
	'who'
]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const staticDir = join(repoRoot, 'static');
const outputDir = join(staticDir, OUT_DIR_NAME);

/**
 * Node does not load `.env`; merge repo-root env files into `process.env` when keys are unset
 * (shell / CI exports still win). `.env.local` overrides `.env` for the same key.
 */
function parseEnvFile(filePath) {
	const out = {};
	if (!existsSync(filePath)) return out;
	const text = readFileSync(filePath, 'utf8');
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq <= 0) continue;
		const key = trimmed.slice(0, eq).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
		let value = trimmed.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
			(value.startsWith("'") && value.endsWith("'") && value.length >= 2)
		) {
			value = value.slice(1, -1);
		}
		out[key] = value;
	}
	return out;
}

function applyRepoEnvFiles() {
	const merged = { ...parseEnvFile(join(repoRoot, '.env')), ...parseEnvFile(join(repoRoot, '.env.local')) };
	for (const [key, value] of Object.entries(merged)) {
		if (process.env[key] === undefined && value.length > 0) {
			process.env[key] = value;
		}
	}
}

applyRepoEnvFiles();

function getEnv(...names) {
	for (const name of names) {
		const value = process.env[name];
		if (typeof value === 'string' && value.length > 0) {
			return value;
		}
	}

	return null;
}

function ensureEnv(name, fallbackNames = []) {
	const value = getEnv(name, ...fallbackNames);
	if (!value) {
		const joined = [name, ...fallbackNames].join(', ');
		throw new Error(
			`Missing required environment variable for search index build: ${joined}. ` +
				`Set them in the shell or in .env / .env.local at the repo root (see .env.example).`
		);
	}

	return value;
}

function collectGenres(row) {
	const out = [];
	for (const key of ['genre1', 'genre2', 'genre3', 'genre4', 'genre5', 'genre6', 'genre7']) {
		const value = row[key]?.trim();
		if (value) out.push(value);
	}
	return out.length > 0 ? out : undefined;
}

function buildKeywordText(book) {
	const parts = [];

	if (book.summary) {
		const seen = new Set();
		const matches = book.summary.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
		for (const token of matches) {
			if (STOP_WORDS.has(token) || seen.has(token)) continue;
			seen.add(token);
			parts.push(token);
			if (parts.length >= 24) break;
		}
	}

	if (book.genres) parts.push(...book.genres);
	if (book.year) parts.push(book.year);
	if (book.type) parts.push(book.type);

	return parts.join(' ');
}

function normalizeBook(row, coversBase) {
	const coverBase = coversBase?.replace(/\/$/, '') ?? '';
	const type = row.type?.trim() || undefined;

	return {
		id: String(row.id),
		book_id: row.book_id ?? undefined,
		title: row.book_name,
		author: row.author,
		coverUrl: row.cover_url ?? (coverBase ? `${coverBase}/${row.book_id}.avif` : undefined),
		summary: row.summary ?? undefined,
		year: row.year ? String(row.year) : undefined,
		genres: collectGenres(row),
		...(type ? { type } : {})
	};
}

function createIndex(field) {
	return new Index({
		...FIELD_CONFIG[field].indexOptions,
		fastupdate: false
	});
}

async function exportIndex(index) {
	const chunks = [];
	await index.export((key, data) => {
		chunks.push([key, data]);
	});
	return chunks;
}

function writeMsgpack(file, data) {
	const bytes = encode(data);
	const target = join(outputDir, file);
	writeFileSync(target, bytes);

	return {
		file,
		bytes: statSync(target).size,
		chunkCount: Array.isArray(data) ? data.length : 1
	};
}

async function fetchAllBooks(client) {
	const books = [];

	for (let offset = 0; ; offset += FETCH_PAGE_SIZE) {
		const { data, error } = await client
			.from('books')
			.select(BOOK_SELECT)
			.order('id', { ascending: true })
			.range(offset, offset + FETCH_PAGE_SIZE - 1);

		if (error) {
			throw error;
		}

		if (!data?.length) {
			break;
		}

		books.push(...data);

		if (data.length < FETCH_PAGE_SIZE) {
			break;
		}
	}

	return books;
}

async function main() {
	const supabaseUrl = ensureEnv('PUBLIC_SUPABASE_URL', ['VITE_SUPABASE_URL']);
	const supabaseKey = ensureEnv('SUPABASE_SERVICE_ROLE_KEY', [
		'PUBLIC_SUPABASE_ANON_KEY',
		'VITE_SUPABASE_ANON_KEY'
	]);
	const coversBase = getEnv('PUBLIC_BUNNY_COVERS_BASE');

	const client = createClient(supabaseUrl, supabaseKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});

	const rows = await fetchAllBooks(client);
	const books = rows.map((row) => normalizeBook(row, coversBase));

	mkdirSync(staticDir, { recursive: true });
	rmSync(outputDir, { recursive: true, force: true });
	mkdirSync(outputDir, { recursive: true });

	const titleIndex = createIndex('title');
	const authorIndex = createIndex('author');
	const keywordIndex = createIndex('keyword');

	for (const book of books) {
		titleIndex.add(book.id, book.title);
		authorIndex.add(book.id, book.author);
		keywordIndex.add(book.id, buildKeywordText(book));
	}

	const documentAsset = writeMsgpack('documents.msgpack', books);
	const titleAsset = writeMsgpack(FIELD_CONFIG.title.file, await exportIndex(titleIndex));
	const authorAsset = writeMsgpack(FIELD_CONFIG.author.file, await exportIndex(authorIndex));
	const keywordAsset = writeMsgpack(FIELD_CONFIG.keyword.file, await exportIndex(keywordIndex));

	const manifest = {
		version: SEARCH_ASSET_VERSION,
		generatedAt: new Date().toISOString(),
		documentCount: books.length,
		documents: documentAsset,
		fields: {
			title: {
				field: 'title',
				weight: FIELD_CONFIG.title.weight,
				loadPhase: FIELD_CONFIG.title.loadPhase,
				...titleAsset
			},
			author: {
				field: 'author',
				weight: FIELD_CONFIG.author.weight,
				loadPhase: FIELD_CONFIG.author.loadPhase,
				...authorAsset
			},
			keyword: {
				field: 'keyword',
				weight: FIELD_CONFIG.keyword.weight,
				loadPhase: FIELD_CONFIG.keyword.loadPhase,
				...keywordAsset
			}
		}
	};

	writeMsgpack('manifest.msgpack', manifest);

	console.log(
		`Built FlexSearch assets for ${books.length} books into static/${OUT_DIR_NAME}`
	);
}

main().catch((error) => {
	console.error('[build-search-index]', error);
	process.exitCode = 1;
});
