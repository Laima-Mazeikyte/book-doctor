import { authorColor, type AuthorIndex } from './author-taste/authors';
import type { PersonalAuthorRating, PersonalRatingCategory } from './author-taste/personal';
import type { MappedAuthor } from './author-taste/types';
import type { OrbitState } from './orbit';

/** Emphasis tiers are deliberately numeric so the hot loop never reads author objects. */
export const POINT_TIER_CONTEXT = 0;
export const POINT_TIER_PARENT = 1;
export const POINT_TIER_FOCUS = 2;

const CONTEXT_ALPHA = 0.2;
const PARENT_ALPHA = 0.32;
const FOCUS_MIN_ALPHA = 0.9;
const PERSONAL_CONTEXT_ALPHA = 0.2;

const PICK_RADIUS = 12;
const TOUCH_PICK_RADIUS = 24;
const PICK_GRID_CELL = 56;
const PICK_GRID_MARGIN = TOUCH_PICK_RADIUS;

/* These match the hand-rolled projection in orbit.ts. */
const CAMERA_DISTANCE = 3.4;
const NEAR_CLAMP = 0.7;
const FIT_FRACTION = 0.43;

const LOVED_CATEGORY = 1;
const HATED_CATEGORY = 2;
const NEUTRAL_CATEGORY = 3;

const LOVED_DASH: number[] = [];
const HATED_DASH = [4, 2];
const NEUTRAL_DASH = [1.5, 2.5];

function clampedDpr(value: number): number {
	return Math.max(1, Math.min(value || 1, 2));
}

export type CanvasRenderKind = 'orbit' | 'pan' | 'zoom' | 'flight' | 'canonical' | 'data';

export interface CanvasRendererColors {
	background: string;
	context: string;
	focus: string;
	loved: string;
	hated: string;
	neutral: string;
}

function sameOrientation(a: OrbitState | null, b: OrbitState): boolean {
	return a !== null && a.yaw === b.yaw && a.pitch === b.pitch;
}

function sameProjection(a: OrbitState | null, b: OrbitState): boolean {
	return (
		a !== null &&
		sameOrientation(a, b) &&
		a.radius === b.radius &&
		a.centre[0] === b.centre[0] &&
		a.centre[1] === b.centre[1] &&
		a.centre[2] === b.centre[2]
	);
}

/** Rotate absolute world coordinates once; projection then only subtracts the rotated camera centre. */
export function rotateWorldInto(
	camera: OrbitState,
	worldX: Float32Array,
	worldY: Float32Array,
	worldZ: Float32Array,
	rotatedX: Float32Array,
	rotatedY: Float32Array,
	rotatedDepth: Float32Array
): void {
	const cosYaw = Math.cos(camera.yaw);
	const sinYaw = Math.sin(camera.yaw);
	const cosPitch = Math.cos(camera.pitch);
	const sinPitch = Math.sin(camera.pitch);
	for (let slot = 0; slot < worldX.length; slot++) {
		const yawX = cosYaw * worldX[slot] + sinYaw * worldZ[slot];
		const yawZ = -sinYaw * worldX[slot] + cosYaw * worldZ[slot];
		rotatedX[slot] = yawX;
		rotatedY[slot] = cosPitch * worldY[slot] - sinPitch * yawZ;
		rotatedDepth[slot] = sinPitch * worldY[slot] + cosPitch * yawZ;
	}
}

/** Project cached camera-oriented coordinates using the same perspective as orbit.ts. */
export function projectRotatedInto(
	camera: OrbitState,
	width: number,
	height: number,
	rotatedX: Float32Array,
	rotatedY: Float32Array,
	rotatedDepth: Float32Array,
	screenX: Float32Array,
	screenY: Float32Array,
	screenDepth: Float32Array,
	screenRadius: Float32Array
): void {
	const cosYaw = Math.cos(camera.yaw);
	const sinYaw = Math.sin(camera.yaw);
	const cosPitch = Math.cos(camera.pitch);
	const sinPitch = Math.sin(camera.pitch);
	const yawX = cosYaw * camera.centre[0] + sinYaw * camera.centre[2];
	const yawZ = -sinYaw * camera.centre[0] + cosYaw * camera.centre[2];
	const centreX = yawX;
	const centreY = cosPitch * camera.centre[1] - sinPitch * yawZ;
	const centreDepth = sinPitch * camera.centre[1] + cosPitch * yawZ;
	projectRotatedWithCentreInto(
		camera,
		width,
		height,
		centreX,
		centreY,
		centreDepth,
		rotatedX,
		rotatedY,
		rotatedDepth,
		screenX,
		screenY,
		screenDepth,
		screenRadius
	);
}

