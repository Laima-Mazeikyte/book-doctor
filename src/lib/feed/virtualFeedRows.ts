export type VirtualFeedCell =
	| { kind: 'item'; index: number }
	| { kind: 'spacer'; row: number; height: number };

/** Whole rows keep CSS grid placement stable, including separately retained focus/sheet rows. */
export function virtualFeedRows({
	count,
	columns,
	rowHeight,
	gap,
	top,
	viewportHeight,
	pinned = [],
	virtual = true
}: {
	count: number;
	columns: number;
	rowHeight: number;
	gap: number;
	/** Viewport top relative to the list's document position. */
	top: number;
	viewportHeight: number;
	pinned?: number[];
	virtual?: boolean;
}): VirtualFeedCell[] {
	const cols = Math.max(1, columns);
	const stride = Math.max(1, rowHeight + gap);
	const rows = Math.ceil(count / cols);
	const overscan = viewportHeight * 2;
	const first = virtual
		? Math.max(0, Math.min(rows - 1, Math.floor((top - overscan) / stride)))
		: 0;
	const end = virtual
		? Math.max(first + 1, Math.min(rows, Math.ceil((top + viewportHeight + overscan) / stride)))
		: rows;
	const retained = new Set<number>();
	for (let row = first; row < end; row++) retained.add(row);
	for (const index of pinned) {
		if (index >= 0 && index < count) retained.add(Math.floor(index / cols));
	}
	const cells: VirtualFeedCell[] = [];
	let nextRow = 0;
	for (const row of [...retained].sort((a, b) => a - b)) {
		if (row > nextRow)
			cells.push({ kind: 'spacer', row: nextRow, height: (row - nextRow) * stride - gap });
		for (let index = row * cols; index < Math.min(count, (row + 1) * cols); index++) {
			cells.push({ kind: 'item', index });
		}
		nextRow = row + 1;
	}
	if (nextRow < rows)
		cells.push({ kind: 'spacer', row: nextRow, height: (rows - nextRow) * stride - gap });
	return cells;
}
