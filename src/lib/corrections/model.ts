import type { Book } from '$lib/types/book';

export const MAX_GENRES = 10;
export const MIN_GENRE_LENGTH = 3;
export const MAX_GENRE_LENGTH = 40;
export const DAILY_CORRECTION_LIMIT = 20;
export const TEXT_LIMITS = { title: 200, author: 200, coverUrl: 512 } as const;
export const DESCRIPTION_ISSUE_LIMIT = 600;
export const CORRECTION_FIELDS = [
	'title',
	'author',
	'year',
	'description',
	'coverUrl',
	'genres'
] as const;
export type CorrectionField = (typeof CORRECTION_FIELDS)[number];
export const EMPTY_CORRECTION_MESSAGES: Record<CorrectionField, string> = {
	title: 'Please enter the corrected title.',
	author: 'Please enter the corrected author name.',
	year: 'Please enter the correct publication year.',
	description: 'Please provide a short description of the problem.',
	coverUrl: 'Please provide a link to a different cover image.',
	genres: 'Please add or remove a genre.'
};
export const INVALID_YEAR_MESSAGE =
	'Please enter a valid publication year, such as 1998 or -300 for 300 BCE.';
export const DESCRIPTION_ISSUE_CATEGORIES = ['factual', 'spoiler', 'too_generic', 'other'] as const;
export type DescriptionIssueCategory = (typeof DESCRIPTION_ISSUE_CATEGORIES)[number];
export type DescriptionIssue = { category: DescriptionIssueCategory; explanation: string };

export type CorrectionValues = {
	title: string;
	author: string;
	year: string;
	summary: string;
	coverUrl: string;
	genres: string[];
};
export type CorrectionChanges = Partial<
	Pick<CorrectionValues, 'title' | 'author' | 'year' | 'coverUrl'>
> & {
	genres?: { add: string[]; remove: string[] };
	description?: DescriptionIssue;
};
export type PendingCorrection = {
	id: string;
	field: CorrectionField;
	original_values: CorrectionValues;
	proposed_changes: CorrectionChanges;
	submitted_at: string;
	review_due_at: string;
};
export type CorrectionContext = {
	catalog: CorrectionValues;
	pending: PendingCorrection[];
	remaining: number;
	resetsAt: string | null;
};

export function valuesFromBook(book: Book): CorrectionValues {
	return {
		title: book.title,
		author: book.author,
		year: book.year ?? '',
		summary: book.summary ?? '',
		coverUrl: book.coverUrl ?? '',
		genres: [...(book.genres ?? [])]
	};
}

export function normalizeGenre(value: string): string {
	return value.trim().replace(/\s+/gu, ' ');
}

export function genreKey(value: string): string {
	return normalizeGenre(value).toLowerCase();
}

export function isCoverImageUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			['https:', 'http:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password
		);
	} catch {
		return false;
	}
}

export function normalizePublicationYear(value: unknown): string {
	if (typeof value !== 'string' || !/^-?\d{1,4}$/.test(value.trim()) || Number(value.trim()) === 0)
		throw new Error(INVALID_YEAR_MESSAGE);
	return String(Number(value.trim()));
}

export function applyCorrection(
	original: CorrectionValues,
	changes: CorrectionChanges
): CorrectionValues {
	const { genres } = changes;
	return {
		...original,
		title: changes.title ?? original.title,
		author: changes.author ?? original.author,
		year: changes.year ?? original.year ?? '',
		coverUrl: changes.coverUrl ?? original.coverUrl,
		genres: genres
			? [
					...original.genres.filter((g) => !genres.remove.some((r) => genreKey(r) === genreKey(g))),
					...genres.add
				]
			: [...original.genres]
	};
}

/** Submit genre operations, so a later catalog addition is not implicitly removed. */
export function diffCorrection(
	original: CorrectionValues,
	draft: CorrectionValues,
	field: CorrectionField,
	issue: { category: string; explanation: string } = { category: '', explanation: '' }
): CorrectionChanges {
	if (field === 'description') {
		const explanation = issue.explanation.trim();
		return explanation
			? { description: { category: issue.category as DescriptionIssueCategory, explanation } }
			: {};
	}
	if (field !== 'genres') {
		let value = draft[field].trim();
		if (field === 'year' && value) value = normalizePublicationYear(value);
		return value !== (original[field] ?? '').trim() ? { [field]: value } : {};
	}
	const add = draft.genres
		.map(normalizeGenre)
		.filter((g) => !original.genres.some((o) => genreKey(o) === genreKey(g)));
	const remove = original.genres.filter(
		(g) => !draft.genres.some((d) => genreKey(d) === genreKey(g))
	);
	return add.length || remove.length ? { genres: { add, remove } } : {};
}

