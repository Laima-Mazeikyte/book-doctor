export interface SeriesMember {
	book_id: string;
	slug: string;
	title: string;
	number: number;
}

export interface BookSeries {
	title: string;
	number: number;
	members: SeriesMember[];
}

const number = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0.01;
const object = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value);

/** Membership comes from the series export, independently of ranking badges. */
export function bookSeries(value: unknown): BookSeries | null {
	if (
		!object(value) ||
		typeof value.title !== 'string' ||
		!value.title.trim() ||
		['NA', 'N/A'].includes(value.title.trim().toUpperCase()) ||
		!number(value.number)
	)
		return null;
	const members = (Array.isArray(value.members) ? value.members : [])
		.flatMap((member): SeriesMember[] => {
			if (
				!object(member) ||
				typeof member.book_id !== 'string' ||
				!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(member.book_id) ||
				typeof member.slug !== 'string' ||
				!member.slug ||
				typeof member.title !== 'string' ||
				!member.title.trim() ||
				!number(member.number)
			)
				return [];
			return [
				{ book_id: member.book_id, slug: member.slug, title: member.title, number: member.number }
			];
		})
		.sort(
			(a, b) => a.number - b.number || (a.book_id < b.book_id ? -1 : a.book_id > b.book_id ? 1 : 0)
		);
	return { title: value.title, number: value.number, members };
}
