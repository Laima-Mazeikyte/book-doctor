/** Empirical standing within a release, with equal scores sharing a rank. */
export function featureStanding(values: Float64Array, index: number) {
	let higher = 0;
	let equal = 0;
	for (const value of values) {
		if (value > values[index]) higher++;
		else if (value === values[index]) equal++;
	}
	// Include the whole tied group: an all-equal signal must not read as top 1%.
	const percent = ((higher + equal) / values.length) * 100;
	// Strip floating-point noise (7/1000 → 0.7000000000000001) before rounding up to 0.1.
	const tenths = Math.ceil(Math.round(percent * 1e9) / 1e8);
	return {
		rank: higher + 1,
		top: percent < 0.1 ? '<0.1%' : `${(tenths / 10).toFixed(1)}%`
	};
}
