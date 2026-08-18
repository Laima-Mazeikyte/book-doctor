<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import ScreenReaderOnly from '$lib/components/ScreenReaderOnly.svelte';
	import { t } from '$lib/copy';
	import {
		buildProjection,
		projectPointWithTransform,
		type CameraState,
		type ProjectedPoint,
		type ProjectionTransform
	} from '$lib/lab/author-prominence/camera';
	import { FEATURE_COLOURS, type DisplayModel } from '$lib/lab/author-prominence/display';
	import { ProminencePerformanceRecorder } from '$lib/lab/author-prominence/performance';
	import {
		prominenceTimingMeasure,
		prominenceTimingMark
	} from '$lib/lab/author-prominence/performance';
	import { matchesFallbackLayer } from '$lib/lab/author-prominence/fallback-cache';
	import {
		addPickCandidate,
		createPickGrid,
		queryPickGrid,
		type PickGrid
	} from '$lib/lab/author-prominence/picking';
	import type { LensState } from '$lib/lab/author-prominence/lens';
	import { WebGLPointRenderer } from '$lib/lab/author-prominence/webglPointRenderer';
	import type { Population } from '$lib/lab/author-prominence/types';

	interface Props {
		population: Population;
		display: DisplayModel;
		lens: LensState;
		topIndices: ArrayLike<number>;
		top250Indices: ArrayLike<number>;
		rankByIndex: Int32Array;
		rankBuckets: Uint8Array;
		selectedIndex: number | null;
		hoveredIndex: number | null;
		rankingUpdating?: boolean;
		rankingProgressVisible?: boolean;
		onSelect: (index: number | null) => void;
		onHover: (index: number | null) => void;
		onEscape: () => void;
	}

	let {
		population,
		display,
		lens,
		topIndices,
		top250Indices,
		rankByIndex,
		rankBuckets,
		selectedIndex,
		hoveredIndex,
		rankingUpdating = false,
		rankingProgressVisible = false,
		onSelect,
		onHover,
		onEscape
	}: Props = $props();

	const DEFAULT_CAMERA: CameraState = {
		azimuth: -0.74,
		elevation: 0.48,
		zoom: 1,
		panX: 0,
		panY: 0
	};
	const CELL_SIZE = 28;
	const MIN_ZOOM = 0.58;
	const MAX_ZOOM = 2.8;
	const featureColours = FEATURE_COLOURS;
	const worldSource = $derived.by((): Float64Array[] => [
		population.z[display.worldFeatureIndices.regard],
		population.z[display.worldFeatureIndices.reach],
		population.z[display.worldFeatureIndices.recognition]
	]);
	const recognitionNegativeGuideExtent = $derived.by(() => {
		const recognition = worldSource[2];
		let minimum = 0;
		for (let index = 0; index < recognition.length; index++) {
			const value = recognition[index];
			if (Number.isFinite(value)) minimum = Math.min(minimum, value);
		}
		if (minimum === 0) return Math.min(display.domain, 0.5);
		return Math.min(display.domain, Math.max(0.5, Math.ceil(Math.abs(minimum) * 2) / 2));
	});

	let host: HTMLDivElement | null = $state(null);
	let fallbackCanvas: HTMLCanvasElement | null = $state(null);
	let overlayCanvas: HTMLCanvasElement | null = $state(null);
	let webglCanvas: HTMLCanvasElement | null = $state(null);
	let chromeElement: HTMLDivElement | null = $state(null);
	let width = $state(0);
	let height = $state(0);
	let dpr = $state(1);
	let camera = $state<CameraState>({ ...DEFAULT_CAMERA });
	let projection = $state<ProjectionTransform | null>(null);
	let webglAvailable = $state(false);
	let restoringWebgl = $state(false);
	let webglRecovery = $state<'available' | 'lost' | 'restoring' | 'failed'>('failed');
	let reducedMotion = $state(false);
	let cameraMoving = $state(false);
	let pickReady = $state(false);
	let hasProjectedPopulation = $state(false);
	let renderFrame: number | null = null;
	let cameraAnimation: number | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let renderer: WebGLPointRenderer | null = null;
	let pickTimer: ReturnType<typeof setTimeout> | null = null;
	let pickX = new Float32Array(0);
	let pickY = new Float32Array(0);
	let pickDepth = new Float32Array(0);
	let pickVisible = new Uint8Array(0);
	let fallbackOrder = new Int32Array(0);
	let fallbackSampleIndices = new Int32Array(0);
	let fallbackPopulationLayer: HTMLCanvasElement | null = null;
	let fallbackLayerTransform: ProjectionTransform | null = null;
	let fallbackLayerPopulation: Population | null = null;
	let fallbackLayerDisplay: DisplayModel | null = null;
	let fallbackLayerMode = $state<'none' | 'sample' | 'settled'>('none');
	let fallbackLayerBaseCount = 0;
	let pickGrid: PickGrid = {
		cellSize: CELL_SIZE,
		width: 0,
		height: 0,
		cells: new Map()
	};
	const activePointers = new SvelteMap<number, { x: number; y: number }>();
	const performanceRecorder = new ProminencePerformanceRecorder();
	let fallbackPointsDrawn = $state(0);
	let fallbackMode = $state<'none' | 'sample' | 'settled'>('none');
	let fallbackMandatoryCount = $state(0);
	let fallbackFrameId = $state(0);
	let fallbackLayerBuilds = $state(0);
	let fallbackSettledLayerBuilds = $state(0);
	let pickTarget = $state<{ index: number; x: number; y: number; name: string } | null>(null);
	let drag: {
		pointerId: number;
		x: number;
		y: number;
		camera: CameraState;
		mode: 'orbit' | 'pan';
		moved: boolean;
	} | null = null;
	let touchStart: {
		centroid: { x: number; y: number };
		distance: number;
		camera: CameraState;
		moved: boolean;
	} | null = null;
	type AnnotationRect = { left: number; top: number; right: number; bottom: number };
	type InfoState = 'closed' | 'hover' | 'focus' | 'open' | 'dismissed';
	type InfoPosition = { left: number; top: number; width: number };
	let infoState = $state<InfoState>('closed');
	let infoPosition = $state<InfoPosition>({ left: 8, top: 8, width: 448 });
	const INFO_VIEWPORT_MARGIN = 8;
	const INFO_MAX_WIDTH = 448;

	const worldWeights = $derived([
		lens.weights[display.worldFeatureIndices.regard] ?? 0,
		lens.weights[display.worldFeatureIndices.reach] ?? 0,
		lens.weights[display.worldFeatureIndices.recognition] ?? 0
	]);
	const canZoomIn = $derived(camera.zoom < MAX_ZOOM - 1e-9);
	const canZoomOut = $derived(camera.zoom > MIN_ZOOM + 1e-9);
	const hoverPoint = $derived.by(() =>
		hoveredIndex === null || !projection ? null : projectIndex(hoveredIndex, projection)
	);
	const infoVisible = $derived(
		infoState === 'hover' || infoState === 'focus' || infoState === 'open'
	);

	function scheduleInfoPosition(): void {
		if (typeof window === 'undefined') return;
		window.requestAnimationFrame(() => {
			if (!infoVisible) return;
			const trigger = document.getElementById('prominence-field-info-trigger');
			const popover = document.getElementById('prominence-field-info');
			if (!trigger || !popover) return;
			const viewportWidth = Math.max(1, window.innerWidth);
			const viewportHeight = Math.max(1, window.innerHeight);
			const width = Math.min(INFO_MAX_WIDTH, Math.max(1, viewportWidth - INFO_VIEWPORT_MARGIN * 2));
			const triggerRect = trigger.getBoundingClientRect();
			const height = popover.getBoundingClientRect().height;
			const left = Math.max(
				INFO_VIEWPORT_MARGIN,
				Math.min(triggerRect.right - width, viewportWidth - width - INFO_VIEWPORT_MARGIN)
			);
			const above = triggerRect.top - height - INFO_VIEWPORT_MARGIN;
			const below = triggerRect.bottom + INFO_VIEWPORT_MARGIN;
			let top = above >= INFO_VIEWPORT_MARGIN ? above : below;
			top = Math.max(
				INFO_VIEWPORT_MARGIN,
				Math.min(top, viewportHeight - height - INFO_VIEWPORT_MARGIN)
			);
			infoPosition = { left, top, width };
		});
	}

	function handleInfoPointerEnter(): void {
		if (infoState === 'closed' || infoState === 'dismissed') {
			infoState = 'hover';
			scheduleInfoPosition();
		}
	}

	function handleInfoPointerLeave(): void {
		if (infoState === 'hover' || infoState === 'dismissed') infoState = 'closed';
	}

	function handleInfoFocus(): void {
		if (infoState !== 'open') {
			infoState = 'focus';
			scheduleInfoPosition();
		}
	}

	function handleInfoBlur(event: FocusEvent): void {
		if (infoState === 'open' || infoState === 'dismissed') return;
		const wrapper = (event.currentTarget as HTMLElement).parentElement;
		infoState = wrapper?.matches(':hover') ? 'hover' : 'closed';
	}

	function toggleInfo(event: MouseEvent): void {
		if (infoState === 'open') {
			const wrapper = (event.currentTarget as HTMLElement).parentElement;
			infoState = wrapper?.matches(':hover') ? 'dismissed' : 'closed';
			(event.currentTarget as HTMLButtonElement).blur();
			return;
		}
		infoState = 'open';
		scheduleInfoPosition();
	}

	function handleInfoKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		const wrapper = (event.currentTarget as HTMLElement).parentElement;
		infoState = wrapper?.matches(':hover') ? 'dismissed' : 'closed';
		(event.currentTarget as HTMLButtonElement).blur();
	}

	function projectIndex(index: number, transform = projection): ProjectedPoint | null {
		if (!transform || index < 0 || index >= population.count) return null;
		return projectPointWithTransform(
			worldSource[0][index],
			worldSource[1][index],
			worldSource[2][index],
			transform
		);
	}

	function scheduleRender(
		kind: 'camera' | 'ranking' | 'selection' | 'dimensions' | 'population' = 'camera'
	): void {
		if (typeof window === 'undefined' || renderFrame !== null) return;
		renderFrame = window.requestAnimationFrame(() => {
			renderFrame = null;
			const start = performance.now();
			const canvasMark = prominenceTimingMark('canvas');
			drawScene();
			prominenceTimingMeasure('canvas', canvasMark);
			performanceRecorder.record(kind, start, performance.now());
		});
	}

	function schedulePickRebuild(): void {
		pickReady = false;
		if (pickTimer) clearTimeout(pickTimer);
		pickTimer = setTimeout(() => {
			pickTimer = null;
			// Pointer and touch gestures keep their own active registry. Wheel and keyboard
			// camera changes have no pointer-up event, so this timer is their settle boundary.
			if (!drag && !touchStart && cameraAnimation === null) {
				cameraMoving = false;
				rebuildPickGrid();
			}
		}, 90);
	}

	function setCamera(next: CameraState): void {
		if (cameraAnimation !== null) {
			cancelAnimationFrame(cameraAnimation);
			cameraAnimation = null;
		}
		camera = next;
		cameraMoving = true;
		pickReady = false;
		pickGrid.cells.clear();
		onHover(null);
		schedulePickRebuild();
		scheduleRender('camera');
	}

	function ensureFallbackSample(): void {
		if (fallbackLayerPopulation !== population) {
			fallbackLayerPopulation = population;
			fallbackLayerDisplay = null;
			fallbackSampleIndices = new Int32Array(0);
			fallbackOrder = new Int32Array(0);
			fallbackLayerTransform = null;
			fallbackLayerMode = 'none';
		}
		if (fallbackSampleIndices.length > 0 || population.count === 0) return;
		// The settled layer always contains the complete population. During direct
		// manipulation this sampled texture keeps camera and lens frames bounded.
		const target = Math.min(population.count, 1600);
		fallbackSampleIndices = new Int32Array(target);
		for (let sample = 0; sample < target; sample++) {
			fallbackSampleIndices[sample] = Math.min(
				population.count - 1,
				Math.floor((sample * population.count) / target)
			);
		}
	}

	function resizeCanvas(): void {
		if (!host || !fallbackCanvas || !overlayCanvas) return;
		ensureFallbackSample();
		const rect = host.getBoundingClientRect();
		width = Math.max(1, rect.width);
		height = Math.max(1, rect.height);
		dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
		fallbackCanvas.width = Math.max(1, Math.round(width * dpr));
		fallbackCanvas.height = Math.max(1, Math.round(height * dpr));
		overlayCanvas.width = Math.max(1, Math.round(width * dpr));
		overlayCanvas.height = Math.max(1, Math.round(height * dpr));
		if (webglCanvas) {
			webglCanvas.width = Math.max(1, Math.round(width * dpr));
			webglCanvas.height = Math.max(1, Math.round(height * dpr));
		}
		projection = buildProjection(camera, { width, height, dpr, domain: display.domain });
		pickX = new Float32Array(population.count);
		pickY = new Float32Array(population.count);
		pickDepth = new Float32Array(population.count);
		pickVisible = new Uint8Array(population.count);
		fallbackOrder = new Int32Array(0);
		fallbackLayerTransform = null;
		fallbackLayerDisplay = null;
		fallbackLayerMode = 'none';
		fallbackLayerBaseCount = 0;
		pickGrid.cells.clear();
		hasProjectedPopulation = false;
		renderer?.resize(width, height, dpr);
		cameraMoving = cameraAnimation !== null;
		schedulePickRebuild();
		scheduleRender('dimensions');
	}

	function worldLine(
		ctx: CanvasRenderingContext2D,
		transform: ProjectionTransform,
		from: [number, number, number],
		to: [number, number, number],
		colour: string,
		lineWidth = 1,
		dash: number[] = []
	): void {
		const a = projectPointWithTransform(from[0], from[1], from[2], transform);
		const b = projectPointWithTransform(to[0], to[1], to[2], transform);
		ctx.save();
		ctx.strokeStyle = colour;
		ctx.lineWidth = lineWidth;
		ctx.setLineDash(dash);
		ctx.beginPath();
		ctx.moveTo(a.x, a.y);
		ctx.lineTo(b.x, b.y);
		ctx.stroke();
		ctx.restore();
	}

	function worldArrow(
		ctx: CanvasRenderingContext2D,
		transform: ProjectionTransform,
		from: [number, number, number],
		to: [number, number, number],
		colour: string,
		lineWidth = 1
	): void {
		const a = projectPointWithTransform(from[0], from[1], from[2], transform);
		const b = projectPointWithTransform(to[0], to[1], to[2], transform);
		drawArrow(ctx, a, b, colour, lineWidth);
	}

	function drawArrow(
		ctx: CanvasRenderingContext2D,
		from: { x: number; y: number },
		to: { x: number; y: number },
		colour: string,
		lineWidth: number
	): void {
		const angle = Math.atan2(to.y - from.y, to.x - from.x);
		const size = 8 + lineWidth * 2;
		ctx.save();
		ctx.strokeStyle = colour;
		ctx.fillStyle = colour;
		ctx.lineWidth = lineWidth;
		ctx.lineCap = 'round';
		ctx.beginPath();
		ctx.moveTo(from.x, from.y);
		ctx.lineTo(to.x, to.y);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(to.x, to.y);
		ctx.lineTo(to.x - size * Math.cos(angle - 0.48), to.y - size * Math.sin(angle - 0.48));
		ctx.lineTo(to.x - size * Math.cos(angle + 0.48), to.y - size * Math.sin(angle + 0.48));
		ctx.closePath();
		ctx.fill();
		ctx.restore();
	}

	function drawBackground(ctx: CanvasRenderingContext2D): void {
		const background = ctx.createRadialGradient(
			width * 0.44,
			height * 0.42,
			0,
			width * 0.48,
			height * 0.52,
			Math.max(width, height) * 0.78
		);
		background.addColorStop(0, '#142525');
		background.addColorStop(1, '#081010');
		ctx.fillStyle = background;
		ctx.fillRect(0, 0, width, height);
	}

	function drawFallbackPoint(
		ctx: CanvasRenderingContext2D,
		index: number,
		x: number,
		y: number,
		scale: number,
		baseScale = projection?.baseScale ?? scale
	): void {
		const bucket = rankBuckets[index] ?? 0;
		const selected = selectedIndex === index;
		const hovered = hoveredIndex === index;
		const perspective = Math.max(0.45, Math.min(1.8, scale / Math.max(1, baseScale)));
		const radius =
			(selected ? 5.2 : hovered ? 4.5 : bucket >= 3 ? 3.2 : bucket >= 2 ? 2.1 : 1.25) * perspective;
		if (selected || hovered || bucket >= 3) {
			ctx.beginPath();
			ctx.fillStyle = selected ? 'rgba(192,227,227,.16)' : 'rgba(224,165,47,.1)';
			ctx.arc(x, y, radius * 2.8, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.beginPath();
		ctx.fillStyle = selected
			? '#efffff'
			: hovered
				? '#f6d787'
				: bucket >= 3
					? '#f2cc63'
					: bucket >= 1
						? '#8fd9c2'
						: '#a9c4c8';
		ctx.globalAlpha =
			selected || hovered
				? 1
				: (bucket >= 3 ? 0.96 : bucket >= 2 ? 0.62 : bucket >= 1 ? 0.34 : 0.18) *
					(population.hasRecognition[index] ? 1 : 0.76);
		ctx.arc(x, y, radius, 0, Math.PI * 2);
		ctx.fill();
	}

	function drawPopulationLayer(
		ctx: CanvasRenderingContext2D,
		transform: ProjectionTransform,
		mode: 'sample' | 'settled'
	): number {
		const indices = mode === 'settled' ? fallbackOrder : fallbackSampleIndices;
		let basePointsDrawn = 0;
		// The base population has only two visual styles. Building one path per style
		// keeps the settled 11,950-point layer meaningful without paying for thousands
		// of beginPath/fill cycles.
		for (let style = 0; style < 2; style++) {
			const hasRecognition = style === 0;
			ctx.beginPath();
			ctx.fillStyle = hasRecognition ? '#a9c4c8' : '#71898d';
			ctx.globalAlpha = hasRecognition ? 0.34 : 0.2;
			for (let position = 0; position < indices.length; position++) {
				const index = indices[position];
				if (Boolean(population.hasRecognition[index]) !== hasRecognition) continue;
				let x: number;
				let y: number;
				let scale: number;
				if (mode === 'settled') {
					x = pickX[index];
					y = pickY[index];
					const depth = pickDepth[index];
					scale = transform.baseScale / (1 + depth * transform.perspectiveFactor);
				} else {
					const point = projectIndex(index, transform);
					if (!point) continue;
					x = point.x;
					y = point.y;
					scale = point.scale;
				}
				const perspective = Math.max(0.45, Math.min(1.8, scale / Math.max(1, transform.baseScale)));
				const radius = Math.max(0.7, 1.15 * perspective);
				ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
				basePointsDrawn += 1;
			}
			ctx.fill();
		}
		ctx.globalAlpha = 1;
		return basePointsDrawn;
	}

	function drawSettledPopulationRaster(
		ctx: CanvasRenderingContext2D,
		transform: ProjectionTransform
	): number {
		const pixelWidth = fallbackPopulationLayer?.width ?? Math.max(1, Math.round(width * dpr));
		const pixelHeight = fallbackPopulationLayer?.height ?? Math.max(1, Math.round(height * dpr));
		const image = ctx.createImageData(pixelWidth, pixelHeight);
		const pixels = image.data;
		let pointsDrawn = 0;
		for (let position = 0; position < fallbackOrder.length; position++) {
			const index = fallbackOrder[position];
			const depth = pickDepth[index];
			const scale = transform.baseScale / (1 + depth * transform.perspectiveFactor);
			const perspective = Math.max(0.45, Math.min(1.8, scale / Math.max(1, transform.baseScale)));
			const pixelSize = Math.max(1, Math.ceil(1.15 * perspective * dpr * 1.3));
			const left = Math.round(pickX[index] * dpr - pixelSize / 2);
			const top = Math.round(pickY[index] * dpr - pixelSize / 2);
			const red = population.hasRecognition[index] ? 169 : 113;
			const green = population.hasRecognition[index] ? 196 : 137;
			const blue = population.hasRecognition[index] ? 200 : 141;
			const alpha = population.hasRecognition[index] ? 87 : 51;
			for (let pixelY = top; pixelY < top + pixelSize; pixelY++) {
				if (pixelY < 0 || pixelY >= pixelHeight) continue;
				for (let pixelX = left; pixelX < left + pixelSize; pixelX++) {
					if (pixelX < 0 || pixelX >= pixelWidth) continue;
					const offset = (pixelY * pixelWidth + pixelX) * 4;
					pixels[offset] = red;
					pixels[offset + 1] = green;
					pixels[offset + 2] = blue;
					pixels[offset + 3] = Math.min(255, pixels[offset + 3] + alpha);
				}
			}
			pointsDrawn += 1;
		}
		ctx.putImageData(image, 0, 0);
		return pointsDrawn;
	}

	function ensureFallbackPopulationLayer(
		transform: ProjectionTransform,
		mode: 'sample' | 'settled'
	): void {
		ensureFallbackSample();
		if (!fallbackPopulationLayer) fallbackPopulationLayer = document.createElement('canvas');
		const pixelWidth = Math.max(1, Math.round(width * dpr));
		const pixelHeight = Math.max(1, Math.round(height * dpr));
		if (
			fallbackPopulationLayer.width !== pixelWidth ||
			fallbackPopulationLayer.height !== pixelHeight
		) {
			fallbackPopulationLayer.width = pixelWidth;
			fallbackPopulationLayer.height = pixelHeight;
		}
		if (
			matchesFallbackLayer(
				{
					transform: fallbackLayerTransform,
					population: fallbackLayerPopulation,
					display: fallbackLayerDisplay,
					mode: fallbackLayerMode
				},
				{ transform, population, display, mode }
			)
		)
			return;
		const layer = fallbackPopulationLayer.getContext('2d');
		if (!layer) return;
		layer.setTransform(dpr, 0, 0, dpr, 0, 0);
		layer.clearRect(0, 0, width, height);
		const basePointsDrawn =
			mode === 'settled'
				? drawSettledPopulationRaster(layer, transform)
				: drawPopulationLayer(layer, transform, mode);
		fallbackLayerTransform = transform;
		fallbackLayerPopulation = population;
		fallbackLayerDisplay = display;
		fallbackLayerMode = mode;
		fallbackLayerBaseCount = basePointsDrawn;
		fallbackLayerBuilds += 1;
		if (mode === 'settled') fallbackSettledLayerBuilds += 1;
	}

	function drawFallbackPoints(ctx: CanvasRenderingContext2D, transform: ProjectionTransform): void {
		const mode: 'sample' | 'settled' =
			cameraMoving || !lens.settled || !pickReady || !hasProjectedPopulation ? 'sample' : 'settled';
		ensureFallbackPopulationLayer(transform, mode);
		if (fallbackPopulationLayer) ctx.drawImage(fallbackPopulationLayer, 0, 0, width, height);
		let mandatoryOverlayCount = 0;

		// Keep leaders, the selected author, and hover visible even when the camera is moving.
		for (let position = 0; position < top250Indices.length; position++) {
			const index = top250Indices[position];
			const point = projectIndex(index, transform);
			if (point) {
				drawFallbackPoint(ctx, index, point.x, point.y, point.scale, transform.baseScale);
				mandatoryOverlayCount += 1;
			}
		}
		if (selectedIndex !== null) {
			const point = projectIndex(selectedIndex, transform);
			if (point) {
				drawFallbackPoint(ctx, selectedIndex, point.x, point.y, point.scale, transform.baseScale);
				mandatoryOverlayCount += 1;
			}
		}
		if (hoveredIndex !== null) {
			const point = projectIndex(hoveredIndex, transform);
			if (point) {
				drawFallbackPoint(ctx, hoveredIndex, point.x, point.y, point.scale, transform.baseScale);
				mandatoryOverlayCount += 1;
			}
		}
		ctx.globalAlpha = 1;
		fallbackPointsDrawn = fallbackLayerBaseCount;
		fallbackMode = mode;
		fallbackMandatoryCount = mandatoryOverlayCount;
		fallbackFrameId += 1;
	}

	function drawAxes(ctx: CanvasRenderingContext2D, transform: ProjectionTransform): void {
		const domain = display.domain;
		const half = domain / 2;
		for (const tick of [-domain, -half, 0, half, domain]) {
			worldLine(
				ctx,
				transform,
				[tick, -domain, 0],
				[tick, domain, 0],
				'rgba(178,209,211,.08)',
				1,
				[3, 6]
			);
			worldLine(
				ctx,
				transform,
				[-domain, tick, 0],
				[domain, tick, 0],
				'rgba(178,209,211,.08)',
				1,
				[3, 6]
			);
		}
		worldArrow(ctx, transform, [-domain, 0, 0], [domain, 0, 0], 'rgba(57,197,150,.76)', 1.5);
		worldArrow(ctx, transform, [0, -domain, 0], [0, domain, 0], 'rgba(155,140,244,.76)', 1.5);
		worldArrow(
			ctx,
			transform,
			[0, 0, -recognitionNegativeGuideExtent],
			[0, 0, domain],
			'rgba(224,165,47,.82)',
			1.5
		);
	}

	function drawVector(
		ctx: CanvasRenderingContext2D,
		transform: ProjectionTransform
	): AnnotationRect {
		const length = Math.hypot(...worldWeights);
		const normalised =
			length > 0
				? worldWeights.map((weight) => weight / length)
				: [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];
		const vectorLength = display.domain * 0.82;
		const endpoint = projectPointWithTransform(
			normalised[0] * vectorLength,
			normalised[1] * vectorLength,
			normalised[2] * vectorLength,
			transform
		);
		const origin = projectPointWithTransform(0, 0, 0, transform);
		for (let i = 0; i < 3; i++) {
			const component: [number, number, number] = [0, 0, 0];
			component[i] = normalised[i] * vectorLength;
			worldLine(ctx, transform, [0, 0, 0], component, `${featureColours[i]}99`, 2, [4, 4]);
			const point = projectPointWithTransform(component[0], component[1], component[2], transform);
			ctx.beginPath();
			ctx.fillStyle = featureColours[i];
			ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
			ctx.fill();
		}
		const glow = ctx.createRadialGradient(endpoint.x, endpoint.y, 1, endpoint.x, endpoint.y, 20);
		glow.addColorStop(0, 'rgba(239,255,255,.8)');
		glow.addColorStop(1, 'rgba(239,255,255,0)');
		ctx.fillStyle = glow;
		ctx.beginPath();
		ctx.arc(endpoint.x, endpoint.y, 20, 0, Math.PI * 2);
		ctx.fill();
		drawArrow(ctx, origin, endpoint, '#efffff', 2.2);
		// Lens identity and shares live in DOM chrome so they remain responsive and accessible.
		return {
			left: endpoint.x - 24,
			top: endpoint.y - 24,
			right: endpoint.x + 24,
			bottom: endpoint.y + 24
		};
	}

	function labelIndices(): number[] {
		const indices: number[] = [];
		const add = (index: number | null | undefined) => {
			if (index !== null && index !== undefined && index >= 0 && !indices.includes(index))
				indices.push(index);
		};
		add(selectedIndex);
		for (let i = 0; i < Math.min(topIndices.length, width < 520 ? 3 : 5); i++) add(topIndices[i]);
		return indices;
	}

	function intersects(a: AnnotationRect, b: AnnotationRect): boolean {
		return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
	}

	function chromeSafeRect(): AnnotationRect | null {
		if (!host || !chromeElement) return null;
		const hostRect = host.getBoundingClientRect();
		const chromeRect = chromeElement.getBoundingClientRect();
		return {
			left: chromeRect.left - hostRect.left - 4,
			top: chromeRect.top - hostRect.top - 4,
			right: chromeRect.right - hostRect.left + 4,
			bottom: chromeRect.bottom - hostRect.top + 4
		};
	}

	function drawAuthorLabel(
		ctx: CanvasRenderingContext2D,
		transform: ProjectionTransform,
		index: number,
		occupied: AnnotationRect[]
	): void {
		const point = projectIndex(index, transform);
		if (!point || point.x < -30 || point.x > width + 30 || point.y < -30 || point.y > height + 30)
			return;
		const selected = index === selectedIndex;
		const label = population.names[index];
		ctx.save();
		ctx.font = `${selected ? 600 : 500} ${selected ? 12 : 11}px Inter, system-ui, sans-serif`;
		const textWidth = ctx.measureText(label).width;
		const offsets = selected
			? [
					[14, -14],
					[14, 18],
					[-textWidth - 14, -14],
					[-textWidth - 14, 18]
				]
			: [
					[10, -10],
					[10, 17],
					[-textWidth - 10, -10],
					[-textWidth - 10, 17]
				];
		let chosen = offsets[0];
		let placed = false;
		for (const candidate of offsets) {
			const candidateX = Math.max(6, Math.min(width - textWidth - 6, point.x + candidate[0]));
			const candidateY = Math.max(18, Math.min(height - 46, point.y + candidate[1]));
			const rect = {
				left: candidateX - 5,
				top: candidateY - 13,
				right: candidateX + textWidth + 5,
				bottom: candidateY + 6
			};
			if (
				!occupied.some(
					(item) =>
						rect.left < item.right &&
						rect.right > item.left &&
						rect.top < item.bottom &&
						rect.bottom > item.top
				)
			) {
				chosen = candidate;
				occupied.push(rect);
				placed = true;
				break;
			}
		}
		if (!placed && !selected) {
			ctx.restore();
			return;
		}
		const labelX = Math.max(6, Math.min(width - textWidth - 6, point.x + chosen[0]));
		const labelY = Math.max(18, Math.min(height - 46, point.y + chosen[1]));
		ctx.strokeStyle = selected ? 'rgba(239,255,255,.74)' : 'rgba(207,231,232,.4)';
		ctx.lineWidth = selected ? 1.2 : 0.8;
		ctx.beginPath();
		ctx.moveTo(point.x, point.y);
		ctx.lineTo(labelX + (chosen[0] < 0 ? textWidth + 5 : -5), labelY - 4);
		ctx.stroke();
		ctx.fillStyle = selected ? 'rgba(15,29,29,.94)' : 'rgba(10,20,20,.82)';
		ctx.fillRect(labelX - 5, labelY - 13, textWidth + 10, 19);
		ctx.fillStyle = selected ? '#efffff' : '#cfe7e8';
		ctx.fillText(label, labelX, labelY);
		ctx.restore();
	}

	function drawLabelsPriority(
		ctx: CanvasRenderingContext2D,
		transform: ProjectionTransform,
		occupied: AnnotationRect[]
	): void {
		const safeChrome = chromeSafeRect();
		if (safeChrome) occupied.push(safeChrome);
		if (selectedIndex !== null) drawAuthorLabel(ctx, transform, selectedIndex, occupied);
		for (const index of labelIndices()) {
			if (index !== selectedIndex) drawAuthorLabel(ctx, transform, index, occupied);
		}
	}

	function drawOrientationLabels(
		ctx: CanvasRenderingContext2D,
		transform: ProjectionTransform,
		occupied: AnnotationRect[]
	): void {
		const origin = projectPointWithTransform(0, 0, 0, transform);
		const axes: [number, number, number][] = [
			[display.domain * 0.78, 0, 0],
			[0, display.domain * 0.78, 0],
			[0, 0, display.domain * 0.78]
		];
		ctx.save();
		ctx.font = '600 10px Inter, system-ui, sans-serif';
		const labelOccupied: AnnotationRect[] = [];
		const safeChrome = chromeSafeRect();
		if (safeChrome) labelOccupied.push(safeChrome);
		const originRect = {
			left: origin.x - 26,
			top: origin.y + 4,
			right: origin.x + 28,
			bottom: origin.y + 21
		};
		if (!labelOccupied.some((item) => intersects(originRect, item))) {
			labelOccupied.push(originRect);
			occupied.push(originRect);
			ctx.fillStyle = 'rgba(207,231,232,.52)';
			ctx.fillText('ORIGIN', origin.x - 21, origin.y + 16);
		}
		for (let i = 0; i < axes.length; i++) {
			const endpoint = projectPointWithTransform(axes[i][0], axes[i][1], axes[i][2], transform);
			const label = `${['X', 'Y', 'Z'][i]} · ${display.axisFeatures[i].label}`;
			const textWidth = ctx.measureText(label).width;
			const candidates = [
				[endpoint.x + 4, endpoint.y - 4],
				[endpoint.x - textWidth - 4, endpoint.y - 4],
				[endpoint.x + 4, endpoint.y - 20]
			];
			let fallback: { point: number[]; rect: AnnotationRect } | null = null;
			let chosen: { point: number[]; rect: AnnotationRect } | null = null;
			for (const candidate of candidates) {
				const rect = {
					left: candidate[0] - 3,
					top: candidate[1] - 11,
					right: candidate[0] + textWidth + 3,
					bottom: candidate[1] + 4
				};
				if (rect.left < 4 || rect.top < 4 || rect.right > width - 4 || rect.bottom > height - 4)
					continue;
				if (!fallback) fallback = { point: candidate, rect };
				if (labelOccupied.some((item) => intersects(rect, item))) continue;
				chosen = { point: candidate, rect };
				break;
			}
			chosen ??= fallback;
			if (chosen) {
				labelOccupied.push(chosen.rect);
				occupied.push(chosen.rect);
				ctx.fillStyle = display.axisFeatures[i].colour;
				ctx.fillText(label, chosen.point[0], chosen.point[1]);
			}
		}
		ctx.restore();
	}

	function drawOrientation(ctx: CanvasRenderingContext2D, transform: ProjectionTransform): void {
		const origin = projectPointWithTransform(0, 0, 0, transform);
		const axes: [number, number, number][] = [
			[display.domain * 0.18, 0, 0],
			[0, display.domain * 0.18, 0],
			[0, 0, display.domain * 0.18]
		];
		ctx.save();
		for (let i = 0; i < axes.length; i++) {
			const endpoint = projectPointWithTransform(axes[i][0], axes[i][1], axes[i][2], transform);
			ctx.strokeStyle = display.axisFeatures[i].colour;
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.moveTo(origin.x, origin.y);
			ctx.lineTo(endpoint.x, endpoint.y);
			ctx.stroke();
		}
		ctx.restore();
	}

	function drawScene(): void {
		if (!overlayCanvas || !fallbackCanvas || width <= 0 || height <= 0) return;
		const transform = buildProjection(camera, { width, height, dpr, domain: display.domain });
		projection = transform;
		const ctx = overlayCanvas.getContext('2d');
		const fallbackCtx = fallbackCanvas.getContext('2d');
		if (!ctx || !fallbackCtx) return;
		fallbackCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (!webglAvailable || restoringWebgl) {
			drawBackground(fallbackCtx);
			drawFallbackPoints(fallbackCtx, transform);
		} else {
			fallbackCtx.clearRect(0, 0, width, height);
			fallbackPointsDrawn = 0;
			fallbackMode = 'none';
			fallbackMandatoryCount = 0;
		}
		const leaderIndex = topIndices[0];
		const leaderPoint = leaderIndex === undefined ? null : projectIndex(leaderIndex, transform);
		pickTarget =
			leaderPoint && leaderIndex !== undefined
				? {
						index: leaderIndex,
						x: leaderPoint.x,
						y: leaderPoint.y,
						name: population.names[leaderIndex]
					}
				: null;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);
		drawAxes(ctx, transform);
		const layoutMark = prominenceTimingMark('layout');
		const occupied: AnnotationRect[] = [drawVector(ctx, transform)];
		drawOrientation(ctx, transform);
		drawOrientationLabels(ctx, transform, occupied);
		drawLabelsPriority(ctx, transform, occupied);
		prominenceTimingMeasure('layout', layoutMark);
		if (renderer) {
			const activeRenderer = renderer;
			try {
				activeRenderer.render(transform);
				if (restoringWebgl) {
					restoringWebgl = false;
					webglAvailable = true;
					webglRecovery = 'available';
					fallbackCtx.clearRect(0, 0, width, height);
				}
			} catch {
				if (renderer === activeRenderer) renderer = null;
				if (!activeRenderer.gl.isContextLost()) activeRenderer.destroy();
				restoringWebgl = false;
				webglAvailable = false;
				webglRecovery = 'failed';
				drawBackground(fallbackCtx);
				drawFallbackPoints(fallbackCtx, transform);
				scheduleRender('population');
			}
		}
	}

	function rebuildPickGrid(): void {
		if (!projection || cameraMoving || drag || touchStart) return;
		const start = performance.now();
		const pickMark = prominenceTimingMark('pick');
		const visibleIndices: number[] = [];
		const nextGrid = createPickGrid(width, height, CELL_SIZE);
		const transform = projection;
		const regard = worldSource[0];
		const reach = worldSource[1];
		const recognition = worldSource[2];
		const inverseDomain = 1 / transform.domain;
		const centreX = transform.width / 2 + transform.camera.panX;
		const centreY = transform.height / 2 + transform.camera.panY;
		const { cosAzimuth, sinAzimuth, cosElevation, sinElevation } = transform;
		const perspectiveFactor = transform.perspectiveFactor;
		const baseScale = transform.baseScale;
		for (let index = 0; index < population.count; index++) {
			const px = regard[index] * inverseDomain;
			const py = reach[index] * inverseDomain;
			const pz = recognition[index] * inverseDomain;
			const horizontal = cosAzimuth * px - sinAzimuth * py;
			const depthPlane = sinAzimuth * px + cosAzimuth * py;
			const vertical = cosElevation * pz - sinElevation * depthPlane;
			const depth = cosElevation * depthPlane + sinElevation * pz;
			const scale = baseScale / (1 + depth * perspectiveFactor);
			const pointX = centreX + horizontal * scale;
			const pointY = centreY - vertical * scale;
			pickX[index] = pointX;
			pickY[index] = pointY;
			pickDepth[index] = depth;
			const visible = pointX > -20 && pointX < width + 20 && pointY > -20 && pointY < height + 20;
			pickVisible[index] = visible ? 1 : 0;
			if (!visible) continue;
			visibleIndices.push(index);
			addPickCandidate(nextGrid, index, pointX, pointY, true);
		}
		pickGrid = nextGrid;
		fallbackOrder = Int32Array.from(visibleIndices);
		// The cached base layer batches points by style, so depth sorting is not
		// required for the fixed population texture. GPU depth and overlay order
		// still determine the emphasized points.
		pickReady = true;
		hasProjectedPopulation = true;
		cameraMoving = false;
		performanceRecorder.record('pick', start, performance.now());
		prominenceTimingMeasure('pick', pickMark);
		scheduleRender('camera');
	}

	function pick(x: number, y: number): number | null {
		if (!pickReady || cameraMoving) return null;
		return queryPickGrid(
			pickGrid,
			x,
			y,
			{ x: pickX, y: pickY, depth: pickDepth, visible: pickVisible },
			rankBuckets,
			selectedIndex
		);
	}

	function localPosition(event: PointerEvent): { x: number; y: number } {
		const rect = overlayCanvas!.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	}

	function centroid(): { x: number; y: number } {
		const values = [...activePointers.values()];
		return { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 };
	}

	function pointerDistance(): number {
		const values = [...activePointers.values()];
		return Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
	}

	function handlePointerDown(event: PointerEvent): void {
		if (!overlayCanvas) return;
		const pointerMark = prominenceTimingMark('pointer');
		const position = localPosition(event);
		activePointers.set(event.pointerId, position);
		overlayCanvas.setPointerCapture(event.pointerId);
		if (activePointers.size === 1) {
			drag = {
				pointerId: event.pointerId,
				x: position.x,
				y: position.y,
				camera: { ...camera },
				mode: event.button === 1 || event.button === 2 || event.shiftKey ? 'pan' : 'orbit',
				moved: false
			};
		}
		if (activePointers.size === 2) {
			touchStart = {
				centroid: centroid(),
				distance: pointerDistance(),
				camera: { ...camera },
				moved: false
			};
			drag = null;
			cameraMoving = true;
			pickReady = false;
			onHover(null);
		}
		prominenceTimingMeasure('pointer', pointerMark);
	}

	function handlePointerMove(event: PointerEvent): void {
		if (!overlayCanvas) return;
		const pointerMark = prominenceTimingMark('pointer');
		const position = localPosition(event);
		if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, position);
		if (touchStart && activePointers.size >= 2) {
			const centre = centroid();
			const distance = pointerDistance();
			const moved =
				Math.hypot(centre.x - touchStart.centroid.x, centre.y - touchStart.centroid.y) > 3 ||
				Math.abs(distance - touchStart.distance) > 3;
			touchStart.moved ||= moved;
			setCamera({
				...camera,
				panX: touchStart.camera.panX + centre.x - touchStart.centroid.x,
				panY: touchStart.camera.panY + centre.y - touchStart.centroid.y,
				zoom: Math.max(
					0.58,
					Math.min(2.8, (touchStart.camera.zoom * distance) / Math.max(touchStart.distance, 1))
				)
			});
			prominenceTimingMeasure('pointer', pointerMark);
			return;
		}
		if (!drag || drag.pointerId !== event.pointerId) {
			if (!activePointers.size && !cameraMoving) {
				const next = pick(position.x, position.y);
				if (next !== hoveredIndex) onHover(next);
			}
			prominenceTimingMeasure('pointer', pointerMark);
			return;
		}
		const dx = position.x - drag.x;
		const dy = position.y - drag.y;
		if (Math.hypot(dx, dy) > 3) drag.moved = true;
		if (drag.mode === 'orbit') {
			setCamera({
				...camera,
				azimuth: drag.camera.azimuth + dx * 0.008,
				elevation: Math.max(-1.25, Math.min(1.25, drag.camera.elevation + dy * 0.008))
			});
		} else {
			setCamera({ ...camera, panX: drag.camera.panX + dx, panY: drag.camera.panY + dy });
		}
		prominenceTimingMeasure('pointer', pointerMark);
	}

	function finishPointer(event: PointerEvent, cancelled: boolean): void {
		if (!overlayCanvas) return;
		const pointerMark = prominenceTimingMark('pointer');
		const position = localPosition(event);
		const wasTouch = touchStart !== null;
		const moved = drag?.moved ?? touchStart?.moved ?? false;
		if (!cancelled && !wasTouch && drag && !drag.moved && pickReady)
			onSelect(pick(position.x, position.y));
		activePointers.delete(event.pointerId);
		if (overlayCanvas.hasPointerCapture(event.pointerId))
			overlayCanvas.releasePointerCapture(event.pointerId);
		if (activePointers.size < 2) touchStart = null;
		drag = null;
		if (activePointers.size === 0) {
			cameraMoving = false;
			if (moved || cancelled) schedulePickRebuild();
		}
		if (moved || cancelled) onHover(null);
		scheduleRender('camera');
		prominenceTimingMeasure('pointer', pointerMark);
	}

	function handleWheel(event: WheelEvent): void {
		event.preventDefault();
		setCamera({
			...camera,
			zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * Math.exp(-event.deltaY * 0.001)))
		});
	}

	function animateCamera(target: CameraState): void {
		if (cameraAnimation !== null) cancelAnimationFrame(cameraAnimation);
		cameraMoving = true;
		pickReady = false;
		onHover(null);
		if (reducedMotion) {
			camera = { ...target };
			cameraMoving = false;
			schedulePickRebuild();
			scheduleRender('camera');
			return;
		}
		const start = { ...camera };
		const began = performance.now();
		const tick = (now: number) => {
			const progress = Math.min(1, (now - began) / 300);
			const eased = 1 - Math.pow(1 - progress, 3);
			camera = {
				azimuth: start.azimuth + (target.azimuth - start.azimuth) * eased,
				elevation: start.elevation + (target.elevation - start.elevation) * eased,
				zoom: start.zoom + (target.zoom - start.zoom) * eased,
				panX: start.panX + (target.panX - start.panX) * eased,
				panY: start.panY + (target.panY - start.panY) * eased
			};
			scheduleRender('camera');
			if (progress < 1) cameraAnimation = requestAnimationFrame(tick);
			else {
				cameraAnimation = null;
				cameraMoving = false;
				schedulePickRebuild();
			}
		};
		cameraAnimation = requestAnimationFrame(tick);
	}

	function resetCamera(): void {
		animateCamera({ ...DEFAULT_CAMERA });
	}

	function zoomBy(factor: number): void {
		setCamera({ ...camera, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * factor)) });
	}

	function handleKeydown(event: KeyboardEvent): void {
		let handled = true;
		if (event.key === 'Escape') {
			event.stopPropagation();
			onEscape();
		} else if (event.key === '0') resetCamera();
		else if (event.key === '+' || event.key === '=') zoomBy(1.12);
		else if (event.key === '-') zoomBy(1 / 1.12);
		else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			if (event.shiftKey)
				setCamera({ ...camera, panX: camera.panX + (event.key === 'ArrowLeft' ? -14 : 14) });
			else
				setCamera({
					...camera,
					azimuth: camera.azimuth + (event.key === 'ArrowLeft' ? -0.06 : 0.06)
				});
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			if (event.shiftKey)
				setCamera({ ...camera, panY: camera.panY + (event.key === 'ArrowUp' ? -14 : 14) });
			else
				setCamera({
					...camera,
					elevation: Math.max(
						-1.25,
						Math.min(1.25, camera.elevation + (event.key === 'ArrowUp' ? -0.06 : 0.06))
					)
				});
		} else handled = false;
		if (handled) event.preventDefault();
	}

	function syncRendererOverlays(): void {
		if (!renderer) return;
		renderer.updateRankingOverlays(top250Indices, topIndices, worldSource);
		renderer.updateSelection(selectedIndex, worldSource);
	}

	onMount(() => {
		const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		reducedMotion = motionQuery.matches;
		const onMotionChange = () => (reducedMotion = motionQuery.matches);
		motionQuery.addEventListener?.('change', onMotionChange);
		const onContextLost = (event: Event) => {
			event.preventDefault();
			// The context has already invalidated these resources. Calling delete* on a
			// lost context can interfere with browser restoration, so defer disposal.
			renderer = null;
			restoringWebgl = false;
			webglAvailable = false;
			webglRecovery = 'lost';
			// Projection and point positions are renderer-independent. Keep a settled
			// grid usable immediately after loss; rebuild only if it was already invalid.
			if (!pickReady) schedulePickRebuild();
			scheduleRender('population');
		};
		const onContextRestored = () => {
			if (!webglCanvas) return;
			try {
				renderer?.destroy();
				renderer = new WebGLPointRenderer(webglCanvas, worldSource);
				restoringWebgl = true;
				webglAvailable = false;
				webglRecovery = 'restoring';
				renderer.resize(width, height, dpr);
				syncRendererOverlays();
				if (!pickReady) schedulePickRebuild();
				scheduleRender('population');
			} catch {
				renderer = null;
				restoringWebgl = false;
				webglAvailable = false;
				webglRecovery = 'failed';
				scheduleRender('population');
			}
		};
		if (webglCanvas) {
			try {
				renderer = new WebGLPointRenderer(webglCanvas, worldSource);
				webglAvailable = true;
				webglRecovery = 'available';
				webglCanvas.addEventListener('webglcontextlost', onContextLost);
				webglCanvas.addEventListener('webglcontextrestored', onContextRestored);
			} catch {
				renderer = null;
				restoringWebgl = false;
				webglAvailable = false;
				webglRecovery = 'failed';
			}
		}
		if (host) {
			resizeObserver = new ResizeObserver(resizeCanvas);
			resizeObserver.observe(host);
		}
		resizeCanvas();
		syncRendererOverlays();
		return () => {
			if (renderFrame !== null) cancelAnimationFrame(renderFrame);
			if (cameraAnimation !== null) cancelAnimationFrame(cameraAnimation);
			if (pickTimer) clearTimeout(pickTimer);
			resizeObserver?.disconnect();
			webglCanvas?.removeEventListener('webglcontextlost', onContextLost);
			webglCanvas?.removeEventListener('webglcontextrestored', onContextRestored);
			renderer?.destroy();
			motionQuery.removeEventListener?.('change', onMotionChange);
		};
	});

	onMount(() => {
		const reposition = () => {
			if (infoVisible) scheduleInfoPosition();
		};
		window.addEventListener('resize', reposition);
		window.addEventListener('scroll', reposition, true);
		return () => {
			window.removeEventListener('resize', reposition);
			window.removeEventListener('scroll', reposition, true);
		};
	});

	$effect(() => {
		void top250Indices;
		void topIndices;
		if (renderer) renderer.updateRankingOverlays(top250Indices, topIndices, worldSource);
		scheduleRender('ranking');
	});
	$effect(() => {
		void selectedIndex;
		if (renderer) renderer.updateSelection(selectedIndex, worldSource);
		scheduleRender('selection');
	});
	$effect(() => {
		void hoveredIndex;
		void hoverPoint;
		scheduleRender('selection');
	});
	$effect(() => {
		void population;
		if (fallbackLayerPopulation && fallbackLayerPopulation !== population) {
			fallbackLayerPopulation = null;
			fallbackLayerDisplay = null;
			fallbackLayerTransform = null;
			fallbackLayerMode = 'none';
			fallbackLayerBaseCount = 0;
			fallbackSampleIndices = new Int32Array(0);
			fallbackOrder = new Int32Array(0);
			pickReady = false;
			hasProjectedPopulation = false;
			schedulePickRebuild();
			scheduleRender('population');
		}
	});
	$effect(() => {
		void lens;
		void rankingUpdating;
		scheduleRender('camera');
	});