/** Also validate at the database boundary: callers can invoke the RPC directly. */
export function parseCorrectionChanges(input: unknown): CorrectionChanges {
	if (!input || typeof input !== 'object' || Array.isArray(input))
		throw new Error('Invalid proposed changes.');
	if (!Object.keys(input).length) throw new Error('Please enter a correction before submitting.');
	if (Object.keys(input).length !== 1) throw new Error('Propose a change to one field at a time.');
	const changes: CorrectionChanges = {};
	for (const [key, value] of Object.entries(input)) {
		if (key === 'description') {
			if (!value || typeof value !== 'object' || Array.isArray(value))
				throw new Error(EMPTY_CORRECTION_MESSAGES.description);
			const issue = value as Record<string, unknown>;
			if (Object.keys(issue).some((k) => k !== 'category' && k !== 'explanation'))
				throw new Error('Please select a problem type and describe the issue.');
			if (typeof issue.explanation !== 'string' || !issue.explanation.trim())
				throw new Error(EMPTY_CORRECTION_MESSAGES.description);
			if ([...issue.explanation.trim()].length > DESCRIPTION_ISSUE_LIMIT)
				throw new Error('Please keep your problem description to 600 characters or fewer.');
			if (!DESCRIPTION_ISSUE_CATEGORIES.includes(issue.category as DescriptionIssueCategory))
				throw new Error('Please select the type of problem.');
			changes.description = {
				category: issue.category as DescriptionIssueCategory,
				explanation: issue.explanation.trim()
			};
		} else if (key === 'year') {
			changes.year = normalizePublicationYear(value);
		} else if (key === 'genres') {
			if (!value || typeof value !== 'object' || Array.isArray(value))
				throw new Error('Invalid genres.');
			const operations = value as Record<string, unknown>;
			if (Object.keys(operations).some((k) => k !== 'add' && k !== 'remove'))
				throw new Error('Invalid genres.');
			const read = (list: unknown, adding: boolean): string[] => {
				if (
					!Array.isArray(list) ||
					list.length > MAX_GENRES ||
					list.some((v) => typeof v !== 'string')
				)
					throw new Error('Choose up to 10 genres.');
				const labels = (list as string[]).map(normalizeGenre);
				// Existing catalog labels such as "YA" must remain removable.
				const min = adding ? MIN_GENRE_LENGTH : 1;
				const max = adding ? MAX_GENRE_LENGTH : 80;
				if (labels.some((g) => [...g].length < min || [...g].length > max))
					throw new Error(
						adding ? 'New genres must contain 3–40 characters.' : 'Invalid genre removal.'
					);
				if (new Set(labels.map(genreKey)).size !== labels.length)
					throw new Error('This genre is already in the list.');
				return labels;
			};
			const add = read(operations.add, true);
			const remove = read(operations.remove, false);
			if (add.some((g) => remove.some((r) => genreKey(r) === genreKey(g))))
				throw new Error('A genre cannot be added and removed together.');
			if (add.length || remove.length) changes.genres = { add, remove };
		} else if (Object.hasOwn(TEXT_LIMITS, key)) {
			const field = key as keyof typeof TEXT_LIMITS;
			if (typeof value !== 'string' || !value.trim())
				throw new Error(EMPTY_CORRECTION_MESSAGES[field]);
			if ([...value.trim()].length > TEXT_LIMITS[field])
				throw new Error(
					field === 'coverUrl'
						? 'Please use an image link of 512 characters or fewer.'
						: `Please keep the ${field === 'author' ? 'author name' : 'title'} to 200 characters or fewer.`
				);
			const text = value.trim();
			if (field === 'coverUrl' && !isCoverImageUrl(text))
				throw new Error('Please enter a valid HTTP or HTTPS image link.');
			changes[field] = text;
		} else {
			throw new Error('Unsupported correction field.');
		}
	}
	if (!Object.keys(changes).length) throw new Error(EMPTY_CORRECTION_MESSAGES.genres);
	return changes;
}
