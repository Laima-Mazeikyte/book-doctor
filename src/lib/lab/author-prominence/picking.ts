export interface PickArrays {
	x: Float32Array;
	y: Float32Array;
	depth: Float32Array;
	visible: Uint8Array;
}

export interface PickGrid {
	cellSize: number;
	width: number;
	height: number;
	cells: Map<string, number[]>;
}

function cellKey(x: number, y: number, cellSize: number): string {
	return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
}

export function createPickGrid(width: number, height: number, cellSize = 28): PickGrid {
	return { cellSize, width, height, cells: new Map() };
}

export function addPickCandidate(
	grid: PickGrid,
	index: number,
	x: number,
	y: number,
	visible: boolean
): void {
	if (!visible || x <= -20 || x >= grid.width + 20 || y <= -20 || y >= grid.height + 20) return;
	const key = cellKey(x, y, grid.cellSize);
	const candidates = grid.cells.get(key);
	if (candidates) candidates.push(index);
	else grid.cells.set(key, [index]);
}

/** Build the settled screen-space index; camera movement never calls this function. */
export function buildPickGrid(
	points: PickArrays,
	width: number,
	height: number,
	cellSize = 28
): PickGrid {
	const grid = createPickGrid(width, height, cellSize);
	for (let index = 0; index < points.x.length; index++) {
		addPickCandidate(grid, index, points.x[index], points.y[index], points.visible[index] !== 0);
	}
	return grid;
}

/** Resolve candidates with one deterministic total order: distance, depth, stable index. */
export function queryPickGrid(
	grid: PickGrid,
	x: number,
	y: number,
	points: PickArrays,
	rankBuckets: ArrayLike<number>,
	selectedIndex: number | null,
	baseHitRadius = 11,
	priorityHitRadius = 17
): number | null {
	const baseX = Math.floor(x / grid.cellSize);
	const baseY = Math.floor(y / grid.cellSize);
	const ordinaryRadius = Math.max(0, baseHitRadius);
	const priorityRadius = Math.max(0, priorityHitRadius);
	const largestHitRadius = Math.max(ordinaryRadius, priorityRadius);
	const cellRadius = Math.ceil(largestHitRadius / grid.cellSize);
	let closest: number | null = null;
	let closestDistanceSquared = Infinity;
	let closestDepth = Infinity;
	for (let dx = -cellRadius; dx <= cellRadius; dx++) {
		for (let dy = -cellRadius; dy <= cellRadius; dy++) {
			const candidates = grid.cells.get(`${baseX + dx},${baseY + dy}`);
			if (!candidates) continue;
			for (const index of candidates) {
				const deltaX = points.x[index] - x;
				const deltaY = points.y[index] - y;
				const distanceSquared = deltaX * deltaX + deltaY * deltaY;
				const radius =
					(rankBuckets[index] ?? 0) >= 3 || index === selectedIndex
						? priorityRadius
						: ordinaryRadius;
				if (distanceSquared > radius * radius) continue;
				const isBetter =
					closest === null ||
					distanceSquared < closestDistanceSquared ||
					(distanceSquared === closestDistanceSquared &&
						(points.depth[index] < closestDepth ||
							(points.depth[index] === closestDepth && index < closest)));
				if (isBetter) {
					closest = index;
					closestDistanceSquared = distanceSquared;
					closestDepth = points.depth[index];
				}
			}
		}
	}
	return closest;
}