</script>

<div
	bind:this={host}
	class="prominence-field"
	role="region"
	aria-labelledby="prominence-field-heading"
	aria-describedby="prominence-field-description"
	data-camera-moving={cameraMoving}
	data-pick-ready={pickReady}
	data-webgl-available={webglAvailable}
	data-webgl-recovery={webglRecovery}
	data-fallback-active={!webglAvailable || restoringWebgl}
	data-fallback-points={fallbackPointsDrawn}
	data-fallback-mode={fallbackMode}
	data-fallback-layer-mode={fallbackLayerMode}
	data-fallback-layer-builds={fallbackLayerBuilds}
	data-fallback-settled-builds={fallbackSettledLayerBuilds}
	data-fallback-mandatory={fallbackMandatoryCount}
	data-fallback-frame={fallbackFrameId}
	data-pick-target-index={pickTarget?.index}
	data-pick-target-x={pickTarget?.x}
	data-pick-target-y={pickTarget?.y}
	data-pick-target-name={pickTarget?.name}
	data-ranking-updating={rankingUpdating}
	data-ranking-progress-visible={rankingProgressVisible}
	data-testid="prominence-field"
>
	<h2 id="prominence-field-heading" class="prominence-field__heading">Author prominence field</h2>
	<canvas bind:this={fallbackCanvas} class="prominence-field__fallback" aria-hidden="true"></canvas>
	<canvas bind:this={webglCanvas} class="prominence-field__webgl" aria-hidden="true"></canvas>
	<canvas
		bind:this={overlayCanvas}
		class="prominence-field__overlay"
		tabindex="0"
		aria-roledescription="interactive 3D field"
		aria-label="Author field. Primary drag orbits, Shift-drag pans, the wheel and plus or minus buttons zoom, and Escape clears selection."
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={(event) => finishPointer(event, false)}
		onpointercancel={(event) => finishPointer(event, true)}
		onpointerleave={() => {
			if (!drag && !touchStart) onHover(null);
		}}
		onwheel={handleWheel}
		oncontextmenu={(event) => event.preventDefault()}
		onkeydown={handleKeydown}
	></canvas>
	<div bind:this={chromeElement} class="prominence-field__chrome">
		<div class="prominence-field__zone prominence-field__legend">
			<span><i class="dot dot--top250"></i>top 250</span>
			<span><i class="dot dot--top"></i>top {display.topN}</span>
		</div>
		{#if rankingProgressVisible}<div
				class="prominence-field__zone prominence-field__status"
				role="status"
			>
				updating ranking
			</div>{/if}
		<div class="prominence-field__zone prominence-field__actions">
			<button
				type="button"
				class="btn btn--secondary btn--compact"
				disabled={!canZoomIn}
				onclick={() => zoomBy(1.5)}
				aria-label="Zoom in">+</button
			>
			<button
				type="button"
				class="btn btn--secondary btn--compact"
				disabled={!canZoomOut}
				onclick={() => zoomBy(1 / 1.5)}
				aria-label="Zoom out">−</button
			>
			<button type="button" class="btn btn--tertiary btn--compact" onclick={resetCamera}>
				Reset view
			</button>
			<span
				class="prominence-field__info-wrap"
				role="presentation"
				onpointerenter={handleInfoPointerEnter}
				onpointerleave={handleInfoPointerLeave}
			>
				<button
					type="button"
					class="prominence-field__info"
					id="prominence-field-info-trigger"
					aria-label={t('lab.authorProminence.about.heading')}
					aria-expanded={infoVisible}
					aria-controls="prominence-field-info"
					aria-describedby="prominence-field-info"
					onclick={toggleInfo}
					onfocus={handleInfoFocus}
					onblur={handleInfoBlur}
					onkeydown={handleInfoKeydown}>i</button
				>
				<div
					id="prominence-field-info"
					class="prominence-field__info-popover"
					class:prominence-field__info-popover--visible={infoVisible}
					style:left={`${infoPosition.left}px`}
					style:top={`${infoPosition.top}px`}
					style:width={`${infoPosition.width}px`}
					role="tooltip"
					aria-hidden={!infoVisible}
				>
					<strong>{t('lab.authorProminence.about.heading')}</strong>
					<p><strong>Axes:</strong> {t('lab.authorProminence.about.axes')}</p>
					<p><strong>Lens:</strong> {t('lab.authorProminence.about.lens')}</p>
				</div>
			</span>
		</div>
	</div>
	{#if hoveredIndex !== null && hoveredIndex !== selectedIndex && hoverPoint}
		<div
			class="prominence-field__hover"
			style:left={`${hoverPoint.x + 12}px`}
			style:top={`${hoverPoint.y + 12}px`}
		>
			<strong>{population.names[hoveredIndex]}</strong>
			<span>#{rankByIndex[hoveredIndex] || '-'}</span>
		</div>
	{/if}
	<ScreenReaderOnly id="prominence-field-description">
		Every point is an eligible author. {display.axisFeatures[0].label} is the X axis, {display
			.axisFeatures[1].label}
		is the Y axis, and {display.axisFeatures[2].label} is the Z axis. Positive values are above the average
		eligible author and negative values are below it. The current prominence vector starts at the average
		origin. The ranking and inspector provide the complete text equivalent. Use the field controls to
		orbit, pan, zoom, reset, or view along the current lens.
	</ScreenReaderOnly>
</div>

<style>
	.prominence-field {
		position: relative;
		min-height: 300px;
		height: 100%;
		overflow: hidden;
		border: 1px solid rgba(164, 204, 206, 0.18);
		border-radius: 14px;
		background: #081010;
		isolation: isolate;
	}
	.prominence-field__heading {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
	.prominence-field__fallback,
	.prominence-field__webgl,
	.prominence-field__overlay {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
	}
	.prominence-field__fallback,
	.prominence-field__webgl {
		z-index: 0;
	}
	.prominence-field__fallback {
		z-index: 1;
	}
	.prominence-field__overlay {
		z-index: 2;
		outline: none;
		touch-action: none;
		cursor: grab;
	}
	.prominence-field__overlay:active {
		cursor: grabbing;
	}
	.prominence-field__chrome {
		position: absolute;
		z-index: 2;
		inset: 0;
		pointer-events: none;
	}
	.prominence-field__zone {
		border: 1px solid rgba(164, 204, 206, 0.15);
		border-radius: 7px;
		background: rgba(8, 16, 16, 0.72);
	}
	.prominence-field__legend {
		position: absolute;
		top: 12px;
		left: 12px;
		display: flex;
		flex-wrap: wrap;
		gap: 7px 12px;
		padding: 7px 9px;
		color: rgba(207, 231, 232, 0.65);
		font: 11px/1.2 var(--font-family-interactive);
	}
	.dot {
		display: inline-block;
		width: 7px;
		height: 7px;
		margin-right: 5px;
		border-radius: 50%;
	}
	.dot--top250 {
		background: #8fd9c2;
	}
	.dot--top {
		background: #e0a52f;
	}
	.prominence-field__status {
		position: absolute;
		top: 12px;
		right: 12px;
		padding: 7px 9px;
		color: #f3c964;
		font: 11px/1.2 var(--font-family-interactive);
	}
	.prominence-field__actions {
		position: absolute;
		right: var(--space-3);
		bottom: var(--space-3);
		left: var(--space-3);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-card-bg);
		pointer-events: none;
	}
	.prominence-field__actions .btn {
		pointer-events: auto;
	}
	.prominence-field__info {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		padding: 0;
		background: transparent;
		color: var(--color-text-muted);
		font: inherit;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		font-style: italic;
		line-height: 1;
		cursor: pointer;
	}
	.prominence-field__info:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.prominence-field__info-wrap {
		position: relative;
		display: inline-flex;
		margin-left: auto;
		pointer-events: auto;
	}
	.prominence-field__info-popover {
		position: fixed;
		top: var(--space-3);
		left: var(--space-3);
		right: auto;
		z-index: 100;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: min(28rem, calc(100vw - 2rem));
		max-width: calc(100vw - 1rem);
		box-sizing: border-box;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-card-bg);
		box-shadow: var(--shadow-card-hover);
		color: var(--color-text-muted);
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.5;
		text-align: left;
		opacity: 0;
		visibility: hidden;
		transform: translateY(0.25rem);
		pointer-events: none;
		transition:
			opacity 140ms ease,
			transform 140ms ease,
			visibility 140ms ease;
	}
	.prominence-field__info-popover--visible {
		opacity: 1;
		visibility: visible;
		transform: none;
		pointer-events: auto;
	}
	.prominence-field__info-popover > strong {
		color: var(--color-text);
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-16);
		font-weight: 600;
		line-height: 1.25;
	}
	.prominence-field__info-popover p {
		margin: 0;
	}
	.prominence-field__info-popover p strong {
		color: var(--color-text);
	}
	.prominence-field__hover {
		position: absolute;
		z-index: 2;
		pointer-events: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-width: 16rem;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-card-bg);
		box-shadow: var(--shadow-card-hover);
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		line-height: 1.3;
	}
	.prominence-field__hover span {
		color: var(--color-text-muted);
	}
	@media (max-width: 600px) {
		.prominence-field__chrome {
			inset: 0;
		}
		.prominence-field__legend {
			top: 8px;
			left: 8px;
			max-width: 58%;
			font-size: 10px;
		}
		.prominence-field__status {
			top: 8px;
			right: 8px;
		}
		.prominence-field__actions {
			right: var(--space-2);
			bottom: var(--space-2);
			left: var(--space-2);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.prominence-field__info-popover {
			transition: none;
		}
	}
</style>
