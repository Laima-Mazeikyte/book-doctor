<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { draw, fade } from 'svelte/transition';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { t } from '$lib/copy';
	import ConnectionAperture from './ConnectionAperture.svelte';
	import { prefersReducedMotion } from '$lib/navigation/mainNavTransition';
	import type { AuthorIndex } from '$lib/lab/author-taste/authors';
	import type { PersonalAuthorRating } from '$lib/lab/author-taste/personal';
	import { isMapped, type Author, type Connection } from '$lib/lab/author-taste/types';
	import {
		CanvasPointRenderer,
		POINT_TIER_FOCUS,
		POINT_TIER_PARENT,
		type CanvasRendererColors
	} from '$lib/lab/canvasPointRenderer';
	import {
		fitProjectedPoints,
		homeState,
		MAX_ZOOM,
		MIN_ZOOM,
		projector,
		type ScreenPoint,
		type ScreenRect,
		type Point3D,
		type OrbitState,
		type Projected
	} from '$lib/lab/orbit';
	import {
		NavigationController,
		type NavigationPhase,
		type NavigationPointerType
	} from '$lib/lab/navigation';
	import {
		placeLabels,
		type LabelLayout,
		type LabelMeasurement,
		type LabelObstacle,
		type LabelPlacement,
		type LabelPoint,
		type LabelRect
	} from '$lib/lab/labelPlacement';

	interface Props {
		index: AuthorIndex;
		/** Centre of the current neighbourhood, if any. May be unmapped. */
		focus?: Author | null;
		/** Retained relationships around `focus`, drawn as spokes. */
		connections?: Connection[];
		/** Compare mode: the one or two authors under comparison. */
		highlighted?: Author[];
		/**
		 * Group to hold in focus while everything else recedes. A null `subcommunityId` means
		 * the whole community.
		 *
		 * Subcommunities are not given permanent colours. There are 34 of them against 9
		 * communities, well past what a categorical palette can carry, so a selected subgroup gets a
		 * transient focus hue while its parent community keeps its own colour as context. That stays
		 * legible even where subgroup centroids overlap and the map cannot separate them spatially.
		 */
		emphasis?: { communityId: number; subcommunityId: number | null } | null;
		/** Temporary table preview author id; unlike focus, this never changes the selected author. */
		previewAuthorId?: number | null;
		/** Table aperture controls; only supplied in browse mode. */
		connectionLimit?: number;
		connectionTotalCount?: number;
		/** Whether the table snapshot belongs to the current focus and has relationships. */
		connectionSnapshotReady?: boolean;
		onConnectionLimitChange?: (value: number) => void;
		/** Whether the current selection has all the points needed for its automatic camera fit. */
		framingReady?: boolean;
		/** The current user's mapped author ratings, keyed by release author id. */
		personalRatings?: ReadonlyMap<number, PersonalAuthorRating>;
		/** Whether the personal rating layer and taste center are currently visible. */
		showPersonalRatings?: boolean;
		/** Fixed-landmark estimate from the user's loved and hated mapped authors. */
		tasteCenter?: Point3D | null;
		onTogglePersonalRatings?: () => void;
		onSelectAuthor?: (author: Author) => void;
		/** Clicking empty space or pressing Escape — the way back out of a selection. */
		onClearSelection?: () => void;
	}

	let {
		index,
		focus = null,
		connections = [],
		highlighted = [],
		emphasis = null,
		previewAuthorId = null,
		connectionLimit = 10,
		connectionTotalCount = 0,
		connectionSnapshotReady = false,
		onConnectionLimitChange,
		framingReady = true,
		personalRatings = new Map(),
		showPersonalRatings = false,
		tasteCenter = null,
		onTogglePersonalRatings,
		onSelectAuthor,
		onClearSelection
	}: Props = $props();

	/*
	 * Two-layer render. The canvas backdrop carries the 7,911 positioned authors and the
	 * optional edge overlays, depth-sorted and coloured by community. The SVG foreground
	 * carries only the active subgraph — focus, its spokes, the compared pair — so it stays
	 * in the tens of elements no matter how far the reader explores.
	 *
	 * The map is not the whole catalogue. Only authors in the reciprocal taste graph have
	 * coordinates; 1,240 authors with real paired evidence are absent from it entirely, which
	 * is why nothing here treats presence on the map as a proxy for having evidence.
	 */

	/** Do not turn a singleton or extremely tight group into a near-zero-radius camera. */
	const MIN_FRAME_RADIUS_FRACTION = 0.04;
	const MAX_FRAME_ZOOM = 4;
	const FRAME_PADDING = 28;
	const MAX_LABEL_SIDE_PADDING = 360;
	const SPOKE_BLOOM_DURATION = 180;
	const REFRAME_DEBOUNCE_MS = 150;

	let viewportEl: HTMLDivElement | null = $state(null);
	let canvasEl: HTMLCanvasElement | null = $state(null);
	let width = $state(0);
	let height = $state(0);

	let camera = $state<OrbitState>(homeState([]));
	let hovered = $state<Author | null>(null);
	let ready = $state(false);
	let navigationPhase = $state<NavigationPhase>('idle');
	let lastPointerType = $state<NavigationPointerType>('mouse');
	type InfoState = 'closed' | 'hover' | 'focus' | 'open' | 'dismissed';
	let infoState = $state<InfoState>('closed');
	let renderer: CanvasPointRenderer | null = null;
	let canvasUnavailable = $state(false);
	let lastPointer: ScreenPoint | null = null;
	let legendEl: HTMLDivElement | null = $state(null);
	let controlsEl: HTMLDivElement | null = $state(null);
	let chromeEl: HTMLDivElement | null = $state(null);
	let labelMeasureEl: SVGTextElement | null = $state(null);
	let tasteCenterLabelEl: SVGTextElement | null = $state(null);
	let labelLayout = $state<LabelLayout>({ labels: [], leaders: [], hiddenIds: [] });
	let labelLayoutSignal = $state(0);
	let labelStyleVersion = $state(0);
	let labelLayoutFrame: number | null = null;
	const labelMeasurementCache = new SvelteMap<string, LabelMeasurement>();
	const labelRevealFrames = new SvelteMap<number, number>();
	let previousLabelPlacements = new SvelteMap<number, LabelPlacement>();

	let colors = $state<CanvasRendererColors & { label: string; labelHalo: string }>({
		background: '#ffffff',
		focus: '#f0c674',
		loved: '#6fcf97',
		hated: '#d96b5f',
		neutral: '#9aa5a5',
		label: '#101010',
		labelHalo: '#fafafa',
		context: '#455454'
	});

	const viewport = $derived({ width, height });
	const home = $derived(homeState(index.mapped));
	const mapIsDragging = $derived(
		navigationPhase === 'orbit-drag' ||
			navigationPhase === 'pan-drag' ||
			navigationPhase === 'two-finger-transform'
	);
	const mapIsPanning = $derived(
		navigationPhase === 'pan-drag' ||
			navigationPhase === 'horizontal-wheel-pan' ||
			navigationPhase === 'two-finger-transform'
	);
	const interactionHint = $derived(
		lastPointerType === 'touch'
			? t('lab.authorConnections.browse.touchHint')
			: t('lab.authorConnections.browse.orbitHint')
	);
	const canZoomIn = $derived(camera.zoom < MAX_ZOOM - 1e-9);
	const canZoomOut = $derived(camera.zoom > MIN_ZOOM + 1e-9);
	const navigation = new NavigationController(
		homeState([]),
		{
			onCommit: (next, kind) => {
				camera = next;
				if (kind !== 'data') hovered = null;
			},
			onRender: (next, kind, moving) => {
				const currentRenderer = renderer;
				currentRenderer?.render(next, kind, moving);
				if (currentRenderer?.isAvailable === false) canvasUnavailable = true;
			},
			onPhaseChange: (phase) => {
				navigationPhase = phase;
				if (phase !== 'idle') hovered = null;
			},
			onTap: (point, pointerType) => {
				const author = pick(point.x, point.y, pointerType === 'touch');
				if (author) onSelectAuthor?.(author);
				else onClearSelection?.();
			},
			onSettled: () => {
				renderer?.settle(navigation.currentCamera);
				void tick().then(refreshHover);
			},
			recover: (current) => recoverLostMap(current),
			reducedMotion: () => prefersReducedMotion()
		},
		{ viewport: { width: 0, height: 0 } }
	);
	const infoVisible = $derived(
		infoState === 'hover' || infoState === 'focus' || infoState === 'open'
	);

	/**
	 * Which slots are in focus, or null when nothing is emphasised.
	 *
	 * A subgroup is identified by the `(community, subcommunity)` pair — filtering on the
	 * nested id alone would light up group 0 of every community at once.
	 */
	const emphasised = $derived.by(() => {
		if (!emphasis) return null;
		const flags = new Uint8Array(index.mapped.length);
		for (let i = 0; i < index.mapped.length; i++) {
			const author = index.mapped[i];
			if (author.communityId !== emphasis.communityId) continue;
			const inSubgroup =
				emphasis.subcommunityId === null || author.subcommunityId === emphasis.subcommunityId;
			flags[i] = inSubgroup ? POINT_TIER_FOCUS : POINT_TIER_PARENT;
		}
		return flags;
	});

	/** Screen positions for the small active set, recomputed whenever the camera moves. */
	const active = $derived.by(() => {
		const found = new SvelteMap<number, Projected>();
		if (width === 0 || height === 0) return found;
		const project = projector(camera, viewport);
		const add = (author: Author | null | undefined) => {
			if (!author || !isMapped(author) || found.has(author.id)) return;
			found.set(author.id, project(author));
		};
		add(focus);
		for (const author of highlighted) add(author);
		for (const connection of connections) add(connection.other);
		return found;
	});

	type RankedConnection = { connection: Connection; rank: number };
	const rankedConnections = $derived(
		connections.map((connection, index): RankedConnection => ({ connection, rank: index + 1 }))
	);

	/** Connections whose partner is positioned, so a spoke can actually be drawn. */
	const drawableConnections = $derived(
		rankedConnections.filter((item) => active.has(item.connection.other.id))
	);
	const mappedConnectionCount = $derived(
		connections.filter((connection) => isMapped(connection.other)).length
	);
	const isolationId = $derived.by(() => {
		if (
			previewAuthorId !== null &&
			connections.some(
				(connection) => connection.other.id === previewAuthorId && isMapped(connection.other)
			)
		) {
			return previewAuthorId;
		}
		const hoveredAuthor = hovered;
		if (
			hoveredAuthor &&
			connections.some(
				(connection) => connection.other.id === hoveredAuthor.id && isMapped(connection.other)
			)
		) {
			return hoveredAuthor.id;
		}
		return null;
	});

	type LabelPointSeed = Omit<LabelPoint, 'measurement'>;
	const labelPointSeeds = $derived.by(() => {
		const seeds: LabelPointSeed[] = [];
		const seen = new SvelteSet<number>();
		const add = (
			author: Author | null | undefined,
			kind: LabelPoint['kind'],
			mandatory: boolean,
			emphasis: boolean
		) => {
			if (!author || !isMapped(author) || seen.has(author.id)) return;
			const projected = active.get(author.id);
			if (!projected) return;
			seen.add(author.id);
			seeds.push({
				id: author.id,
				text: author.name,
				x: projected.x,
				y: projected.y,
				priority: seeds.length,
				kind,
				mandatory,
				emphasis
			});
		};

		add(focus, 'focus', true, true);
		add(hovered, 'interaction', true, true);
		const previewAuthor =
			highlighted.find((author) => author.id === previewAuthorId) ??
			connections.find((connection) => connection.other.id === previewAuthorId)?.other ??
			null;
		add(previewAuthor, 'interaction', true, true);
		for (const author of highlighted) add(author, 'highlight', true, true);
		for (const item of rankedConnections) add(item.connection.other, 'connection', false, false);
		return seeds;
	});

	/**
	 * The hovered author's screen position, projected on demand.
	 *
	 * Deliberately not read out of the paint buffers: those are plain arrays rewritten during
	 * a repaint, so the tooltip would be reading last frame's numbers with no signal to
	 * re-render. One extra projection per pointer move is free.
	 */
	const hoveredPoint = $derived.by(() => {
		if (!hovered || !isMapped(hovered) || width === 0) return null;
		return projector(camera, viewport)(hovered);
	});

	const hoveredPersonalRating = $derived(
		showPersonalRatings && hovered ? (personalRatings.get(hovered.id) ?? null) : null
	);

	const tasteCenterPoint = $derived.by(() => {
		if (!showPersonalRatings || !tasteCenter || width === 0 || height === 0) return null;
		return projector(camera, viewport)(tasteCenter);
	});

	function readTokens(): void {
		if (!viewportEl) return;
		const style = getComputedStyle(viewportEl);
		const read = (name: string, fallback: string) =>
			style.getPropertyValue(name).trim() || fallback;
		colors = {
			background: read('--color-viz-map-bg', colors.background),
			focus: read('--color-viz-map-focus', colors.focus),
			loved: read('--color-viz-affinity', colors.loved),
			hated: read('--color-viz-conflict', colors.hated),
			neutral: read('--color-viz-neutral', colors.neutral),
			label: read('--color-viz-map-label', colors.label),
			labelHalo: read('--color-viz-map-label-halo', colors.labelHalo),
			context: read('--color-viz-map-point-dim', colors.context)
		};
	}

	// The point cloud, projection cache, picking grid, and canvas paint are owned by CanvasPointRenderer.

	/* Full-cloud projection, sorting, picking, and paint live in CanvasPointRenderer. */

	export function resetView(): void {
		onClearSelection?.();
		navigation.resetTo(home);
	}

	function safeFrameRect(): ScreenRect {
		const padding = 16;
		const rect: ScreenRect = {
			left: padding,
			top: padding,
			right: Math.max(padding + 1, width - padding),
			bottom: Math.max(padding + 1, height - padding)
		};
		if (!viewportEl) return rect;
		const viewportRect = viewportEl.getBoundingClientRect();
		const visible = (element: HTMLElement | null) => {
			if (!element) return null;
			const elementRect = element.getBoundingClientRect();
			if (elementRect.bottom <= viewportRect.top || elementRect.top >= viewportRect.bottom)
				return null;
			return {
				top: elementRect.top - viewportRect.top,
				bottom: elementRect.bottom - viewportRect.top
			};
		};
		const legend = visible(legendEl);
		const controls = visible(controlsEl);
		if (legend) rect.top = Math.max(rect.top, legend.bottom + padding);
		if (controls) rect.bottom = Math.min(rect.bottom, controls.top - padding);
		if (rect.bottom <= rect.top) {
			rect.top = padding;
			rect.bottom = Math.max(padding + 1, height - padding);
		}
		return rect;
	}

	type MappedAuthor = Author & Point3D;

	function uniqueMappedAuthors(authors: (Author | null | undefined)[]): MappedAuthor[] {
		const seen = new SvelteSet<number>();
		const unique: MappedAuthor[] = [];
		for (const author of authors) {
			if (!author || !isMapped(author) || seen.has(author.id)) continue;
			seen.add(author.id);
			unique.push(author as MappedAuthor);
		}
		return unique;
	}

	/** Labels are centred on their markers, so reserve a conservative half-width on each side. */
	function labelSidePadding(authors: MappedAuthor[]): number {
		const longestName = authors.reduce(
			(longest, author) => Math.max(longest, author.name.length),
			0
		);
		return Math.min(MAX_LABEL_SIDE_PADDING, Math.max(FRAME_PADDING, 20 + longestName * 5));
	}

	function activeLabeledAuthors(): MappedAuthor[] {
		const persistentConnections = rankedConnections.map((item) => item.connection.other);
		return uniqueMappedAuthors([focus, ...persistentConnections, ...highlighted]);
	}

	/** Frame a subset without changing the viewing angle — used by the community legend. */
	export function frameAuthors(authors: Author[]): void {
		const points = uniqueMappedAuthors(authors);
		const labels = activeLabeledAuthors();
		if (points.length === 0) {
			navigation.resetTo(home);
			return;
		}
		const minimumRadius =
			points.length === 1 ? home.radius : home.radius * MIN_FRAME_RADIUS_FRACTION;
		navigation.flyTo(
			fitProjectedPoints(points, navigation.currentCamera, viewport, safeFrameRect(), {
				minimumRadius,
				padding: FRAME_PADDING,
				paddingX: labelSidePadding(labels),
				maxZoom: MAX_FRAME_ZOOM
			})
		);
	}

	/** Frame the focus author together with everything currently drawn around it. */
	export function frameNeighbourhood(): void {
		if (width === 0 || height === 0) return;
		const points = activeLabeledAuthors();
		frameAuthors(points);
	}

	function zoomBy(factor: number): void {
		navigation.zoomBy(factor, false, true);
	}

	function recoverLostMap(current: OrbitState): OrbitState | null {
		return renderer?.recoverLostMap(current) ?? null;
	}

	function handleWheel(event: WheelEvent): void {
		event.preventDefault();
		const point = localPoint(event.clientX, event.clientY);
		if (!point) return;
		lastPointer = point;
		navigation.handleWheel({
			deltaX: event.deltaX,
			deltaY: event.deltaY,
			deltaMode: event.deltaMode,
			ctrlKey: event.ctrlKey,
			shiftKey: event.shiftKey,
			x: point.x,
			y: point.y,
			time: performance.now()
		});
	}

	function handlePointerDown(event: PointerEvent): void {
		observePointerType(event);
		const point = localPoint(event.clientX, event.clientY);
		if (!point) return;
		lastPointer = point;
		if (event.button === 1) event.preventDefault();
		const started = navigation.beginPointer({
			id: event.pointerId,
			x: point.x,
			y: point.y,
			pointerType: lastPointerType,
			button: event.button,
			shiftKey: event.shiftKey
		});
		if (!started) return;
		if (event.button === 0) viewportEl?.focus({ preventScroll: true });
		viewportEl?.setPointerCapture(event.pointerId);
	}

	function handleMouseDown(event: MouseEvent): void {
		if (event.button === 1) event.preventDefault();
	}

	function localPoint(clientX: number, clientY: number): ScreenPoint | null {
		const rect = viewportEl?.getBoundingClientRect();
		if (!rect) return null;
		return { x: clientX - rect.left, y: clientY - rect.top };
	}

	function pointerType(event: PointerEvent): NavigationPointerType {
		return event.pointerType === 'touch' ? 'touch' : event.pointerType === 'pen' ? 'pen' : 'mouse';
	}

	function observePointerType(event: PointerEvent): void {
		const next = pointerType(event);
		if (next !== lastPointerType) lastPointerType = next;
	}

	/** Nearest author in the cursor's local screen-space buckets. */
	function pick(px: number, py: number, touch = false): Author | null {
		const slot = renderer?.pick(px, py, touch);
		return slot === null || slot === undefined ? null : (renderer?.authorAt(slot) ?? null);
	}

	function refreshHover(): void {
		if (navigation.isMoving || !lastPointer) return;
		hovered = pick(lastPointer.x, lastPointer.y, lastPointerType === 'touch');
	}

	function handlePointerMove(event: PointerEvent): void {
		observePointerType(event);
		const point = localPoint(event.clientX, event.clientY);
		if (!point) return;
		lastPointer = point;
		navigation.movePointer({
			id: event.pointerId,
			x: point.x,
			y: point.y,
			pointerType: lastPointerType,
			button: event.button,
			shiftKey: event.shiftKey
		});
		if (navigation.isMoving) {
			hovered = null;
			return;
		}
		hovered = pick(point.x, point.y, lastPointerType === 'touch');
	}

	function handlePointerUp(event: PointerEvent): void {
		observePointerType(event);
		const point = localPoint(event.clientX, event.clientY) ?? lastPointer ?? { x: 0, y: 0 };
		lastPointer = point;
		navigation.endPointer(
			{
				id: event.pointerId,
				x: point.x,
				y: point.y,
				pointerType: lastPointerType,
				button: event.button
			},
			false
		);
		if (viewportEl?.hasPointerCapture(event.pointerId))
			viewportEl.releasePointerCapture(event.pointerId);
	}

	function handlePointerCancel(event: PointerEvent): void {
		observePointerType(event);
		navigation.cancelPointer(event.pointerId, lastPointerType);
		if (viewportEl?.hasPointerCapture(event.pointerId))
			viewportEl.releasePointerCapture(event.pointerId);
	}

	function handleContextMenu(event: MouseEvent): void {
		if (navigation.consumeContextMenuSuppression()) event.preventDefault();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			onClearSelection?.();
			return;
		}
		if (event.key === '0') {
			event.preventDefault();
			resetView();
			return;
		}
		if (!navigation.handleKey(event.key, event.shiftKey, event.repeat)) return;
		event.preventDefault();
	}

	function handleInfoPointerEnter(): void {
		if (infoState === 'closed' || infoState === 'dismissed') infoState = 'hover';
	}

	function handleInfoPointerLeave(): void {
		if (infoState === 'hover' || infoState === 'dismissed') infoState = 'closed';
	}

	function handleInfoFocus(): void {
		if (infoState !== 'open') infoState = 'focus';
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
	}

	function handleInfoKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		const wrapper = (event.currentTarget as HTMLElement).parentElement;
		infoState = wrapper?.matches(':hover') ? 'dismissed' : 'closed';
		(event.currentTarget as HTMLButtonElement).blur();
	}

	function nodeRadius(): number {
		return 7;
	}

	/**
	 * Spoke colour follows the authoritative directionality class, not the sign alone: a
	 * reliably one-sided relationship is the rarest thing in the release and must not look
	 * like an ordinary reciprocal one.
	 */
	function spokeClass(connection: Connection): string {
		switch (connection.record.status) {
			case 2:
				return 'author-map__spoke--out';
			case 3:
				return 'author-map__spoke--in';
			case 4:
				return 'author-map__spoke--opposing';
			case 1:
				return connection.record.self.rateDifference >= 0
					? 'author-map__spoke--affinity'
					: 'author-map__spoke--contrast';
			default:
				return 'author-map__spoke--unresolved';
		}
	}

	/** Draw a new spoke in, then fade the temporary emphasis so semantic styling remains. */
	function fadeBloom(node: SVGPathElement): { destroy: () => void } {
		if (prefersReducedMotion()) {
			node.classList.add('author-map__spoke-bloom--fading');
			return { destroy: () => undefined };
		}

		const timeout = window.setTimeout(() => {
			node.classList.add('author-map__spoke-bloom--fading');
		}, SPOKE_BLOOM_DURATION);
		return { destroy: () => window.clearTimeout(timeout) };
	}

	function cssPixels(value: string, fallback: number): number {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}

	function measureLabel(seed: LabelPointSeed): LabelMeasurement {
		const fallback: LabelMeasurement = {
			width: Math.max(8, seed.text.length * 7),
			height: 15,
			fontSize: 12
		};
		if (!labelMeasureEl) return fallback;

		labelMeasureEl.style.fontWeight = seed.emphasis ? '600' : '400';
		// The hidden probe must be updated imperatively so SVG measures the actual loaded font.
		// eslint-disable-next-line svelte/no-dom-manipulating
		labelMeasureEl.textContent = seed.text;
		const style = getComputedStyle(labelMeasureEl);
		const fontSize = cssPixels(style.fontSize, fallback.fontSize);
		const lineHeight = cssPixels(style.lineHeight, fontSize * 1.2);
		const key = [
			seed.text,
			style.fontFamily,
			style.fontSize,
			style.fontWeight,
			style.letterSpacing,
			style.lineHeight
		].join('|');
		const cached = labelMeasurementCache.get(key);
		if (cached) return cached;

		const measuredWidth =
			typeof labelMeasureEl.getComputedTextLength === 'function'
				? labelMeasureEl.getComputedTextLength()
				: 0;
		const measurement = {
			width: Math.max(1, measuredWidth || fallback.width),
			height: Math.max(fontSize, lineHeight),
			fontSize
		};
		labelMeasurementCache.set(key, measurement);
		return measurement;
	}

	function elementRectInViewport(element: Element | null): LabelRect | null {
		if (!element || !viewportEl) return null;
		const viewportRect = viewportEl.getBoundingClientRect();
		const elementRect = element.getBoundingClientRect();
		if (elementRect.width <= 0 || elementRect.height <= 0) return null;
		return {
			left: elementRect.left - viewportRect.left,
			top: elementRect.top - viewportRect.top,
			right: elementRect.right - viewportRect.left,
			bottom: elementRect.bottom - viewportRect.top
		};
	}

	function labelObstacles(): LabelObstacle[] {
		const obstacles: LabelObstacle[] = [];
		for (const element of [legendEl, controlsEl]) {
			const rect = elementRectInViewport(element);
			if (rect) obstacles.push({ type: 'rect', rect });
		}
		const mapRoot = viewportEl?.closest<HTMLElement>('.author-map');
		mapRoot
			?.querySelectorAll<HTMLElement>(
				'.author-map__hover, .author-map__info-popover--visible, .connection-aperture__popover'
			)
			.forEach((element) => {
				const rect = elementRectInViewport(element);
				if (rect) obstacles.push({ type: 'rect', rect });
			});
		if (tasteCenterPoint) {
			obstacles.push({
				type: 'circle',
				x: tasteCenterPoint.x,
				y: tasteCenterPoint.y,
				radius: 24
			});
		}
		const tasteLabelRect = elementRectInViewport(tasteCenterLabelEl);
		if (tasteLabelRect) obstacles.push({ type: 'rect', rect: tasteLabelRect });
		return obstacles;
	}

	function runLabelLayout(): void {
		labelLayoutFrame = null;
		if (!labelMeasureEl || width === 0 || height === 0) return;
		const points: LabelPoint[] = labelPointSeeds.map((seed) => ({
			...seed,
			measurement: measureLabel(seed)
		}));
		const activeIds = new SvelteSet(points.map((point) => point.id));
		for (const id of labelRevealFrames.keys()) {
			if (!activeIds.has(id)) labelRevealFrames.delete(id);
		}
		const probe = placeLabels({
			points,
			nodePoints: points,
			viewport: { left: 0, top: 0, right: width, bottom: height },
			obstacles: labelObstacles(),
			previous: previousLabelPlacements
		});
		const collisionFreeIds = new SvelteSet(probe.labels.map((label) => label.id));
		let delayedReveal = false;
		const eligiblePoints = points.filter((point) => {
			if (point.mandatory || previousLabelPlacements.has(point.id)) {
				labelRevealFrames.delete(point.id);
				return true;
			}
			if (!collisionFreeIds.has(point.id)) {
				labelRevealFrames.delete(point.id);
				return false;
			}
			const frames = (labelRevealFrames.get(point.id) ?? 0) + 1;
			labelRevealFrames.set(point.id, frames);
			if (frames < 2) {
				delayedReveal = true;
				return false;
			}
			return true;
		});
		const next = placeLabels({
			points: eligiblePoints,
			nodePoints: points,
			viewport: { left: 0, top: 0, right: width, bottom: height },
			obstacles: labelObstacles(),
			previous: previousLabelPlacements
		});
		const visibleIds = new SvelteSet(next.labels.map((label) => label.id));
		for (const id of previousLabelPlacements.keys()) {
			if (!activeIds.has(id) || !visibleIds.has(id)) previousLabelPlacements.delete(id);
		}
		for (const placement of next.labels) previousLabelPlacements.set(placement.id, placement);
		labelLayout = next;
		if (delayedReveal) scheduleLabelLayout();
	}

	function scheduleLabelLayout(): void {
		if (labelLayoutFrame !== null) return;
		labelLayoutFrame = requestAnimationFrame(runLabelLayout);
	}

	function measure(): void {
		if (!viewportEl) return;
		const nextWidth = viewportEl.clientWidth;
		const nextHeight = viewportEl.clientHeight;
		const dimensionsChanged = width !== nextWidth || height !== nextHeight;
		width = nextWidth;
		height = nextHeight;
		navigation.setViewport({ width: nextWidth, height: nextHeight });
		if (renderer?.resize(nextWidth, nextHeight)) navigation.requestRender('data');
		else if (dimensionsChanged) navigation.requestRender('data');
	}

	onMount(() => {
		readTokens();
		if (canvasEl) {
			renderer = new CanvasPointRenderer(canvasEl, index, colors);
			canvasUnavailable = false;
		}
		ready = true;

		// Measure synchronously so the first paint never waits on an async observer callback;
		// the observer then handles later layout changes.
		measure();

		const observer = new ResizeObserver(() => measure());
		if (viewportEl) observer.observe(viewportEl);
		window.addEventListener('resize', measure);
		const themeObserver = new MutationObserver(() => {
			readTokens();
			navigation.requestRender('data');
		});
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class', 'data-theme']
		});
		const chromeObserver = new MutationObserver(() => {
			labelLayoutSignal += 1;
		});
		if (chromeEl) {
			chromeObserver.observe(chromeEl, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ['class', 'style', 'aria-expanded']
			});
		}
		const fonts = document.fonts;
		const handleFontsDone = () => {
			labelMeasurementCache.clear();
			labelStyleVersion += 1;
		};
		fonts.addEventListener('loadingdone', handleFontsDone);
		void fonts.ready.then(handleFontsDone);

		return () => {
			observer.disconnect();
			themeObserver.disconnect();
			chromeObserver.disconnect();
			fonts.removeEventListener('loadingdone', handleFontsDone);
			window.removeEventListener('resize', measure);
			navigation.dispose();
			renderer?.dispose();
			renderer = null;
		};
	});

	// First real measurement: sit at the home view rather than the placeholder camera.
	let framedOnce = false;
	$effect(() => {
		if (!ready || width === 0 || height === 0 || framedOnce) return;
		framedOnce = true;
		navigation.replaceCamera(home);
	});

	// Labels use the latest projected points and screen-space obstacles, but never run more than
	// once per animation frame while the camera or table state is changing.
	$effect(() => {
		void labelPointSeeds;
		void labelLayoutSignal;
		void labelStyleVersion;
		void ready;
		void width;
		void height;
		if (!ready || !labelMeasureEl || width === 0 || height === 0) return;
		scheduleLabelLayout();
		return () => {
			if (labelLayoutFrame !== null) {
				cancelAnimationFrame(labelLayoutFrame);
				labelLayoutFrame = null;
			}
		};
	});

	// Visual data changes request one render on the navigation frame clock; camera renders are
	// delivered directly by NavigationController's onRender callback.
	$effect(() => {
		void ready;
		const currentRenderer = renderer;
		if (!currentRenderer || !ready) return;
		const colorsChanged = currentRenderer.setColors(colors);
		const emphasisChanged = currentRenderer.setEmphasis(
			emphasised,
			emphasis !== null && emphasis.subcommunityId !== null
		);
		const ratingsChanged = currentRenderer.setPersonalRatings(personalRatings);
		const ratingsVisibilityChanged =
			currentRenderer.setPersonalRatingsVisibility(showPersonalRatings);
		const changed = colorsChanged || emphasisChanged || ratingsChanged || ratingsVisibilityChanged;
		if (changed) navigation.requestRender('data');
	});

	// Anchor changes (focus or compare selection) frame after the DOM tick. Content changes under
	// an existing browse anchor use the short debounce so table filtering cannot pull the camera
	// around on every published row update. Compare has no content set, so its first and second
	// selections take the immediate path.
	let frameRequest = 0;
	let frameTimer: ReturnType<typeof setTimeout> | null = null;
	let lastFramedAnchorKey = '';
	let lastFramedContentKey = '';
	$effect(() => {
		const request = ++frameRequest;
		if (frameTimer !== null) {
			clearTimeout(frameTimer);
			frameTimer = null;
		}
		const focusKey = focus ? String(focus.id) : '';
		const highlightedKey = highlighted
			.map((author) => author.id)
			.filter((id, index, ids) => ids.indexOf(id) === index)
			.sort((a, b) => a - b)
			.join(',');
		const connectionSet = connections
			.map((connection) => connection.other.id)
			.filter((id, index, ids) => ids.indexOf(id) === index)
			.sort((a, b) => a - b)
			.join(',');
		const anchorKey = `${focusKey}|${highlightedKey}`;
		const contentKey = connectionSet;
		const hasAnchor = focusKey !== '' || highlightedKey !== '';
		if (!hasAnchor) {
			lastFramedAnchorKey = '';
			lastFramedContentKey = '';
			return;
		}
		if (!ready || !framingReady) return;
		const anchorChanged = anchorKey !== lastFramedAnchorKey;
		const contentChanged = contentKey !== lastFramedContentKey;
		if (!anchorChanged && !contentChanged) return;

		const frame = () => {
			frameTimer = null;
			void tick().then(() => {
				if (request !== frameRequest) return;
				frameNeighbourhood();
				lastFramedAnchorKey = anchorKey;
				lastFramedContentKey = contentKey;
			});
		};
		if (anchorChanged) void frame();
		else frameTimer = setTimeout(frame, REFRAME_DEBOUNCE_MS);

		return () => {
			if (frameTimer !== null) {
				clearTimeout(frameTimer);
				frameTimer = null;
			}
		};
	});
