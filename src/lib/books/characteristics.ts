/** Existing public.books columns, verified against the live catalog. */
export const CHARACTERISTIC_SELECT =
	'pace_value,vocabulary_value,depth_value,originality_value,discussion_potential_value,violence_value,spice_value';

export type CharacteristicRow = {
	pace_value?: number | null;
	vocabulary_value?: number | null;
	depth_value?: number | null;
	originality_value?: number | null;
	discussion_potential_value?: number | null;
	violence_value?: number | null;
	spice_value?: number | null;
};

export interface ReadingCharacteristic {
	label: string;
	description: string;
}

const dimensions: {
	column: keyof CharacteristicRow;
	low?: ReadingCharacteristic;
	high?: ReadingCharacteristic;
}[] = [
	{
		column: 'violence_value',
		high: { label: 'Graphic', description: 'Graphic depictions of violence.' }
	},
	{ column: 'spice_value', high: { label: 'Explicit', description: 'Explicit sexual content.' } },
	// The existing recommendation scale runs from action-driven to introspective.
	{
		column: 'pace_value',
		low: { label: 'Fast-paced', description: 'An action-driven reading experience.' },
		high: { label: 'Unhurried', description: 'A measured, introspective reading experience.' }
	},
	{
		column: 'vocabulary_value',
		low: { label: 'Accessible', description: 'Familiar, approachable vocabulary.' },
		high: { label: 'Demanding', description: 'Advanced vocabulary that asks more of the reader.' }
	},
	{
		column: 'depth_value',
		low: { label: 'Light', description: 'Straightforward ideas and themes.' },
		high: { label: 'Deep', description: 'Substantial thematic and philosophical depth.' }
	},
	{
		column: 'originality_value',
		high: { label: 'Unconventional', description: 'An unusual approach to storytelling.' }
	},
	{
		column: 'discussion_potential_value',
		high: { label: 'Thought-provoking', description: 'Ideas and questions that invite discussion.' }
	}
];

export function bookCharacteristics(row: CharacteristicRow | null) {
	const labels: ReadingCharacteristic[] = [];
	let availableDimensions = 0;
	for (const dimension of dimensions) {
		const score = row?.[dimension.column];
		if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) continue;
		availableDimensions++;
		const label = score <= 0.2 ? dimension.low : score >= 0.8 ? dimension.high : undefined;
		if (label) labels.push(label);
	}
	return { labels, availableDimensions, totalDimensions: dimensions.length };
}