function projectRotatedWithCentreInto(
	camera: OrbitState,
	width: number,
	height: number,
	centreX: number,
	centreY: number,
	centreDepth: number,
	rotatedX: Float32Array,
	rotatedY: Float32Array,
	rotatedDepth: Float32Array,
	screenX: Float32Array,
	screenY: Float32Array,
	screenDepth: Float32Array,
	screenRadius: Float32Array
): void {
	const inverseRadius = 1 / camera.radius;
	const scale = Math.min(width, height) * FIT_FRACTION * camera.zoom;
	const originX = width / 2 + camera.panX;
	const originY = height / 2 + camera.panY;
	for (let slot = 0; slot < rotatedX.length; slot++) {
		const x = (rotatedX[slot] - centreX) * inverseRadius;
		const y = (rotatedY[slot] - centreY) * inverseRadius;
		const depth = (rotatedDepth[slot] - centreDepth) * inverseRadius;
		const perspective = CAMERA_DISTANCE / Math.max(NEAR_CLAMP, CAMERA_DISTANCE - depth);
		screenX[slot] = originX + x * scale * perspective;
		screenY[slot] = originY - y * scale * perspective;
		screenDepth[slot] = depth;
		screenRadius[slot] = Math.max(1, Math.min(6, 2.5 * perspective));
	}
}

/** Exact affine screen-space update for a pan/zoom-only camera sample. */
export function affineTransformScreenBuffers(
	screenX: Float32Array,
	screenY: Float32Array,
	width: number,
	height: number,
	previous: OrbitState,
	camera: OrbitState
): void {
	const oldOriginX = width / 2 + previous.panX;
	const oldOriginY = height / 2 + previous.panY;
	const newOriginX = width / 2 + camera.panX;
	const newOriginY = height / 2 + camera.panY;
	const ratio = camera.zoom / previous.zoom;
	for (let slot = 0; slot < screenX.length; slot++) {
		screenX[slot] = newOriginX + (screenX[slot] - oldOriginX) * ratio;
		screenY[slot] = newOriginY + (screenY[slot] - oldOriginY) * ratio;
	}
}

/** Stable bottom-up merge sort with caller-owned scratch storage and no comparator callback. */
export function stableMergeSort(
	order: Int32Array,
	scratch: Int32Array,
	depth: Float32Array
): boolean {
	if (order.length < 2) return false;
	let changed = false;
	let source = order;
	let target = scratch;
	for (let width = 1; width < order.length; width *= 2) {
		for (let start = 0; start < order.length; start += width * 2) {
			const middle = Math.min(start + width, order.length);
			const end = Math.min(start + width * 2, order.length);
			let left = start;
			let right = middle;
			let output = start;
			while (left < middle && right < end) {
				/* <= retains the input order for equal depths. */
				if (depth[source[left]] <= depth[source[right]]) target[output++] = source[left++];
				else {
					changed = true;
					target[output++] = source[right++];
				}
			}
			while (left < middle) target[output++] = source[left++];
			while (right < end) target[output++] = source[right++];
		}
		const swap = source;
		source = target;
		target = swap;
	}
	if (source !== order) order.set(source);
	return changed;
}

/**
 * The non-reactive canvas cloud renderer. AuthorMap owns semantic state and the SVG layer; this
 * class owns every buffer touched by the 7,911-point paint path.
 */
export class CanvasPointRenderer {
	private readonly canvas: HTMLCanvasElement;
	private readonly authors: readonly MappedAuthor[];
	private readonly count: number;
	private readonly worldX: Float32Array;
	private readonly worldY: Float32Array;
	private readonly worldZ: Float32Array;
	private readonly basePointColors: string[];
	private readonly paletteIndex: Uint16Array;
	private paletteColors: string[] = [];
	private contextPaletteIndex = 0;
	private focusPaletteIndex = 0;

	private readonly rotatedX: Float32Array;
	private readonly rotatedY: Float32Array;
	private readonly rotatedDepth: Float32Array;
	private readonly screenX: Float32Array;
	private readonly screenY: Float32Array;
	private readonly screenDepth: Float32Array;
	private readonly screenRadius: Float32Array;
	private readonly recoveryX: Float32Array;
	private readonly recoveryY: Float32Array;
	private readonly recoveryDepth: Float32Array;
	private readonly authorSlotById: Map<number, number>;

