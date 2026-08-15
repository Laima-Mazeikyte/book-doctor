import { describe, expect, it } from 'vitest';
import type { AuthorIndex } from './author-taste/authors';
import type { PersonalAuthorRating } from './author-taste/personal';
import type { MappedAuthor } from './author-taste/types';
import {
	affineTransformScreenBuffers,
	CanvasPointRenderer,
	POINT_TIER_CONTEXT,
	POINT_TIER_FOCUS,
	POINT_TIER_PARENT,
	projectRotatedInto,
	rotateWorldInto,
	stableMergeSort,
	type CanvasRendererColors
} from './canvasPointRenderer';
import { projector, projectorInto, type OrbitState } from './orbit';

const viewport = { width: 200, height: 100 };
const colors: CanvasRendererColors = {
	background: '#fff',
	context: '#999',
	focus: '#f00',
	loved: '#0a0',
	hated: '#a00',
	neutral: '#00a'
};

interface ArcRecord {
	x: number;
	y: number;
	radius: number;
	fillStyle: string;
	globalAlpha: number;
}

interface StrokeRecord {
	x: number;
	y: number;
	radius: number;
	strokeStyle: string;
	globalAlpha: number;
	lineWidth: number;
	dash: number[];
}

class RecordingContext {
	private currentArc: { x: number; y: number; radius: number } | null = null;
	private currentFillStyle = '';
	fillAssignments: string[] = [];
	fillRecords: ArcRecord[] = [];
	strokeRecords: StrokeRecord[] = [];
	fillRectRecords: Array<{ x: number; y: number; width: number; height: number }> = [];
	transformRecords: number[][] = [];
	dashRecords: number[][] = [];
	globalAlpha = 1;
	strokeStyle = '';
	lineWidth = 1;
	lineDash: number[] = [];

	get fillStyle(): string {
		return this.currentFillStyle;
	}

	set fillStyle(value: string) {
		this.currentFillStyle = value;
		this.fillAssignments.push(value);
	}

	setTransform(...values: number[]): void {
		this.transformRecords.push(values);
	}

	fillRect(x: number, y: number, width: number, height: number): void {
		this.fillRectRecords.push({ x, y, width, height });
	}

	beginPath(): void {
		this.currentArc = null;
	}

	arc(x: number, y: number, radius: number): void {
		this.currentArc = { x, y, radius };
	}

	fill(): void {
		if (!this.currentArc) return;
		this.fillRecords.push({
			...this.currentArc,
			fillStyle: this.fillStyle,
			globalAlpha: this.globalAlpha
		});
	}

	stroke(): void {
		if (!this.currentArc) return;
		this.strokeRecords.push({
			...this.currentArc,
			strokeStyle: this.strokeStyle,
			globalAlpha: this.globalAlpha,
			lineWidth: this.lineWidth,
			dash: [...this.lineDash]
		});
	}

	setLineDash(value: number[]): void {
		this.lineDash = [...value];
		this.dashRecords.push([...value]);
	}
}

function makeAuthor(id: number, x = 0, y = 0, z = 0, name = `Author ${id}`): MappedAuthor {
	return {
		id,
		name,
		x,
		y,
		z,
		communityId: 1,
		subcommunityId: 0,
		mapState: 1,
		bookCount: 0,
		genre: 'fiction',
		connectionPairCount: 0,
		selectedOutDegree: 0,
		selectedInDegree: 0,
		reliableOneSidedOutDegree: 0,
		reliableOneSidedInDegree: 0,
		sampleTitles: [],
		connectionBucket: null,
		connectionOffset: null,
		connectionBytes: null,
		searchKey: name.toLowerCase()
	};
}

function makeIndex(authors: MappedAuthor[]): AuthorIndex {
	return {
		mapped: authors,
		communityById: new Map([[1, { color: '#c1c1c1' }]])
	} as unknown as AuthorIndex;
}

function makeCamera(overrides: Partial<OrbitState> = {}): OrbitState {
	return {
		yaw: 0,
		pitch: 0,
		zoom: 1,
		panX: 0,
		panY: 0,
		centre: [0, 0, 0],
		radius: 1,
		...overrides
	};
}

function makeCanvas(context: RecordingContext | null): HTMLCanvasElement {
	return {
		width: 0,
		height: 0,
		getContext: () => context as unknown as CanvasRenderingContext2D | null
	} as unknown as HTMLCanvasElement;
}

