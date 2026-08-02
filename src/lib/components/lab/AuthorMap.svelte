<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { t } from '$lib/copy';
	import { prefersReducedMotion } from '$lib/navigation/mainNavTransition';
	import { authorColor, type AuthorIndex } from '$lib/lab/author-taste/authors';
	import type {
		PersonalAuthorRating,
		PersonalRatingCategory
	} from '$lib/lab/author-taste/personal';
	import { isMapped, type Author, type Connection } from '$lib/lab/author-taste/types';
	import {
		clampPitch,
		clampZoom,
		fitPoints,
		homeState,
		interpolate,
		projector,
		type Point3D,
		type OrbitState,
		type Projected
	} from '$lib/lab/orbit';

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
		 * Subcommunities are deliberately *not* given their own permanent colour. There are 34
		 * of them against 9 communities, well past what a categorical palette can carry, and the
		 * two channels that could express a subordinate level are already spoken for: alpha
		 * carries depth and radius is reserved for a perspective cue. Measured on this release
		 * they are not reliably separated in space either — silhouette runs from 0.56 down to 0.10,
		 * and in communities 1, 5 and 6 the gap between subgroup centroids is smaller than the
		 * subgroups' own radii, so they sit inside one another. Focus-and-context is the only
		 * encoding that stays honest for the interleaved cases as well as the tidy ones.
		 */
		emphasis?: { communityId: number; subcommunityId: number | null } | null;
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

	const FLIGHT_MS = 750;
	const PICK_RADIUS = 12;
	/*
	 * Three tiers, so a selected subgroup can be seen *within* its community rather than
	 * floating in an undifferentiated grey field. The parent keeps its community colour at
	 * roughly half strength; the subgroup is floored above the parent's brightest possible
	 * value, so a far-away selected point can never read as dimmer than a near parent one.
	 */
	const TIER_CONTEXT = 0;
	const TIER_PARENT = 1;
	const TIER_FOCUS = 2;

	/** How far unemphasised points recede. Low enough to read as ground, not as data. */
	const CONTEXT_ALPHA = 0.2;
	const PARENT_ALPHA = 0.5;
	/** Above `PARENT_ALPHA × the brightest depth`, so the tiers never cross. */
	const FOCUS_MIN_ALPHA = 0.55;
	/** Keep unrated authors visible as context when the personal layer is active. */
	const PERSONAL_CONTEXT_ALPHA = 0.2;

	let viewportEl: HTMLDivElement | null = $state(null);
	let canvasEl: HTMLCanvasElement | null = $state(null);
	let width = $state(0);
	let height = $state(0);

	let camera = $state<OrbitState>(homeState([]));
	let dragging = $state(false);
	let hovered = $state<Author | null>(null);
	let ready = $state(false);

	/**
	 * Flat arrays over `index.mapped`. Iterating typed arrays rather than 7,911 objects keeps
	 * a full reprojection inside a frame budget during an orbit.
	 */
	let worldX = new Float32Array(0);
	let worldY = new Float32Array(0);
	let worldZ = new Float32Array(0);
	let pointColor: string[] = [];
	let screenX = new Float32Array(0);
	let screenY = new Float32Array(0);
	let screenDepth = new Float32Array(0);
	let screenSize = new Float32Array(0);
	let drawOrder: number[] = [];
	/** authorId → slot in the mapped arrays, or -1 when the author has no coordinates. */
	let slotById = new Int32Array(0);

	let flight: number | null = null;
	let drag: {
		x: number;
		y: number;
		startX: number;
		startY: number;
		yaw: number;
		pitch: number;
		panX: number;
		panY: number;
		panning: boolean;
	} | null = null;

	let colors = {
		focus: '#f0c674',
		loved: '#6fcf97',
		hated: '#d96b5f',
		neutral: '#9aa5a5',
		label: '#101010',
		labelHalo: '#fafafa',
		context: '#455454'
	};

	const viewport = $derived({ width, height });
	const home = $derived(homeState(index.mapped));

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
			flags[i] = inSubgroup ? TIER_FOCUS : TIER_PARENT;
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

	/** Connections whose partner is positioned, so a spoke can actually be drawn. */
	const drawableConnections = $derived(
		connections.filter((connection) => active.has(connection.other.id))
	);

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
			focus: read('--color-viz-map-focus', colors.focus),
			loved: read('--color-viz-affinity', colors.loved),
			hated: read('--color-viz-conflict', colors.hated),
			neutral: read('--color-viz-neutral', colors.neutral),
			label: read('--color-viz-map-label', colors.label),
			labelHalo: read('--color-viz-map-label-halo', colors.labelHalo),
			context: read('--color-viz-map-point-dim', colors.context)
		};
	}

	function buildPointArrays(): void {
		const mapped = index.mapped;
		worldX = new Float32Array(mapped.length);
		worldY = new Float32Array(mapped.length);
		worldZ = new Float32Array(mapped.length);
		pointColor = new Array(mapped.length);
		screenX = new Float32Array(mapped.length);
		screenY = new Float32Array(mapped.length);
		screenDepth = new Float32Array(mapped.length);
		screenSize = new Float32Array(mapped.length);
		drawOrder = new Array(mapped.length);

		slotById = new Int32Array(index.authors.length).fill(-1);

		for (let i = 0; i < mapped.length; i++) {
			const author = mapped[i];
			worldX[i] = author.x as number;
			worldY[i] = author.y as number;
			worldZ[i] = author.z as number;
			pointColor[i] = authorColor(index, author);
			drawOrder[i] = i;
			slotById[author.id] = i;
		}
	}

	/**
	 * Reproject every mapped author and re-sort back-to-front.
	 *
	 * Point radius follows the perspective multiplier only. It is a depth cue, not a measure of
	 * readership or any other user-derived count.
	 */
	function reproject(): void {
		const project = projector(camera, viewport);
		const mapped = index.mapped;
		for (let i = 0; i < mapped.length; i++) {
			const projected = project({ x: worldX[i], y: worldY[i], z: worldZ[i] });
			screenX[i] = projected.x;
			screenY[i] = projected.y;
			screenDepth[i] = projected.depth;
			screenSize[i] = Math.max(1, Math.min(6, 2.5 * projected.perspective));
		}
		drawOrder.sort((a, b) => screenDepth[a] - screenDepth[b]);
	}

	function paint(): void {
		const canvas = canvasEl;
		if (!canvas || width === 0 || height === 0 || !ready) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const pixelW = Math.round(width * dpr);
		const pixelH = Math.round(height * dpr);
		if (canvas.width !== pixelW || canvas.height !== pixelH) {
			canvas.width = pixelW;
			canvas.height = pixelH;
		}

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);

		reproject();

		const flags = emphasised;

		/*
		 * One pass per tier, back to front, when a group is emphasised. A single depth-sorted
		 * pass would let unrelated points in front occlude the very group the reader just asked
		 * to see — and in the interleaved communities that is most of them. With nothing
		 * emphasised there is one pass and the depth order is untouched.
		 */
		const drawPoints = (wanted: 0 | 1 | 2 | null) => {
			for (const slot of drawOrder) {
				if (wanted !== null && flags![slot] !== wanted) continue;
				const x = screenX[slot];
				const y = screenY[slot];
				const size = screenSize[slot];
				if (x < -size || x > width + size || y < -size || y > height + size) continue;
				// Nearer points sit brighter; the range is narrow so the community colours stay
				// distinguishable at every depth.
				const depthAlpha = Math.max(0.28, Math.min(0.95, 0.58 + screenDepth[slot] * 0.12));
				const hasPersonalRating = personalRatings.has(index.mapped[slot].id);
				const personalAlpha =
					showPersonalRatings && !hasPersonalRating ? PERSONAL_CONTEXT_ALPHA : 1;

				if (wanted === TIER_CONTEXT) {
					// A single neutral, so the emphasised community owns every hue on screen; dimming
					// the colour alone still reads as "a paler version of that community".
					ctx.globalAlpha = depthAlpha * CONTEXT_ALPHA * personalAlpha;
					ctx.fillStyle = colors.context;
				} else if (wanted === TIER_PARENT) {
					// The rest of the parent community: its own colour, held back far enough to sit
					// behind the subgroup but bright enough to show where the community reaches.
					ctx.globalAlpha = depthAlpha * PARENT_ALPHA * personalAlpha;
					ctx.fillStyle = pointColor[slot];
				} else {
					ctx.globalAlpha =
						(wanted === null ? depthAlpha : Math.max(FOCUS_MIN_ALPHA, depthAlpha)) * personalAlpha;
					ctx.fillStyle = pointColor[slot];
				}

				ctx.beginPath();
				ctx.arc(x, y, size, 0, Math.PI * 2);
				ctx.fill();
			}
		};

		if (flags) {
			drawPoints(TIER_CONTEXT);
			drawPoints(TIER_PARENT);
			drawPoints(TIER_FOCUS);
		} else {
			drawPoints(null);
		}

		if (showPersonalRatings) {
			for (const slot of drawOrder) {
				const rating = personalRatings.get(index.mapped[slot].id);
				if (!rating) continue;
				const x = screenX[slot];
				const y = screenY[slot];
				const size = screenSize[slot];
				if (x < -size - 5 || x > width + size + 5 || y < -size - 5 || y > height + size + 5) {
					continue;
				}
				ctx.globalAlpha = 0.95;
				ctx.strokeStyle = personalColor(rating.category);
				ctx.setLineDash(personalDash(rating.category));
				ctx.lineWidth = Math.max(1.25, Math.min(2.5, size * 0.55));
				ctx.beginPath();
				ctx.arc(x, y, Math.max(4, size + 3), 0, Math.PI * 2);
				ctx.stroke();
			}
			ctx.setLineDash([]);
		}
		ctx.globalAlpha = 1;
	}

	function personalColor(category: PersonalRatingCategory): string {
		return colors[category];
	}

	function personalDash(category: PersonalRatingCategory): number[] {
		if (category === 'hated') return [4, 2];
		if (category === 'neutral') return [1.5, 2.5];
		return [];
	}

	function stopFlight(): void {
		if (flight !== null) {
			cancelAnimationFrame(flight);
			flight = null;
		}
	}

	/** Ease the camera to `target`, or cut straight to it under reduced motion. */
	function flyTo(target: OrbitState): void {
		stopFlight();
		const from = { ...camera };
		const to = { ...target, zoom: clampZoom(target.zoom), pitch: clampPitch(target.pitch) };

		if (prefersReducedMotion()) {
			camera = to;
			return;
		}

		const start = performance.now();
		const step = (now: number) => {
			const progress = Math.min(1, (now - start) / FLIGHT_MS);
			camera = interpolate(from, to, progress);
			if (progress < 1) {
				flight = requestAnimationFrame(step);
			} else {
				flight = null;
				// One final full-detail frame once the thinning stops.
				paint();
			}
		};
		flight = requestAnimationFrame(step);
	}

	export function resetView(): void {
		flyTo(home);
	}

	/** Frame a subset without changing the viewing angle — used by the community legend. */
	export function frameAuthors(authors: Author[]): void {
		const points = authors.filter(isMapped);
		if (points.length === 0) {
			flyTo(home);
			return;
		}
		flyTo({ ...camera, zoom: 1, panX: 0, panY: 0, ...fitPoints(points) });
	}

	/** Frame the focus author together with everything currently drawn around it. */
	export function frameNeighbourhood(): void {
		if (width === 0 || height === 0) return;
		const points: Author[] = [];
		if (focus) points.push(focus);
		for (const connection of drawableConnections) points.push(connection.other);
		for (const author of highlighted) points.push(author);
		frameAuthors(points);
	}

	function zoomBy(factor: number): void {
		flyTo({ ...camera, zoom: clampZoom(camera.zoom * factor) });
	}

	function handleWheel(event: WheelEvent): void {
		event.preventDefault();
		stopFlight();
		camera = { ...camera, zoom: clampZoom(camera.zoom * Math.exp(-event.deltaY * 0.001)) };
	}

	function handlePointerDown(event: PointerEvent): void {
		if (event.button !== 0) return;
		stopFlight();
		dragging = true;
		drag = {
			x: event.clientX,
			y: event.clientY,
			startX: event.clientX,
			startY: event.clientY,
			yaw: camera.yaw,
			pitch: camera.pitch,
			panX: camera.panX,
			panY: camera.panY,
			// Shift pans instead of orbiting, matching the reference viewer's model.
			panning: event.shiftKey
		};
		viewportEl?.setPointerCapture(event.pointerId);
	}

	/** Nearest drawn author to a viewport point, in screen space after projection. */
	function pick(px: number, py: number): Author | null {
		let best: Author | null = null;
		let bestDistance = PICK_RADIUS;
		// Front to back, so an occluding point wins ties against one behind it.
		for (let i = drawOrder.length - 1; i >= 0; i--) {
			const slot = drawOrder[i];
			const distance = Math.hypot(screenX[slot] - px, screenY[slot] - py);
			if (distance < bestDistance) {
				bestDistance = distance;
				best = index.mapped[slot];
			}
		}
		return best;
	}

	function handlePointerMove(event: PointerEvent): void {
		const rect = viewportEl?.getBoundingClientRect();
		if (!rect) return;

		if (dragging && drag) {
			const dx = event.clientX - drag.x;
			const dy = event.clientY - drag.y;
			camera = drag.panning
				? { ...camera, panX: drag.panX + dx, panY: drag.panY + dy }
				: { ...camera, yaw: drag.yaw + dx * 0.008, pitch: clampPitch(drag.pitch + dy * 0.008) };
			return;
		}

		hovered = pick(event.clientX - rect.left, event.clientY - rect.top);
	}

	function handlePointerUp(event: PointerEvent): void {
		if (!dragging) return;
		dragging = false;
		viewportEl?.releasePointerCapture(event.pointerId);
		const moved = drag && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4;
		drag = null;
		if (moved) return;
		// A click that did not orbit selects the point under it, or clears the selection when
		// it landed on empty space — otherwise there is no way back out by pointer alone.
		if (hovered) onSelectAuthor?.(hovered);
		else onClearSelection?.();
	}

	function handleKeydown(event: KeyboardEvent): void {
		const orbitStep = 0.12;
		const panStep = 40;
		switch (event.key) {
			case 'ArrowLeft':
				camera = event.shiftKey
					? { ...camera, panX: camera.panX + panStep }
					: { ...camera, yaw: camera.yaw - orbitStep };
				break;
			case 'ArrowRight':
				camera = event.shiftKey
					? { ...camera, panX: camera.panX - panStep }
					: { ...camera, yaw: camera.yaw + orbitStep };
				break;
			case 'ArrowUp':
				camera = event.shiftKey
					? { ...camera, panY: camera.panY + panStep }
					: { ...camera, pitch: clampPitch(camera.pitch - orbitStep) };
				break;
			case 'ArrowDown':
				camera = event.shiftKey
					? { ...camera, panY: camera.panY - panStep }
					: { ...camera, pitch: clampPitch(camera.pitch + orbitStep) };
				break;
			case '+':
			case '=':
				zoomBy(1.4);
				break;
			case '-':
			case '_':
				zoomBy(1 / 1.4);
				break;
			case '0':
				resetView();
				break;
			case 'Escape':
				onClearSelection?.();
				break;
			default:
				return;
		}
		event.preventDefault();
		stopFlight();
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

	function measure(): void {
		if (!viewportEl) return;
		width = viewportEl.clientWidth;
		height = viewportEl.clientHeight;
	}

	onMount(() => {
		readTokens();
		buildPointArrays();
		ready = true;

		// Measure synchronously so the first paint never waits on an async observer callback;
		// the observer then handles later layout changes.
		measure();

		const observer = new ResizeObserver(() => measure());
		if (viewportEl) observer.observe(viewportEl);
		window.addEventListener('resize', measure);

		return () => {
			observer.disconnect();
			window.removeEventListener('resize', measure);
			stopFlight();
		};
	});

	// First real measurement: sit at the home view rather than the placeholder camera.
	let framedOnce = false;
	$effect(() => {
		if (!ready || width === 0 || height === 0 || framedOnce) return;
		framedOnce = true;
		camera = home;
	});

	// Repaint whenever the camera, viewport, or drawn set changes. `dragging` is included so
	// releasing a drag triggers one final full-detail frame.
	$effect(() => {
		void camera;
		void width;
		void height;
		void ready;
		void dragging;
		void emphasised;
		void personalRatings;
		void showPersonalRatings;
		void tasteCenter;
		paint();
	});

	// Fly to whatever the page has selected.
	$effect(() => {
		const anchor = focus?.id ?? highlighted.map((a) => a.id).join(',');
		if (!ready || width === 0 || anchor === '') return;
		void connections.length;
		void tick().then(() => frameNeighbourhood());
	});
</script>

<div class="author-map">
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
		class:author-map__viewport--dragging={dragging}
		bind:this={viewportEl}
		role="application"
		aria-label={t('lab.authorConnections.browse.mapLabel')}
		aria-roledescription="orbit and zoom map"
		aria-describedby="author-map-description"
		tabindex="0"
		onwheel={handleWheel}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointerleave={() => (hovered = null)}
		onkeydown={handleKeydown}
	>
		<canvas class="author-map__canvas" bind:this={canvasEl} aria-hidden="true"></canvas>

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
				{#each drawableConnections as connection (connection.other.id)}
					{@const point = active.get(connection.other.id)!}
					{@const status = connection.record.status}
					<!--
						A one-sided verdict is drawn as an arrow pointing the way the evidence runs.
						Everything else is a plain line: reciprocal relationships have no direction to
						point, and drawing an arrowhead on an unresolved pair would assert a direction
						the data does not support.
					-->
					<line
						class="author-map__spoke {spokeClass(connection)}"
						x1={status === 3 ? point.x : origin.x}
						y1={status === 3 ? point.y : origin.y}
						x2={status === 3 ? origin.x : point.x}
						y2={status === 3 ? origin.y : point.y}
						marker-end={status === 2 || status === 3 ? 'url(#author-map-arrow-one-way)' : undefined}
					/>
				{/each}
			{/if}

			{#each drawableConnections as connection (connection.other.id)}
				{@const point = active.get(connection.other.id)!}
				{@const positive = connection.record.self.rateDifference >= 0}
				<g class="author-map__node" class:author-map__node--conflict={!positive}>
					<circle cx={point.x} cy={point.y} r={nodeRadius()} />
					<text x={point.x} y={point.y - nodeRadius() - 6}>
						{connection.other.name}
					</text>
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
						<text x={point.x} y={point.y - nodeRadius() - 8}>{author.name}</text>
					</g>
				{/if}
			{/each}

			{#if focus && active.has(focus.id)}
				{@const point = active.get(focus.id)!}
				<g class="author-map__focus">
					<circle class="author-map__focus-ring" cx={point.x} cy={point.y} r={nodeRadius() + 7} />
					<circle cx={point.x} cy={point.y} r={nodeRadius() + 1} />
					<text x={point.x} y={point.y - nodeRadius() - 10}>{focus.name}</text>
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
					<text x={tasteCenterPoint.x} y={tasteCenterPoint.y + 29}>
						{t('lab.authorConnections.browse.personal.tasteCenter')}
					</text>
				</g>
			{/if}
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
							category: t(`lab.authorConnections.browse.personal.${hoveredPersonalRating.category}`)
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

	<div class="author-map__controls">
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
			onclick={() => zoomBy(1.5)}
			aria-label={t('lab.authorConnections.browse.zoomIn')}>+</button
		>
		<button
			type="button"
			class="btn btn--secondary btn--compact"
			onclick={() => zoomBy(1 / 1.5)}
			aria-label={t('lab.authorConnections.browse.zoomOut')}>−</button
		>
		<button type="button" class="btn btn--tertiary btn--compact" onclick={resetView}>
			{t('lab.authorConnections.browse.resetView')}
		</button>
		<!--
			How to read the map matters, but not enough to spend a paragraph on above the fold.
			`title` covers pointers; the same sentence is repeated for screen readers, which
			announce `title` inconsistently.
		-->
		<span
			class="author-map__info"
			title={t('lab.authorConnections.browse.mapNote')}
			aria-hidden="true">i</span
		>
		<p class="author-map__sr-only">
			{t('lab.authorConnections.browse.mapNoteLabel')}: {t('lab.authorConnections.browse.mapNote')}
		</p>
		<p class="author-map__hint">{t('lab.authorConnections.browse.orbitHint')}</p>
	</div>

	<p id="author-map-description" class="author-map__sr-only">
		{t('lab.authorConnections.browse.mapDescription')}
	</p>
</div>

<style>
	.author-map {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.author-map__viewport {
		position: relative;
		width: 100%;
		height: clamp(320px, 56vh, 660px);
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

	.author-map__node circle {
		fill: var(--color-viz-affinity);
		stroke: var(--color-viz-map-bg);
		stroke-width: 1.5;
	}
	.author-map__node--conflict circle {
		fill: var(--color-viz-conflict);
	}
	.author-map__node text,
	.author-map__focus text,
	.author-map__selected text,
	.author-map__taste-center text {
		font-family: var(--font-family-interactive);
		font-size: 12px;
		text-anchor: middle;
		fill: var(--color-viz-map-label);
		paint-order: stroke;
		stroke: var(--color-viz-map-label-halo);
		stroke-width: 3px;
		stroke-linejoin: round;
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
		color: var(--color-text-muted);
		font-family: var(--font-family-interactive);
		font-size: var(--primitive-type-size-14);
		font-style: italic;
		line-height: 1;
		cursor: help;
	}
	.author-map__info:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
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
</style>
