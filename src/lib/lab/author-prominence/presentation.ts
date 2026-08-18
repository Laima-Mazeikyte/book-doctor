import type { Badge } from './types';

export interface RankingEntry {
	index: number;
	place: number;
	name: string;
	score: string;
	values: number[];
	badges: Badge[];
	observation: string;
	readers: number;
	books: number;
	awards: number;
	tier: number;
}

export interface SelectedAuthorSnapshot {
	index: number;
	name: string;
	place: number;
	score: string;
	values: number[];
	badges: Badge[];
	readers: number;
	books: number;
	awards: number;
	tier: number;
	concentration: number;
}

export interface ContributionRow {
	feature: string;
	label: string;
	z: number;
	weight: number;
	displayShare: number;
	value: number;
	width: number;
	colour: string;
}