function makeRenderer(
	authors: MappedAuthor[],
	context = new RecordingContext(),
	dpr = 1
): { renderer: CanvasPointRenderer; context: RecordingContext; camera: OrbitState } {
	const renderer = new CanvasPointRenderer(makeCanvas(context), makeIndex(authors), colors);
	renderer.resize(viewport.width, viewport.height, dpr);
	const camera = makeCamera();
	return { renderer, context, camera };
}

function rating(category: PersonalAuthorRating['category']): PersonalAuthorRating {
	return { average: category === 'loved' ? 5 : category === 'hated' ? 1 : 3, count: 1, category };
}

describe('canvas point renderer math', () => {
	it('matches the full projector after cached rotation', () => {
		const camera: OrbitState = {
			yaw: -0.47,
			pitch: 0.82,
			zoom: 1.7,
			panX: 38,
			panY: -21,
			centre: [2, -3, 4],
			radius: 11
		};
		const worldX = new Float32Array([-8, 0, 6, 11]);
		const worldY = new Float32Array([2, -4, 3, 8]);
		const worldZ = new Float32Array([5, -7, 1, -2]);
		const rotatedX = new Float32Array(worldX.length);
		const rotatedY = new Float32Array(worldX.length);
		const rotatedDepth = new Float32Array(worldX.length);
		const screenX = new Float32Array(worldX.length);
		const screenY = new Float32Array(worldX.length);
		const screenDepth = new Float32Array(worldX.length);
		const screenRadius = new Float32Array(worldX.length);
		const expectedX = new Float32Array(worldX.length);
		const expectedY = new Float32Array(worldX.length);
		const expectedDepth = new Float32Array(worldX.length);

		rotateWorldInto(camera, worldX, worldY, worldZ, rotatedX, rotatedY, rotatedDepth);
		projectRotatedInto(
			camera,
			960,
			640,
			rotatedX,
			rotatedY,
			rotatedDepth,
			screenX,
			screenY,
			screenDepth,
			screenRadius
		);
		const fullProject = projectorInto(
			camera,
			{ width: 960, height: 640 },
			expectedX,
			expectedY,
			expectedDepth
		);
		for (let slot = 0; slot < worldX.length; slot++)
			fullProject(slot, worldX[slot], worldY[slot], worldZ[slot]);

		for (let slot = 0; slot < worldX.length; slot++) {
			expect(screenX[slot]).toBeCloseTo(expectedX[slot], 4);
			expect(screenY[slot]).toBeCloseTo(expectedY[slot], 4);
			expect(screenDepth[slot]).toBeCloseTo(expectedDepth[slot], 5);
		}
	});

	it('matches a full projection after an affine pan and zoom', () => {
		const camera = makeCamera({
			yaw: -0.47,
			pitch: 0.82,
			zoom: 1.7,
			panX: 38,
			panY: -21,
			centre: [2, -3, 4],
			radius: 11
		});
		const worldX = new Float32Array([-3, 0, 7]);
		const worldY = new Float32Array([1, -5, 4]);
		const worldZ = new Float32Array([2, 6, -8]);
		const screenX = new Float32Array(worldX.length);
		const screenY = new Float32Array(worldX.length);
		const screenDepth = new Float32Array(worldX.length);
		const expectedX = new Float32Array(worldX.length);
		const expectedY = new Float32Array(worldX.length);
		const expectedDepth = new Float32Array(worldX.length);
		const initialProject = projectorInto(
			camera,
			{ width: 960, height: 640 },
			screenX,
			screenY,
			screenDepth
		);
		const fullProject = projectorInto(
			camera,
			{ width: 960, height: 640 },
			expectedX,
			expectedY,
			expectedDepth
		);
		for (let slot = 0; slot < worldX.length; slot++) {
			initialProject(slot, worldX[slot], worldY[slot], worldZ[slot]);
			fullProject(slot, worldX[slot], worldY[slot], worldZ[slot]);
		}

		const next = { ...camera, zoom: 2.4, panX: -17, panY: 33 };
		affineTransformScreenBuffers(screenX, screenY, 960, 640, camera, next);
		const nextProject = projectorInto(
			next,
			{ width: 960, height: 640 },
			expectedX,
			expectedY,
			expectedDepth
		);
		for (let slot = 0; slot < worldX.length; slot++)
			nextProject(slot, worldX[slot], worldY[slot], worldZ[slot]);

		for (let slot = 0; slot < worldX.length; slot++) {
			expect(screenX[slot]).toBeCloseTo(expectedX[slot], 4);
			expect(screenY[slot]).toBeCloseTo(expectedY[slot], 4);
		}
	});

	it('uses one stable merge-sort path and reports whether it reordered', () => {
		const depth = new Float32Array([2, 1, 1, -3, 0, 1]);
		const order = new Int32Array([0, 1, 2, 3, 4, 5]);
		expect(stableMergeSort(order, new Int32Array(order.length), depth)).toBe(true);
		expect([...order]).toEqual([3, 4, 1, 2, 5, 0]);
		expect(stableMergeSort(order, new Int32Array(order.length), depth)).toBe(false);
	});
});