	private readonly drawOrder: Int32Array;
	private readonly sortScratch: Int32Array;
	private readonly ratedOrder: Int32Array;
	private readonly ratedSlots: Int32Array;
	private ratedCount = 0;
	private ratedSlotCount = 0;
	private ratedOrderDirty = true;
	private readonly ratingCategory: Int8Array;

	private readonly visibleAll: Int32Array;
	private readonly visibleContext: Int32Array;
	private readonly visibleParent: Int32Array;
	private readonly visibleFocus: Int32Array;
	private visibleAllCount = 0;
	private visibleContextCount = 0;
	private visibleParentCount = 0;
	private visibleFocusCount = 0;

	private context: CanvasRenderingContext2D | null = null;
	private contextAttempted = false;
	private unavailable = false;
	private colors: CanvasRendererColors;
	private width = 0;
	private height = 0;
	private dpr = 1;
	private surfaceConfigured = false;
	private lastFillStyle: string | null = null;
	private disposed = false;

	private renderedCamera: OrbitState | null = null;
	private forceFullProjection = true;

	private rotationValid = false;
	private rotationYaw = Number.NaN;
	private rotationPitch = Number.NaN;
	private rotatedCentreX = 0;
	private rotatedCentreY = 0;
	private rotatedCentreDepth = 0;

	private depthOrderValid = false;
	private depthOrderYaw = Number.NaN;
	private depthOrderPitch = Number.NaN;

	private emphasisFlags: Uint8Array | null = null;
	private subgroupEmphasis = false;
	private showPersonalRatings = false;
	private personalRatingsReference: ReadonlyMap<number, PersonalAuthorRating> | null = null;

	private pickGridHeads = new Int32Array(0);
	private pickGridNext: Int32Array;
	private pickGridColumns = 0;
	private pickGridRows = 0;
	private pickGridValid = false;

	private fullProjectionCount = 0;
	private affineTransformTotal = 0;
	private depthSortTotal = 0;
	private pickGridRebuildTotal = 0;

	constructor(canvas: HTMLCanvasElement, index: AuthorIndex, colors: CanvasRendererColors) {
		this.canvas = canvas;
		this.authors = index.mapped;
		this.count = this.authors.length;
		this.worldX = new Float32Array(this.count);
		this.worldY = new Float32Array(this.count);
		this.worldZ = new Float32Array(this.count);
		this.basePointColors = new Array<string>(this.count);
		this.paletteIndex = new Uint16Array(this.count);
		this.rotatedX = new Float32Array(this.count);
		this.rotatedY = new Float32Array(this.count);
		this.rotatedDepth = new Float32Array(this.count);
		this.screenX = new Float32Array(this.count);
		this.screenY = new Float32Array(this.count);
		this.screenDepth = new Float32Array(this.count);
		this.screenRadius = new Float32Array(this.count);
		this.recoveryX = new Float32Array(this.count);
		this.recoveryY = new Float32Array(this.count);
		this.recoveryDepth = new Float32Array(this.count);
		this.authorSlotById = new Map();
		this.drawOrder = new Int32Array(this.count);
		this.sortScratch = new Int32Array(this.count);
		this.ratedOrder = new Int32Array(this.count);
		this.ratedSlots = new Int32Array(this.count);
		this.ratingCategory = new Int8Array(this.count);
		this.visibleAll = new Int32Array(this.count);
		this.visibleContext = new Int32Array(this.count);
		this.visibleParent = new Int32Array(this.count);
		this.visibleFocus = new Int32Array(this.count);
		this.pickGridNext = new Int32Array(this.count);

		for (let slot = 0; slot < this.count; slot++) {
			const author = this.authors[slot];
			this.worldX[slot] = author.x;
			this.worldY[slot] = author.y;
			this.worldZ[slot] = author.z;
			this.basePointColors[slot] = authorColor(index, author);
			this.authorSlotById.set(author.id, slot);
			this.drawOrder[slot] = slot;
		}

		this.colors = { ...colors };
		this.rebuildPalette();
	}

	get isAvailable(): boolean {
		return !this.disposed && !this.unavailable;
	}

	get projectionCount(): number {
		return this.fullProjectionCount;
	}

	get affineTransformCount(): number {
		return this.affineTransformTotal;
	}

