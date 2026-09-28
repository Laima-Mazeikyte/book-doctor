/**
 * Refresh canonical filter labels and the author search index from public.books.
 * Run locally with: node --env-file=.env --env-file=.env.local scripts/generate-recommendation-filter-options.mjs
 * The author index is fetched only when someone searches for an author.
 */
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const url = process.env.PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.PUBLIC_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('Public Supabase URL and anon key are required.');

const supabase = createClient(url, key, {
	auth: { persistSession: false, autoRefreshToken: false }
});
const genreColumns = Array.from({ length: 7 }, (_, index) => `genre${index + 1}`);
const keywordColumns = Array.from({ length: 10 }, (_, index) => `keyword${index + 1}`);
const pageSize = 1000;
const genres = new Set();
const keywords = new Set();
const authors = new Map();
// These catalog-only authors are unsupported by the current recommendation snapshot.
const unsupportedAuthors = new Set([
	'Adam Jacobson',
	'Adrian Conan Doyle',
	'Beth Vaughan',
	'Chloe C. Penaranda',
	'Dirk Cussler',
	'Doug Naylor',
	'Gigi McCaffrey',
	'Gina Mayer',
	'Guy Adams',
	'Herman Parish',
	'J.M. Walker',
	'Kaja Foglio',
	'Lisa Lang Blakeney',
	'Richard Pini',
	'S.J. Day',
	'Sandy Blair',
	'Todd McCaffrey',
	'Tracey Jane Jackson'
]);
let lastBookId = '';
let rowsRead = 0;
while (true) {
	let query = supabase
		.from('books')
		.select(['book_id', 'author', ...genreColumns, ...keywordColumns].join(','))
		.order('book_id', { ascending: true })
		.limit(pageSize);
	if (lastBookId) query = query.gt('book_id', lastBookId);
	const { data, error } = await query;
	if (error) throw error;
	for (const row of data ?? []) {
		const author = typeof row.author === 'string' ? row.author.trim() : '';
		if (author && !unsupportedAuthors.has(author)) {
			authors.set(author, (authors.get(author) ?? 0) + 1);
		}
		for (const column of genreColumns) {
			const label = row[column]?.trim();
			if (label) genres.add(label);
		}
		for (const column of keywordColumns) {
			const label = row[column]?.trim();
			if (label) keywords.add(label);
		}
	}
	rowsRead += data?.length ?? 0;
	if (!data?.length || data.length < pageSize) break;
	lastBookId = data.at(-1).book_id;
}

const byName = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' });
const output = {
	genres: [...genres].sort(byName),
	keywords: [...keywords].sort(byName)
};
writeFileSync(
	new URL('../src/lib/recommendations/filter-options.generated.json', import.meta.url),
	`${JSON.stringify(output, null, 2)}\n`
);
writeFileSync(
	new URL('../static/recommendation-authors.json', import.meta.url),
	JSON.stringify([...authors].sort((a, b) => byName(a[0], b[0])))
);
console.log(
	`Saved ${output.genres.length} genres, ${output.keywords.length} keywords, and ${authors.size} authors from ${rowsRead} books.`
);
