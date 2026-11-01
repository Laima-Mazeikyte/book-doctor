/** Public distinctions from the fixed default blend of each lab's three components. */
export interface RankingDistinction {
	percent: 0.1 | 1 | 5 | 10;
	subject: 'book' | 'author';
	rank: number;
	populationCount: number;
	version: string;
	/** The series whose overall standing a mapped volume inherits. */
	seriesTitle?: string;
}

export interface BookDistinctions {
	book: RankingDistinction | null;
	author: RankingDistinction | null;
}

export function distinctionLabel(distinction: RankingDistinction): string {
	return `Top ${distinction.percent}% ${distinction.subject === 'author' ? 'Author' : distinction.subject}`;
}

export function distinctionDescription(distinction: RankingDistinction): string {
	const lastTwoDigits = distinction.rank % 100;
	const suffix =
		lastTwoDigits >= 11 && lastTwoDigits <= 13
			? 'th'
			: (['th', 'st', 'nd', 'rd'][distinction.rank % 10] ?? 'th');
	const subject = distinction.subject === 'author' ? 'author' : 'book or series';
	return `Ranked ${distinction.rank.toLocaleString('en')}${suffix} best ${subject} of all time, according to Unread.`;
}