	get depthSortCount(): number {
		return this.depthSortTotal;
	}

	get pickGridRebuildCount(): number {
		return this.pickGridRebuildTotal;
	}

	private rebuildPalette(): void {
		this.paletteColors.length = 0;
		const paletteByColor = new Map<string, number>();
		const add = (color: string): number => {
			const existing = paletteByColor.get(color);
			if (existing !== undefined) return existing;
			const slot = this.paletteColors.length;
			paletteByColor.set(color, slot);
			this.paletteColors.push(color);
			return slot;
		};

		for (let slot = 0; slot < this.count; slot++) {
			this.paletteIndex[slot] = add(this.basePointColors[slot] || this.colors.context);
		}
		this.contextPaletteIndex = add(this.colors.context);
		this.focusPaletteIndex = add(this.colors.focus);
	}

	setColors(colors: CanvasRendererColors): boolean {
		const paletteChanged =
			this.colors.context !== colors.context || this.colors.focus !== colors.focus;
		const backgroundChanged = this.colors.background !== colors.background;
		const changed =
			paletteChanged ||
			backgroundChanged ||
			this.colors.loved !== colors.loved ||
			this.colors.hated !== colors.hated ||
			this.colors.neutral !== colors.neutral;
		if (!changed) return false;
		this.colors = { ...colors };
		if (paletteChanged) this.rebuildPalette();
		if (backgroundChanged) this.lastFillStyle = null;
		return true;
	}

	setEmphasis(flags: Uint8Array | null, subgroupEmphasis: boolean): boolean {
		if (this.emphasisFlags === flags && this.subgroupEmphasis === subgroupEmphasis) return false;
		this.emphasisFlags = flags;
		this.subgroupEmphasis = subgroupEmphasis;
		return true;
	}

	setPersonalRatings(personalRatings: ReadonlyMap<number, PersonalAuthorRating>): boolean {
		if (this.personalRatingsReference === personalRatings) return false;
		this.personalRatingsReference = personalRatings;

		for (let index = 0; index < this.ratedSlotCount; index++) {
			this.ratingCategory[this.ratedSlots[index]] = 0;
		}
		this.ratedSlotCount = 0;
		for (const [authorId, rating] of personalRatings) {
			const slot = this.authorSlotById.get(authorId);
			if (slot === undefined) continue;
			this.ratingCategory[slot] = categoryCode(rating.category);
			this.ratedSlots[this.ratedSlotCount++] = slot;
		}
		this.ratedOrderDirty = true;
		return true;
	}

	setPersonalRatingsVisibility(showPersonalRatings: boolean): boolean {
		if (this.showPersonalRatings === showPersonalRatings) return false;
		this.showPersonalRatings = showPersonalRatings;
		return true;
	}

	resize(width: number, height: number, devicePixelRatio?: number): boolean {
		const nextWidth = Math.max(0, width);
		const nextHeight = Math.max(0, height);
		const nextDpr = clampedDpr(
			devicePixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
		);
		const changed = this.width !== nextWidth || this.height !== nextHeight || this.dpr !== nextDpr;
		if (!changed) return false;
		this.width = nextWidth;
		this.height = nextHeight;
		this.dpr = nextDpr;
		this.renderedCamera = null;
		this.forceFullProjection = true;
		this.pickGridValid = false;
		this.surfaceConfigured = false;
		return true;
	}

	private ensureContext(): CanvasRenderingContext2D | null {
		if (this.context || this.contextAttempted) return this.context;
		this.contextAttempted = true;
		try {
			this.context = this.canvas.getContext('2d', { alpha: false });
		} catch {
			this.context = null;
		}
		if (!this.context) this.unavailable = true;
		return this.context;
	}