</script>

<div class="author-map">
	<div class="author-map__frame">
		<!--
		`role="application"` is the accurate role for a surface that implements its own keyboard
		model (arrows orbit, shift+arrows pan, +/- zoom, 0 resets), but svelte-check does not
		treat it as interactive. Everything reachable here is also reachable as buttons in the
		connection table, so no functionality is pointer-only.
	-->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="author-map__viewport"
			class:author-map__viewport--dragging={mapIsDragging}
			class:author-map__viewport--panning={mapIsPanning}
			bind:this={viewportEl}
			role="application"
			aria-label={t('lab.authorConnections.browse.mapLabel')}
			aria-roledescription="orbit and zoom map"
			aria-describedby="author-map-description"
			tabindex="0"
			onwheel={handleWheel}
			onmousedown={handleMouseDown}
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerCancel}
			onlostpointercapture={handlePointerCancel}
			onpointerleave={() => {
				lastPointer = null;
				if (!navigation.isMoving) hovered = null;
			}}
			oncontextmenu={handleContextMenu}
			onkeydown={handleKeydown}
		>
			<canvas class="author-map__canvas" bind:this={canvasEl} aria-hidden="true"></canvas>

			{#if canvasUnavailable}
				<p class="author-map__notice" role="alert">
					{t('lab.authorConnections.browse.mapUnavailable')}
				</p>
			{/if}

			<svg class="author-map__overlay" {width} {height} aria-hidden="true">
				<defs>
					<!-- Only one-way spokes carry an arrowhead, so it matches their line colour. -->
					<marker
						id="author-map-arrow-one-way"
						viewBox="0 0 8 8"
						refX="7"
						refY="4"
						markerWidth="6"
						markerHeight="6"
						orient="auto-start-reverse"
					>
						<path d="M0 0 L8 4 L0 8 z" fill="var(--color-viz-map-focus)" />
					</marker>
				</defs>

				{#if focus && active.has(focus.id)}
					{@const origin = active.get(focus.id)!}
					{#each drawableConnections as item (item.connection.other.id)}
						{@const connection = item.connection}
						{@const rank = item.rank}
						{@const point = active.get(connection.other.id)!}
						{@const status = connection.record.status}
						<!--
						A one-sided verdict is drawn as an arrow pointing the way the evidence runs.
						Everything else is a plain line: reciprocal relationships have no direction to
						point, and drawing an arrowhead on an unresolved pair would assert a direction
						the data does not support.
					-->
						<!-- The bloom always starts at the selected author, even when the semantic arrow points back. -->
						<path
							use:fadeBloom
							in:draw={{ duration: prefersReducedMotion() ? 0 : SPOKE_BLOOM_DURATION }}
							out:fade={{ duration: prefersReducedMotion() ? 0 : SPOKE_BLOOM_DURATION }}
							class="author-map__spoke-bloom {spokeClass(connection)}"
							class:author-map__spoke--preview={connection.other.id === previewAuthorId}
							class:author-map__spoke--rank-mid={rank > 10 && rank <= 30}
							class:author-map__spoke--rank-low={rank > 30}
							class:author-map__spoke--isolated={isolationId === connection.other.id}
							class:author-map__spoke--isolation-dim={isolationId !== null &&
								isolationId !== connection.other.id}
							d={`M ${origin.x} ${origin.y} L ${point.x} ${point.y}`}
							fill="none"
							aria-hidden="true"
						/>
						<line
							in:fade={{ duration: prefersReducedMotion() ? 0 : 180 }}
							out:fade={{ duration: prefersReducedMotion() ? 0 : 180 }}
							class="author-map__spoke {spokeClass(connection)}"
							class:author-map__spoke--preview={connection.other.id === previewAuthorId}
							class:author-map__spoke--rank-mid={rank > 10 && rank <= 30}
							class:author-map__spoke--rank-low={rank > 30}
							class:author-map__spoke--isolated={isolationId === connection.other.id}
							class:author-map__spoke--isolation-dim={isolationId !== null &&
								isolationId !== connection.other.id}
							x1={status === 3 ? point.x : origin.x}
							y1={status === 3 ? point.y : origin.y}
							x2={status === 3 ? origin.x : point.x}
							y2={status === 3 ? origin.y : point.y}
							marker-end={status === 2 || status === 3
								? 'url(#author-map-arrow-one-way)'
								: undefined}
						/>
					{/each}
				{/if}

				{#each drawableConnections as item (item.connection.other.id)}
					{@const connection = item.connection}
					{@const rank = item.rank}
					{@const point = active.get(connection.other.id)!}
					{@const positive = connection.record.self.rateDifference >= 0}
					<g
						in:fade={{ duration: prefersReducedMotion() ? 0 : 180 }}
						out:fade={{ duration: prefersReducedMotion() ? 0 : 180 }}
						class="author-map__node"
						class:author-map__node--conflict={!positive}
						class:author-map__node--preview={connection.other.id === previewAuthorId}
						class:author-map__node--rank-mid={rank > 10 && rank <= 30}
						class:author-map__node--rank-low={rank > 30}
						class:author-map__node--isolated={isolationId === connection.other.id}
						class:author-map__node--isolation-dim={isolationId !== null &&
							isolationId !== connection.other.id}
					>
						<circle cx={point.x} cy={point.y} r={nodeRadius()} />
					</g>
				{/each}

				{#each highlighted as author (author.id)}
					{#if active.has(author.id)}
						{@const point = active.get(author.id)!}
						<g class="author-map__selected">
							<circle
								class="author-map__selected-ring"
								cx={point.x}
								cy={point.y}
								r={nodeRadius() + 6}
							/>
							<circle cx={point.x} cy={point.y} r={nodeRadius()} />
						</g>
					{/if}
				{/each}

				{#if focus && active.has(focus.id)}
					{@const point = active.get(focus.id)!}
					<g class="author-map__focus">
						<circle class="author-map__focus-ring" cx={point.x} cy={point.y} r={nodeRadius() + 7} />
						<circle cx={point.x} cy={point.y} r={nodeRadius() + 1} />
					</g>
				{/if}

				{#if tasteCenterPoint}
					<g class="author-map__taste-center">
						<circle
							class="author-map__taste-center-halo"
							cx={tasteCenterPoint.x}
							cy={tasteCenterPoint.y}
							r="15"
						/>
						<circle
							class="author-map__taste-center-ring"
							cx={tasteCenterPoint.x}
							cy={tasteCenterPoint.y}
							r="6"
						/>
						<circle
							class="author-map__taste-center-core"
							cx={tasteCenterPoint.x}
							cy={tasteCenterPoint.y}
							r="2.5"
						/>
						<text
							bind:this={tasteCenterLabelEl}
							class="author-map__taste-center-label"
							x={tasteCenterPoint.x}
							y={tasteCenterPoint.y + 29}
						>
							{t('lab.authorConnections.browse.personal.tasteCenter')}
						</text>
					</g>
				{/if}

				<g class="author-map__label-leaders" aria-hidden="true">
					{#each labelLayout.leaders as leader (leader.key)}
						<line
							in:fade={{ duration: prefersReducedMotion() ? 0 : 140 }}
							out:fade={{ duration: prefersReducedMotion() ? 0 : 140 }}
							class="author-map__label-leader"
							x1={leader.x1}
							y1={leader.y1}
							x2={leader.x2}
							y2={leader.y2}
						/>
					{/each}
				</g>
				<g class="author-map__labels" aria-hidden="true">
					{#each labelLayout.labels as label (label.key)}
						<text
							in:fade={{ duration: prefersReducedMotion() ? 0 : 140 }}
							out:fade={{ duration: prefersReducedMotion() ? 0 : 140 }}
							class="author-map__label"
							class:author-map__label--emphasis={label.emphasis}
							class:author-map__label--focus={label.kind === 'focus'}
							x={label.x}
							y={label.y}
							text-anchor={label.anchor}
						>
							{label.text}
						</text>
					{/each}
					<text
						bind:this={labelMeasureEl}
						class="author-map__label author-map__label--measure"
						x="-1000"
						y="-1000"
						aria-hidden="true"
					>
						M
					</text>
				</g>
			</svg>

			{#if hovered && hoveredPoint}
				<div
					class="author-map__hover"
					style="left:{hoveredPoint.x + 12}px; top:{hoveredPoint.y + 12}px"
				>
					<strong>{hovered.name}</strong>
					<span>{index.communityById.get(hovered.communityId)?.label ?? hovered.genre}</span>
					{#if hoveredPersonalRating}
						<span>
							{t('lab.authorConnections.browse.personal.averageRating', {
								average: hoveredPersonalRating.average.toFixed(1),
								category: t(
									`lab.authorConnections.browse.personal.${hoveredPersonalRating.category}`
								)
							})}
						</span>
					{/if}
				</div>
			{/if}

			{#if focus && !isMapped(focus)}
				<p class="author-map__notice">
					{t('lab.authorConnections.browse.focusUnmapped', { author: focus.name })}
				</p>
			{/if}
		</div>

		<div class="author-map__chrome" bind:this={chromeEl}>
			{#if (focus && drawableConnections.length > 0) || showPersonalRatings}
				<div class="author-map__legend-stack" bind:this={legendEl}>
					<!--
		The spokes already encode the directionality class in colour and arrowhead, but nothing
		said so — the distinction is invisible without a key, which makes it worse than no
		encoding at all. Only shown when there are spokes on screen to explain.
	-->
					{#if focus && drawableConnections.length > 0}
						<ul class="author-map__legend">
							<li class="author-map__legend-item author-map__legend-item--one-way">
								{t('lab.authorConnections.browse.legend.oneWay')}
							</li>
							<li class="author-map__legend-item author-map__legend-item--both">
								{t('lab.authorConnections.browse.legend.both')}
							</li>
							<li class="author-map__legend-item author-map__legend-item--opposing">
								{t('lab.authorConnections.browse.legend.opposing')}
							</li>
							<li class="author-map__legend-item author-map__legend-item--unclear">
								{t('lab.authorConnections.browse.legend.unclear')}
							</li>
						</ul>
					{/if}

					{#if showPersonalRatings}
						<ul class="author-map__personal-legend">
							<li>
								<span
									class="author-map__personal-swatch author-map__personal-swatch--loved"
									aria-hidden="true"
								></span>
								{t('lab.authorConnections.browse.personal.loved')}
							</li>
							<li>
								<span
									class="author-map__personal-swatch author-map__personal-swatch--hated"
									aria-hidden="true"
								></span>
								{t('lab.authorConnections.browse.personal.hated')}
							</li>
							<li>
								<span
									class="author-map__personal-swatch author-map__personal-swatch--neutral"
									aria-hidden="true"
								></span>
								{t('lab.authorConnections.browse.personal.neutral')}
							</li>
							{#if tasteCenter}
								<li>
									<span class="author-map__personal-center-swatch" aria-hidden="true"></span>
									{t('lab.authorConnections.browse.personal.tasteCenter')}
								</li>
							{/if}
						</ul>
					{/if}
				</div>
			{/if}
			<div class="author-map__controls" bind:this={controlsEl}>
				{#if focus && connectionSnapshotReady && connectionTotalCount > 0 && onConnectionLimitChange}
					<ConnectionAperture
						value={connectionLimit}
						visibleCount={connections.length}
						mappedCount={mappedConnectionCount}
						onChange={onConnectionLimitChange}
					/>
				{/if}
				{#if onTogglePersonalRatings}
					<button
						type="button"
						class="btn btn--compact"
						class:btn--primary={showPersonalRatings}
						class:btn--secondary={!showPersonalRatings}
						class:btn--disabled={personalRatings.size === 0}
						aria-pressed={showPersonalRatings}
						disabled={personalRatings.size === 0}
						title={personalRatings.size === 0
							? t('lab.authorConnections.browse.personal.noMappedRatings')
							: undefined}
						onclick={onTogglePersonalRatings}
					>
						{t(
							showPersonalRatings
								? 'lab.authorConnections.browse.personal.hide'
								: 'lab.authorConnections.browse.personal.show'
						)}
					</button>
				{/if}
				<button
					type="button"
					class="btn btn--secondary btn--compact"
					disabled={!canZoomIn}
					onclick={() => zoomBy(1.5)}
					aria-label={t('lab.authorConnections.browse.zoomIn')}>+</button
				>
				<button
					type="button"
					class="btn btn--secondary btn--compact"
					disabled={!canZoomOut}
					onclick={() => zoomBy(1 / 1.5)}
					aria-label={t('lab.authorConnections.browse.zoomOut')}>−</button
				>
				<button type="button" class="btn btn--tertiary btn--compact" onclick={resetView}>
					{t('lab.authorConnections.browse.resetView')}
				</button>
				<p class="author-map__hint">{interactionHint}</p>
				<span
					class="author-map__info-wrap"
					role="presentation"
					onpointerenter={handleInfoPointerEnter}
					onpointerleave={handleInfoPointerLeave}
				>
					<button
						type="button"
						class="author-map__info"
						aria-label={t('lab.authorConnections.browse.mapNoteLabel')}
						aria-expanded={infoVisible}
						aria-controls="author-map-info"
						aria-describedby="author-map-info"
						onclick={toggleInfo}
						onfocus={handleInfoFocus}
						onblur={handleInfoBlur}
						onkeydown={handleInfoKeydown}>i</button
					>
					<div
						id="author-map-info"
						class="author-map__info-popover"
						class:author-map__info-popover--visible={infoVisible}
						role="tooltip"
						aria-hidden={!infoVisible}
					>
						<strong>{t('lab.authorConnections.about.heading')}</strong>
						<p><strong>Space:</strong> {t('lab.authorConnections.about.space')}</p>
						<p><strong>Communities:</strong> {t('lab.authorConnections.about.communities')}</p>
					</div>
				</span>
			</div>
		</div>
	</div>

	<p id="author-map-description" class="author-map__sr-only">
		{t('lab.authorConnections.browse.mapDescription')}
	</p>
</div>

<style>
	.author-map {
		min-width: 0;
	}
	.author-map__viewport {
		position: relative;
		width: 100%;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-viz-map-bg);
		overflow: hidden;
		touch-action: none;
		cursor: grab;
	}
	.author-map__viewport--dragging {
		cursor: grabbing;
	}
	.author-map__viewport--panning {
		cursor: move;
	}
	.author-map__viewport:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.author-map__canvas,
	.author-map__overlay {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
	}
	.author-map__overlay {
		pointer-events: none;
	}

	/*
	 * Spokes encode the directionality class, which is a five-way distinction rather than a
	 * sign. Solid arrows for the two one-sided verdicts, solid plain lines for reciprocal,
	 * and dashes for the pairs where no direction was established — an unresolved pair must
	 * never look like a settled one.
	 */
	.author-map__spoke {
		stroke-width: 1.6;
		opacity: 0.8;
		transition:
			opacity 180ms ease,
			stroke-width 180ms ease;
	}
	.author-map__spoke--out,
	.author-map__spoke--in {
		stroke: var(--color-viz-map-focus);
		stroke-width: 2.2;
		opacity: 1;
	}
	.author-map__spoke--affinity {
		stroke: var(--color-viz-affinity);
	}
	.author-map__spoke--contrast,
	.author-map__spoke--opposing {
		stroke: var(--color-viz-conflict);
	}
	.author-map__spoke--opposing {
		stroke-dasharray: 5 3;
	}
	.author-map__spoke--unresolved {
		stroke: var(--color-viz-unknown);
		stroke-width: 1.2;
		stroke-dasharray: 2 5;
		opacity: 0.65;
	}
	.author-map__spoke--rank-mid {
		stroke-width: 1.35;
		opacity: 0.55;
	}
	.author-map__spoke--rank-low {
		stroke-width: 1;
		opacity: 0.32;
	}
	.author-map__spoke-bloom {
		stroke-width: 3;
		opacity: 0.9;
		pointer-events: none;
		transition: opacity 180ms ease;
	}
	.author-map__spoke-bloom.author-map__spoke--out,
	.author-map__spoke-bloom.author-map__spoke--in {
		stroke-width: 3.4;
		opacity: 0.95;
	}
	.author-map__spoke-bloom.author-map__spoke--unresolved {
		stroke-width: 2.2;
		opacity: 0.7;
	}
	.author-map__spoke-bloom.author-map__spoke--rank-mid {
		stroke-width: 2.2;
		opacity: 0.6;
	}
	.author-map__spoke-bloom.author-map__spoke--rank-low {
		stroke-width: 1.8;
		opacity: 0.4;
	}

	.author-map__node circle {
		fill: var(--color-viz-affinity);
		stroke: var(--color-viz-map-bg);
		stroke-width: 1.5;
	}
	.author-map__node {
		transition: opacity 180ms ease;
	}
	.author-map__node--rank-mid {
		opacity: 0.62;
	}
	.author-map__node--rank-low {
		opacity: 0.38;
	}
	.author-map__node--conflict circle {
		fill: var(--color-viz-conflict);
	}
	.author-map__label,
	.author-map__taste-center text {
		font-family: var(--font-family-interactive);
		font-size: 12px;
		font-weight: 400;
		fill: var(--color-viz-map-label);
		paint-order: stroke;
		stroke: var(--color-viz-map-label-halo);
		stroke-width: 3px;
		stroke-linejoin: round;
	}
	.author-map__label {
		pointer-events: none;
		transition: opacity 140ms ease;
	}
	.author-map__label--emphasis {
		font-weight: 600;
	}
	.author-map__label--measure {
		visibility: hidden;
	}
	.author-map__label-leader {
		stroke: var(--color-viz-map-label);
		stroke-width: 0.75;
		opacity: 0.28;
		pointer-events: none;
	}
	.author-map__taste-center text {
		text-anchor: middle;
	}

	.author-map__focus circle {
		fill: var(--color-viz-map-focus);
		stroke: var(--color-viz-map-bg);
		stroke-width: 2;
	}
	.author-map__focus-ring,
	.author-map__selected-ring {
		fill: var(--color-viz-map-focus-ring) !important;
		stroke: none !important;
	}
	.author-map__selected circle {
		fill: var(--color-viz-map-focus);
		stroke: var(--color-viz-map-bg);
		stroke-width: 2;
	}
	.author-map__taste-center-halo {
		fill: color-mix(in srgb, var(--color-viz-map-focus) 14%, transparent);
		stroke: none;
	}
	.author-map__taste-center-ring {
		fill: none;
		stroke: var(--color-viz-map-focus);
		stroke-width: 1.5;
		stroke-dasharray: 3 3;
	}
	.author-map__taste-center-core {
		fill: var(--color-viz-map-focus);
		stroke: var(--color-viz-map-bg);
		stroke-width: 1;
	}

	.author-map__hover {
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
	.author-map__hover span {
		color: var(--color-text-muted);
	}

	.author-map__notice {
		position: absolute;
		bottom: var(--space-3);
		left: 50%;
		transform: translateX(-50%);
		max-width: min(90%, 28rem);
		margin: 0;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-pill);
		background: var(--color-overlay-scrim-soft);
		color: var(--color-text-muted);
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		text-align: center;
		pointer-events: none;
	}

	/* Each swatch is a short line in the same colour and dash as the spoke it names. */
	.author-map__legend {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		color: var(--color-text-muted);
	}
	.author-map__legend-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.author-map__legend-item::before {
		content: '';
		display: block;
		width: 1.5rem;
		border-top-width: 2px;
		border-top-style: solid;
	}
	.author-map__legend-item--one-way::before {
		border-top-color: var(--color-viz-map-focus);
	}
	.author-map__legend-item--both::before {
		border-top-color: var(--color-viz-affinity);
	}
	.author-map__legend-item--opposing::before {
		border-top-color: var(--color-viz-conflict);
		border-top-style: dashed;
	}
	.author-map__legend-item--unclear::before {
		border-top-color: var(--color-viz-unknown);
		border-top-style: dotted;
	}
	.author-map__personal-legend {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		color: var(--color-text-muted);
	}
	.author-map__personal-legend li {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
	.author-map__personal-swatch {
		display: inline-block;
		width: 0.75rem;
		height: 0.75rem;
		border: 2px solid currentColor;
		border-radius: 50%;
	}
	.author-map__personal-swatch--loved {
		color: var(--color-viz-affinity);
	}
	.author-map__personal-swatch--hated {
		color: var(--color-viz-conflict);
		border-style: dashed;
	}
	.author-map__personal-swatch--neutral {
		color: var(--color-viz-neutral);
		border-style: dotted;
	}
	.author-map__personal-center-swatch {
		display: inline-block;
		width: 0.75rem;
		height: 0.75rem;
		border: 1px dashed var(--color-viz-map-focus);
		border-radius: 50%;
		background: color-mix(in srgb, var(--color-viz-map-focus) 20%, transparent);
	}

	.author-map__controls {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex-wrap: wrap;
	}
	.author-map__info {
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
	.author-map__info:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.author-map__info-wrap {
		position: relative;
		display: inline-flex;
	}
	.author-map__info-popover {
		position: absolute;
		top: calc(100% + var(--space-2));
		right: 0;
		z-index: 4;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: min(28rem, calc(100vw - 2rem));
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
		transform: translateY(-0.25rem);
		pointer-events: none;
		transition:
			opacity 140ms ease,
			transform 140ms ease,
			visibility 140ms ease;
	}
	.author-map__info-popover--visible {
		opacity: 1;
		visibility: visible;
		transform: none;
		pointer-events: auto;
	}
	.author-map__info-popover > strong {
		color: var(--color-text);
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-16);
		font-weight: 600;
		line-height: 1.25;
	}
	.author-map__info-popover p {
		margin: 0;
	}
	.author-map__info-popover p strong {
		color: var(--color-text);
	}
	.author-map__hint {
		margin: 0;
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		color: var(--color-text-muted);
	}

	.author-map__sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}

	.author-map__frame {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.author-map__viewport {
		height: clamp(20rem, 56vh, 30rem);
	}
	.author-map__chrome {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.author-map__legend-stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.author-map__legend,
	.author-map__personal-legend {
		min-width: 0;
	}
	.author-map__spoke--preview {
		stroke: var(--color-viz-map-focus) !important;
		stroke-width: 3.2 !important;
		opacity: 1 !important;
	}
	.author-map__node--preview circle {
		stroke: var(--color-viz-map-focus);
		stroke-width: 3;
	}
	.author-map__spoke--isolation-dim {
		opacity: 0.12 !important;
	}
	.author-map__spoke--isolated {
		stroke-width: 3.2 !important;
		opacity: 1 !important;
	}
	.author-map__node--isolation-dim {
		opacity: 0.14 !important;
	}
	.author-map__node--isolated {
		opacity: 1 !important;
	}
	.author-map__spoke-bloom--fading {
		opacity: 0 !important;
	}

	@media (min-width: 48rem) and (max-width: 69.99rem) {
		.author-map__viewport {
			height: clamp(20rem, 56vh, 36rem);
		}
	}

	@container author-connections (min-width: 70rem) {
		.author-map {
			height: 100%;
		}
		.author-map__frame {
			position: relative;
			height: 100%;
			gap: 0;
			overflow: hidden;
		}
		.author-map__viewport {
			height: 100%;
		}
		.author-map__chrome {
			position: absolute;
			inset: 0;
			display: block;
			pointer-events: none;
		}
		.author-map__legend-stack {
			position: absolute;
			top: var(--space-3);
			left: var(--space-3);
			max-width: min(80%, 30rem);
			padding: var(--space-3);
			border: 1px solid var(--color-border);
			border-radius: var(--radius-sm);
			background: var(--color-card-bg);
		}
		.author-map__controls {
			position: absolute;
			right: var(--space-3);
			bottom: var(--space-3);
			left: var(--space-3);
			padding: var(--space-2) var(--space-3);
			border: 1px solid var(--color-border);
			border-radius: var(--radius-sm);
			background: var(--color-card-bg);
			pointer-events: none;
		}
		.author-map__controls .btn,
		.author-map__controls .author-map__info,
		.author-map__controls .author-map__info-wrap {
			pointer-events: auto;
		}
		.author-map__info-popover {
			top: auto;
			bottom: calc(100% + var(--space-2));
			transform: translateY(0.25rem);
		}
		.author-map__info-wrap {
			margin-left: auto;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.author-map__spoke,
		.author-map__spoke-bloom,
		.author-map__node,
		.author-map__label,
		.author-map__label-leader {
			transition: none;
		}
		.author-map__info-popover {
			transition: none;
		}
	}
</style>