describe('canvas point renderer', () => {
	it('paints native circles in depth order and culls offscreen markers', () => {
		const authors = [
			makeAuthor(0, -0.6, 0, 0.4),
			makeAuthor(1, 0, 0, -0.4),
			makeAuthor(2, 0.6, 0, 0),
			makeAuthor(3, 3, 0, 0)
		];
		const { renderer, context, camera } = makeRenderer(authors);
		renderer.render(camera, 'data', false);

		const projected = authors.slice(0, 3).map((author) => projector(camera, viewport)(author));
		projected.sort((a, b) => a.depth - b.depth);
		expect(context.fillRectRecords).toHaveLength(1);
		expect(context.fillRecords).toHaveLength(3);
		expect(context.fillRecords.map((record) => record.fillStyle)).toEqual([
			'#c1c1c1',
			'#c1c1c1',
			'#c1c1c1'
		]);
		for (let index = 0; index < projected.length; index++) {
			expect(context.fillRecords[index].x).toBeCloseTo(projected[index].x, 3);
			expect(context.fillRecords[index].y).toBeCloseTo(projected[index].y, 3);
			expect(context.fillRecords[index].radius).toBeGreaterThanOrEqual(1);
		}
		expect(context.fillAssignments.filter((value) => value === '#c1c1c1')).toHaveLength(1);
	});

	it('preserves context, parent, focus, depth, and personal alpha tiers', () => {
		const authors = [makeAuthor(0, -0.3), makeAuthor(1, 0, 0, 0.1), makeAuthor(2, 0.3, 0, 0.2)];
		const { renderer, context, camera } = makeRenderer(authors);
		const flags = new Uint8Array([POINT_TIER_CONTEXT, POINT_TIER_PARENT, POINT_TIER_FOCUS]);
		expect(renderer.setEmphasis(flags, true)).toBe(true);
		expect(renderer.setEmphasis(flags, true)).toBe(false);
		expect(renderer.setPersonalRatings(new Map([[2, rating('loved')]]))).toBe(true);
		expect(renderer.setPersonalRatingsVisibility(true)).toBe(true);
		renderer.render(camera, 'data', false);

		expect(context.fillRecords).toHaveLength(3);
		expect(context.fillRecords.map((record) => record.fillStyle)).toEqual([
			'#999',
			'#c1c1c1',
			'#f00'
		]);
		expect(context.fillRecords[0].globalAlpha).toBeCloseTo(0.0232, 3);
		expect(context.fillRecords[1].globalAlpha).toBeCloseTo(0.037888, 4);
		expect(context.fillRecords[2].globalAlpha).toBeCloseTo(0.9, 3);
	});

	it('draws rating rings by category after point circles', () => {
		const authors = [
			makeAuthor(0, -0.3, 0, -0.2),
			makeAuthor(1, 0, 0, 0),
			makeAuthor(2, 0.3, 0, 0.2)
		];
		const { renderer, context, camera } = makeRenderer(authors);
		const ratings = new Map<number, PersonalAuthorRating>([
			[0, rating('loved')],
			[1, rating('hated')],
			[2, rating('neutral')]
		]);
		renderer.setPersonalRatings(ratings);
		renderer.setPersonalRatingsVisibility(true);
		renderer.render(camera, 'data', false);

		expect(context.fillRecords).toHaveLength(3);
		expect(context.strokeRecords).toHaveLength(3);
		expect(context.strokeRecords.map((record) => record.strokeStyle)).toEqual([
			'#0a0',
			'#a00',
			'#00a'
		]);
		expect(context.strokeRecords.map((record) => record.dash)).toEqual([[], [4, 2], [1.5, 2.5]]);
		expect(context.strokeRecords.every((record) => record.globalAlpha === 0.95)).toBe(true);
	});

	it('uses affine updates for pan and zoom, and sorts only after orbit', () => {
		const { renderer, camera } = makeRenderer([makeAuthor(0, 0), makeAuthor(1, 0.3, 0, 0.2)]);
		renderer.render(camera, 'data', false);
		expect(renderer.projectionCount).toBe(1);
		expect(renderer.depthSortCount).toBe(1);

		renderer.render({ ...camera, panX: 12 }, 'pan', true);
		renderer.render({ ...camera, panX: 12, zoom: 1.4 }, 'zoom', true);
		expect(renderer.projectionCount).toBe(1);
		expect(renderer.affineTransformCount).toBe(2);
		expect(renderer.depthSortCount).toBe(1);

		renderer.render({ ...camera, yaw: 0.3, panX: 12, zoom: 1.4 }, 'orbit', false);
		expect(renderer.projectionCount).toBe(2);
		expect(renderer.depthSortCount).toBe(2);
	});

	it('keeps data-only and theme updates off the geometry paths', () => {
		const { renderer, context, camera } = makeRenderer([makeAuthor(0), makeAuthor(1, 0.3, 0, 0.2)]);
		renderer.render(camera, 'data', false);
		const projectionCount = renderer.projectionCount;
		const sortCount = renderer.depthSortCount;
		const gridCount = renderer.pickGridRebuildCount;

		renderer.render(camera, 'data', false);
		expect(renderer.projectionCount).toBe(projectionCount);
		expect(renderer.depthSortCount).toBe(sortCount);
		expect(renderer.pickGridRebuildCount).toBe(gridCount);

		expect(renderer.setColors({ ...colors, background: '#000' })).toBe(true);
		renderer.render(camera, 'data', false);
		expect(renderer.projectionCount).toBe(projectionCount);
		expect(renderer.depthSortCount).toBe(sortCount);
		expect(context.fillAssignments).toContain('#000');
	});

	it('does not rebuild the pick grid while moving and reuses it for data-only paint', () => {
		const { renderer, camera } = makeRenderer([makeAuthor(0, 0)]);
		renderer.render(camera, 'data', true);
		expect(renderer.pickGridRebuildCount).toBe(0);
		renderer.settle(camera);
		expect(renderer.pickGridRebuildCount).toBe(1);
		expect(renderer.projectionCount).toBe(2);
		renderer.settle(camera);
		expect(renderer.pickGridRebuildCount).toBe(1);
		renderer.render(camera, 'data', false);
		expect(renderer.pickGridRebuildCount).toBe(1);
	});

	it('configures the DPR transform only when the backing surface changes', () => {
		const context = new RecordingContext();
		const { renderer, camera } = makeRenderer([makeAuthor(0)], context, 2);
		const canvas = (renderer as unknown as { canvas: HTMLCanvasElement }).canvas;
		renderer.render(camera, 'data', false);
		renderer.render(camera, 'data', false);
		expect(canvas.width).toBe(400);
		expect(canvas.height).toBe(200);
		expect(context.transformRecords).toHaveLength(1);
		renderer.resize(viewport.width, viewport.height, 1);
		renderer.render(camera, 'data', false);
		expect(context.transformRecords).toHaveLength(2);
	});

	it('uses separate mouse and touch picking radii', () => {
		const author = makeAuthor(0, 0);
		const { renderer, camera } = makeRenderer([author]);
		renderer.render(camera, 'data', false);
		const point = projector(camera, viewport)(author);
		expect(renderer.pick(point.x + 13, point.y, false)).toBeNull();
		expect(renderer.pick(point.x + 13, point.y, true)).toBe(0);
	});

	it('requires a marker to intersect the viewport before skipping map recovery', () => {
		const { renderer, camera } = makeRenderer([makeAuthor(0, -2.8)]);
		const recovery = renderer.recoverLostMap(camera);
		expect(recovery).not.toBeNull();
	});

	it('reports unavailable contexts and remains safe after disposal', () => {
		const renderer = new CanvasPointRenderer(makeCanvas(null), makeIndex([makeAuthor(0)]), colors);
		renderer.resize(viewport.width, viewport.height);
		expect(() => renderer.render(makeCamera(), 'data', false)).not.toThrow();
		expect(renderer.isAvailable).toBe(false);
		renderer.dispose();
		expect(() => renderer.render(makeCamera(), 'data', false)).not.toThrow();
		expect(renderer.isAvailable).toBe(false);
	});
});