	private ensureSurface(): boolean {
		const context = this.ensureContext();
		if (!context) return false;
		const pixelWidth = Math.round(this.width * this.dpr);
		const pixelHeight = Math.round(this.height * this.dpr);
		if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
			this.canvas.width = pixelWidth;
			this.canvas.height = pixelHeight;
			this.renderedCamera = null;
			this.forceFullProjection = true;
			this.pickGridValid = false;
			this.surfaceConfigured = false;
			this.lastFillStyle = null;
		}
		if (!this.surfaceConfigured) {
			context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
			this.surfaceConfigured = true;
		}
		context.globalAlpha = 1;
		if (this.lastFillStyle !== this.colors.background) {
			context.fillStyle = this.colors.background;
			this.lastFillStyle = this.colors.background;
		}
		context.fillRect(0, 0, this.width, this.height);
		return true;
	}

	private rotateScene(camera: OrbitState): void {
		rotateWorldInto(
			camera,
			this.worldX,
			this.worldY,
			this.worldZ,
			this.rotatedX,
			this.rotatedY,
			this.rotatedDepth
		);
		this.rotationValid = true;
		this.rotationYaw = camera.yaw;
		this.rotationPitch = camera.pitch;
		this.updateRotatedCentre(camera);
	}

	private updateRotatedCentre(camera: OrbitState): void {
		const cosYaw = Math.cos(camera.yaw);
		const sinYaw = Math.sin(camera.yaw);
		const cosPitch = Math.cos(camera.pitch);
		const sinPitch = Math.sin(camera.pitch);
		const yawX = cosYaw * camera.centre[0] + sinYaw * camera.centre[2];
		const yawZ = -sinYaw * camera.centre[0] + cosYaw * camera.centre[2];
		this.rotatedCentreX = yawX;
		this.rotatedCentreY = cosPitch * camera.centre[1] - sinPitch * yawZ;
		this.rotatedCentreDepth = sinPitch * camera.centre[1] + cosPitch * yawZ;
	}

	private projectFull(camera: OrbitState): void {
		this.fullProjectionCount++;
		if (
			!this.rotationValid ||
			this.rotationYaw !== camera.yaw ||
			this.rotationPitch !== camera.pitch
		) {
			this.rotateScene(camera);
		} else {
			this.updateRotatedCentre(camera);
		}

		projectRotatedWithCentreInto(
			camera,
			this.width,
			this.height,
			this.rotatedCentreX,
			this.rotatedCentreY,
			this.rotatedCentreDepth,
			this.rotatedX,
			this.rotatedY,
			this.rotatedDepth,
			this.screenX,
			this.screenY,
			this.screenDepth,
			this.screenRadius
		);
	}

	private sortDepth(camera: OrbitState): void {
		const needsSort =
			!this.depthOrderValid ||
			this.depthOrderYaw !== camera.yaw ||
			this.depthOrderPitch !== camera.pitch;
		if (!needsSort) return;

		this.depthSortTotal++;
		const reordered = stableMergeSort(this.drawOrder, this.sortScratch, this.screenDepth);
		this.depthOrderValid = true;
		this.depthOrderYaw = camera.yaw;
		this.depthOrderPitch = camera.pitch;
		if (reordered) this.ratedOrderDirty = true;
	}

	private transformScreenBuffers(camera: OrbitState, previous: OrbitState): void {
		this.affineTransformTotal++;
		affineTransformScreenBuffers(
			this.screenX,
			this.screenY,
			this.width,
			this.height,
			previous,
			camera
		);
	}

	private rebuildRatedOrder(): void {
		this.ratedCount = 0;
		for (let index = 0; index < this.count; index++) {
			const slot = this.drawOrder[index];
			if (this.ratingCategory[slot] !== 0) this.ratedOrder[this.ratedCount++] = slot;
		}
		this.ratedOrderDirty = false;
	}

	private buildVisibleLists(): void {
		this.visibleAllCount = 0;
		this.visibleContextCount = 0;
		this.visibleParentCount = 0;
		this.visibleFocusCount = 0;
		const flags = this.emphasisFlags;
		for (let index = 0; index < this.count; index++) {
			const slot = this.drawOrder[index];
			const x = this.screenX[slot];
			const y = this.screenY[slot];
			const radius = this.screenRadius[slot];
			if (x < -radius || x > this.width + radius || y < -radius || y > this.height + radius)
				continue;
			if (!flags) this.visibleAll[this.visibleAllCount++] = slot;
			else if (flags[slot] === POINT_TIER_PARENT)
				this.visibleParent[this.visibleParentCount++] = slot;
			else if (flags[slot] === POINT_TIER_FOCUS) this.visibleFocus[this.visibleFocusCount++] = slot;
			else this.visibleContext[this.visibleContextCount++] = slot;
		}
	}

	private paintPoints(
		context: CanvasRenderingContext2D,
		list: Int32Array,
		length: number,
		tier: number,
		lastPaletteIndex: number
	): number {
		const flags = this.emphasisFlags;
		const paletteColors = this.paletteColors;
		const paletteIndex = this.paletteIndex;
		const ratingCategory = this.ratingCategory;
		const screenX = this.screenX;
		const screenY = this.screenY;
		const screenDepth = this.screenDepth;
		const screenRadius = this.screenRadius;
		const showPersonalRatings = this.showPersonalRatings;
		const subgroupEmphasis = this.subgroupEmphasis;
		const contextPaletteIndex = this.contextPaletteIndex;
		const focusPaletteIndex = this.focusPaletteIndex;
		for (let index = 0; index < length; index++) {
			const slot = list[index];
			const depthAlpha = Math.max(0.28, Math.min(0.95, 0.58 + screenDepth[slot] * 0.12));
			const personalAlpha =
				showPersonalRatings && ratingCategory[slot] === 0 ? PERSONAL_CONTEXT_ALPHA : 1;
			let alpha: number;
			let palette = paletteIndex[slot];
			if (tier === POINT_TIER_CONTEXT) {
				alpha = depthAlpha * CONTEXT_ALPHA * personalAlpha;
				palette = contextPaletteIndex;
			} else if (tier === POINT_TIER_PARENT) {
				alpha = depthAlpha * PARENT_ALPHA * personalAlpha;
			} else {
				alpha =
					(tier === POINT_TIER_FOCUS && flags
						? Math.max(FOCUS_MIN_ALPHA, depthAlpha)
						: depthAlpha) * personalAlpha;
				if (subgroupEmphasis && tier === POINT_TIER_FOCUS) palette = focusPaletteIndex;
			}
			if (palette !== lastPaletteIndex) {
				context.fillStyle = paletteColors[palette];
				this.lastFillStyle = paletteColors[palette];
				lastPaletteIndex = palette;
			}
			context.globalAlpha = alpha;
			context.beginPath();
			context.arc(screenX[slot], screenY[slot], screenRadius[slot], 0, Math.PI * 2);
			context.fill();
		}
		return lastPaletteIndex;
	}

	private drawRings(context: CanvasRenderingContext2D): void {
		if (!this.showPersonalRatings) return;
		if (this.ratedOrderDirty) this.rebuildRatedOrder();
		let lastCategory = 0;
		for (let index = 0; index < this.ratedCount; index++) {
			const slot = this.ratedOrder[index];
			const x = this.screenX[slot];
			const y = this.screenY[slot];
			const size = this.screenRadius[slot];
			if (x < -size - 5 || x > this.width + size + 5 || y < -size - 5 || y > this.height + size + 5)
				continue;
			const category = this.ratingCategory[slot];
			context.globalAlpha = 0.95;
			if (category !== lastCategory) {
				context.strokeStyle = this.categoryColor(category);
				context.setLineDash(this.categoryDash(category));
				lastCategory = category;
			}
			context.lineWidth = Math.max(1.25, Math.min(2.5, size * 0.55));
			context.beginPath();
			context.arc(x, y, Math.max(4, size + 3), 0, Math.PI * 2);
			context.stroke();
		}
		context.setLineDash(LOVED_DASH);
	}

	private categoryColor(category: number): string {
		if (category === LOVED_CATEGORY) return this.colors.loved;
		if (category === HATED_CATEGORY) return this.colors.hated;
		return this.colors.neutral;
	}

	private categoryDash(category: number): number[] {
		if (category === HATED_CATEGORY) return HATED_DASH;
		if (category === NEUTRAL_CATEGORY) return NEUTRAL_DASH;
		return LOVED_DASH;
	}

	private rebuildPickGrid(): void {
		this.pickGridRebuildTotal++;
		this.pickGridColumns = Math.max(1, Math.ceil(this.width / PICK_GRID_CELL));
		this.pickGridRows = Math.max(1, Math.ceil(this.height / PICK_GRID_CELL));
		const bucketCount = this.pickGridColumns * this.pickGridRows;
		if (this.pickGridHeads.length !== bucketCount) this.pickGridHeads = new Int32Array(bucketCount);
		this.pickGridHeads.fill(-1);
		this.pickGridNext.fill(-1);
		for (let slot = 0; slot < this.count; slot++) {
			const x = this.screenX[slot];
			const y = this.screenY[slot];
			if (
				x < -PICK_GRID_MARGIN ||
				x > this.width + PICK_GRID_MARGIN ||
				y < -PICK_GRID_MARGIN ||
				y > this.height + PICK_GRID_MARGIN
			)
				continue;
			const column = Math.max(
				0,
				Math.min(this.pickGridColumns - 1, Math.floor(x / PICK_GRID_CELL))
			);
			const row = Math.max(0, Math.min(this.pickGridRows - 1, Math.floor(y / PICK_GRID_CELL)));
			const bucket = row * this.pickGridColumns + column;
			this.pickGridNext[slot] = this.pickGridHeads[bucket];
			this.pickGridHeads[bucket] = slot;
		}
		this.pickGridValid = true;
	}

	/** Paint one camera sample. `moving` suppresses settled picking work during interaction. */
	render(camera: OrbitState, kind: CanvasRenderKind = 'data', moving = false): void {
		if (this.disposed || this.width === 0 || this.height === 0) return;
		if (kind === 'canonical') this.forceFullProjection = true;
		const observedDpr = clampedDpr(
			typeof window !== 'undefined' ? window.devicePixelRatio || 1 : this.dpr
		);
		if (observedDpr !== this.dpr) {
			this.dpr = observedDpr;
			this.renderedCamera = null;
			this.forceFullProjection = true;
			this.pickGridValid = false;
			this.surfaceConfigured = false;
			this.lastFillStyle = null;
		}
		const context = this.ensureContext();
		if (!context || !this.ensureSurface()) return;

		const previous = this.renderedCamera;
		const projectionUnchanged = sameProjection(previous, camera);
		const orientationChanged =
			!this.rotationValid || this.rotationYaw !== camera.yaw || this.rotationPitch !== camera.pitch;
		const fullProjection = this.forceFullProjection || previous === null || !projectionUnchanged;

		let projectedPositionsChanged = false;
		if (fullProjection) {
			this.projectFull(camera);
			projectedPositionsChanged = true;
		} else if (
			camera.zoom !== previous.zoom ||
			camera.panX !== previous.panX ||
			camera.panY !== previous.panY
		) {
			this.transformScreenBuffers(camera, previous);
			projectedPositionsChanged = true;
		}

		if (
			orientationChanged ||
			!this.depthOrderValid ||
			this.depthOrderYaw !== camera.yaw ||
			this.depthOrderPitch !== camera.pitch
		) {
			this.sortDepth(camera);
		}
		if (this.ratedOrderDirty && this.showPersonalRatings) this.rebuildRatedOrder();

		this.buildVisibleLists();
		const flags = this.emphasisFlags;
		let lastPaletteIndex = -1;
		if (flags) {
			lastPaletteIndex = this.paintPoints(
				context,
				this.visibleContext,
				this.visibleContextCount,
				POINT_TIER_CONTEXT,
				lastPaletteIndex
			);
			lastPaletteIndex = this.paintPoints(
				context,
				this.visibleParent,
				this.visibleParentCount,
				POINT_TIER_PARENT,
				lastPaletteIndex
			);
			this.paintPoints(
				context,
				this.visibleFocus,
				this.visibleFocusCount,
				POINT_TIER_FOCUS,
				lastPaletteIndex
			);
		} else {
			this.paintPoints(
				context,
				this.visibleAll,
				this.visibleAllCount,
				POINT_TIER_FOCUS,
				lastPaletteIndex
			);
		}
		this.drawRings(context);
		context.globalAlpha = 1;
		this.forceFullProjection = false;
		this.renderedCamera = camera;
		if (moving) this.pickGridValid = false;
		else if (projectedPositionsChanged || !this.pickGridValid) this.rebuildPickGrid();
	}

	/** Force an exact projection and settled picking after a gesture or flight completes. */
	settle(camera: OrbitState): void {
		if (this.renderedCamera === camera && this.pickGridValid && !this.forceFullProjection) return;
		this.forceFullProjection = true;
		if (this.width === 0 || this.height === 0 || this.disposed) return;
		/* The final visible sample has already been painted by navigation.onRender. Canonicalise
		 * the numeric buffers and picking data here without issuing a second canvas paint. */
		this.projectFull(camera);
		this.sortDepth(camera);
		if (this.ratedOrderDirty && this.showPersonalRatings) this.rebuildRatedOrder();
		this.renderedCamera = camera;
		this.forceFullProjection = false;
		this.rebuildPickGrid();
	}

	pick(px: number, py: number, touch = false): number | null {
		if (!this.pickGridValid || this.pickGridHeads.length === 0) return null;
		const radius = touch ? TOUCH_PICK_RADIUS : PICK_RADIUS;
		const radiusSquared = radius * radius;
		const column = Math.floor(px / PICK_GRID_CELL);
		const row = Math.floor(py / PICK_GRID_CELL);
		/* 56px cells and a 24px maximum hit radius make a 3x3 search sufficient. */
		let bestSlot = -1;
		let bestDistanceSquared = radiusSquared;
		let bestDepth = -Infinity;
		for (let gridY = row - 1; gridY <= row + 1; gridY++) {
			if (gridY < 0 || gridY >= this.pickGridRows) continue;
			for (let gridX = column - 1; gridX <= column + 1; gridX++) {
				if (gridX < 0 || gridX >= this.pickGridColumns) continue;
				let slot = this.pickGridHeads[gridY * this.pickGridColumns + gridX];
				while (slot >= 0) {
					const dx = this.screenX[slot] - px;
					const dy = this.screenY[slot] - py;
					const distanceSquared = dx * dx + dy * dy;
					if (
						distanceSquared <= bestDistanceSquared &&
						(distanceSquared < bestDistanceSquared || this.screenDepth[slot] > bestDepth)
					) {
						bestDistanceSquared = distanceSquared;
						bestDepth = this.screenDepth[slot];
						bestSlot = slot;
					}
					slot = this.pickGridNext[slot];
				}
			}
		}
		return bestSlot >= 0 ? bestSlot : null;
	}

	authorAt(slot: number): MappedAuthor | null {
		return slot >= 0 && slot < this.count ? this.authors[slot] : null;
	}

	/** Find a nearest marker only at gesture completion; no hard pan bounds are imposed. */
	recoverLostMap(camera: OrbitState): OrbitState | null {
		if (this.width === 0 || this.height === 0 || this.count === 0) return null;
		if (
			!this.rotationValid ||
			this.rotationYaw !== camera.yaw ||
			this.rotationPitch !== camera.pitch
		)
			this.rotateScene(camera);
		else this.updateRotatedCentre(camera);

		const inverseRadius = 1 / camera.radius;
		const scale = Math.min(this.width, this.height) * FIT_FRACTION * camera.zoom;
		const originX = this.width / 2 + camera.panX;
		const originY = this.height / 2 + camera.panY;
		let nearestX = 0;
		let nearestY = 0;
		let nearestDistance = Infinity;
		for (let slot = 0; slot < this.count; slot++) {
			const depth = (this.rotatedDepth[slot] - this.rotatedCentreDepth) * inverseRadius;
			const perspective = CAMERA_DISTANCE / Math.max(NEAR_CLAMP, CAMERA_DISTANCE - depth);
			const x =
				originX + (this.rotatedX[slot] - this.rotatedCentreX) * inverseRadius * scale * perspective;
			const y =
				originY - (this.rotatedY[slot] - this.rotatedCentreY) * inverseRadius * scale * perspective;
			const radius = Math.max(1, Math.min(6, 2.5 * perspective));
			this.recoveryX[slot] = x;
			this.recoveryY[slot] = y;
			this.recoveryDepth[slot] = depth;
			/* Recovery uses the actual marker intersection, not a generous search margin. */
			if (
				x + radius >= 0 &&
				x - radius <= this.width &&
				y + radius >= 0 &&
				y - radius <= this.height
			)
				return null;
			const visibleX = Math.min(this.width, Math.max(0, x));
			const visibleY = Math.min(this.height, Math.max(0, y));
			const distance = Math.hypot(x - visibleX, y - visibleY);
			if (distance < nearestDistance) {
				nearestDistance = distance;
				nearestX = x;
				nearestY = y;
			}
		}
		if (!Number.isFinite(nearestDistance)) return null;
		const targetMargin = 10;
		const targetX =
			nearestX < 0 ? targetMargin : nearestX > this.width ? this.width - targetMargin : nearestX;
		const targetY =
			nearestY < 0 ? targetMargin : nearestY > this.height ? this.height - targetMargin : nearestY;
		const panX = camera.panX + targetX - nearestX;
		const panY = camera.panY + targetY - nearestY;
		if (Math.hypot(panX - camera.panX, panY - camera.panY) < 0.5) return null;
		return { ...camera, panX, panY };
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.context = null;
	}
}

function categoryCode(category: PersonalRatingCategory): number {
	if (category === 'loved') return LOVED_CATEGORY;
	if (category === 'hated') return HATED_CATEGORY;
	return NEUTRAL_CATEGORY;
}
