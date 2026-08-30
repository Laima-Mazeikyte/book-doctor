<script lang="ts">
	import { onDestroy } from 'svelte';
	import ScreenReaderOnly from '$lib/components/ScreenReaderOnly.svelte';
	import {
		adjustLensForArrowAt,
		LENS_WEIGHT_TOLERANCE,
		type LensState
	} from '$lib/lab/author-prominence/lens';
	import type { GestureSource } from '$lib/lab/author-prominence/lens-controller';
	import { PUBLIC_PRESET_NAME } from '$lib/lab/author-prominence/contract';
	import type { Preset, ProminenceManifest } from '$lib/lab/author-prominence/types';

	interface Props {
		manifest: ProminenceManifest;
		lens: LensState;
		settledPreset: Preset;
		cancelToken?: number;
		onChange: (
			weights: number[],
			phase: 'start' | 'move' | 'end',
			preferredIndex?: number,
			source?: GestureSource
		) => void;
		onCancel: (source: GestureSource) => void;
		onBalanced: () => void;
	}

	let {
		manifest,
		lens,
		settledPreset,
		cancelToken = 0,
		onChange,
		onCancel,
		onBalanced
	}: Props = $props();

	const VERTICES = [
		{ x: 150, y: 20 },
		{ x: 24, y: 220 },
		{ x: 276, y: 220 }
	] as const;
	const COLOURS: Record<string, string> = {
		regard: '#39c596',
		reach: '#9b8cf4',
		recognition: '#e0a52f'
	};

	let svg: SVGSVGElement | null = $state(null);
	let dragging = $state(false);
	let draggingPointerId: number | null = $state(null);
	let moveFrame: number | null = null;
	let pendingMove: { weights: number[]; preferredIndex?: number } | null = null;
	let lastCancelToken = 0;

	const features = $derived(manifest.model.features);
	const featureIndices = $derived({
		regard: features.indexOf('regard'),
		reach: features.indexOf('reach'),
		recognition: features.indexOf('recognition')
	});
	const featureColours = $derived(features.map((feature) => COLOURS[feature] ?? '#d8eeee'));
	const isBalanced = $derived(
		lens.weights.length === settledPreset.weights.length &&
			lens.weights.every(
				(weight, index) =>
					Math.abs(weight - (settledPreset.weights[index] ?? 0)) <= LENS_WEIGHT_TOLERANCE
			)
	);
	const point = $derived.by(() => ({
		x: VERTICES.reduce((sum, vertex, index) => sum + vertex.x * (lens.weights[index] ?? 0), 0),
		y: VERTICES.reduce((sum, vertex, index) => sum + vertex.y * (lens.weights[index] ?? 0), 0)
	}));
	const accessibleName = $derived(
		`Lens control. ${features
			.map((feature, index) => `${featureLabel(feature)} ${lens.displayShares[index] ?? 0}%`)
			.join(', ')}`
	);

	function featureLabel(feature: string): string {
		return manifest.model.feature_labels[feature] ?? feature;
	}

	function triangleWeights(x: number, y: number): number[] {
		const a = VERTICES[0];
		const b = VERTICES[1];
		const c = VERTICES[2];
		const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
		const first = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator;
		const second = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator;
		const third = 1 - first - second;
		const values = [first, second, third].map((value) => Math.max(0, value));
		const total = values.reduce((sum, value) => sum + value, 0);
		if (total === 0) {
			const nearest = VERTICES.reduce(
				(best, vertex, index) =>
					Math.hypot(x - vertex.x, y - vertex.y) < best.distance
						? { index, distance: Math.hypot(x - vertex.x, y - vertex.y) }
						: best,
				{ index: 0, distance: Infinity }
			).index;
			return VERTICES.map((_, index) => (index === nearest ? 1 : 0));
		}
		return values.map((value) => value / total);
	}

	function pointFromEvent(event: PointerEvent): { x: number; y: number } | null {
		if (!svg) return null;
		const rect = svg.getBoundingClientRect();
		if (!(rect.width > 0) || !(rect.height > 0)) return null;
		return {
			x: ((event.clientX - rect.left) / rect.width) * 300,
			y: ((event.clientY - rect.top) / rect.height) * 250
		};
	}

	function cancelPendingMove(): void {
		if (moveFrame !== null) cancelAnimationFrame(moveFrame);
		moveFrame = null;
		pendingMove = null;
	}

	function scheduleMove(weights: number[], preferredIndex?: number): void {
		pendingMove = { weights: weights.slice(), preferredIndex };
		if (moveFrame !== null) return;
		moveFrame = requestAnimationFrame(() => {
			moveFrame = null;
			const next = pendingMove;
			pendingMove = null;
			if (next) onChange(next.weights, 'move', next.preferredIndex, 'triangle');
		});
	}

	function stopPointer(event: PointerEvent): void {
		event.preventDefault();
		event.stopPropagation();
	}

	function movePuck(event: PointerEvent, phase: 'start' | 'end'): void {
		const position = pointFromEvent(event);
		if (!position) return;
		const next = triangleWeights(position.x, position.y);
		onChange(next, phase, next.indexOf(Math.max(...next)), 'triangle');
	}

	function startDrag(event: PointerEvent): void {
		if (event.button !== undefined && event.button !== 0) return;
		stopPointer(event);
		if (!svg) return;
		cancelPendingMove();
		dragging = true;
		draggingPointerId = event.pointerId;
		svg.setPointerCapture(event.pointerId);
		movePuck(event, 'start');
	}

	function continueDrag(event: PointerEvent): void {
		if (!dragging || event.pointerId !== draggingPointerId) return;
		stopPointer(event);
		const position = pointFromEvent(event);
		if (!position) return;
		const next = triangleWeights(position.x, position.y);
		scheduleMove(next, next.indexOf(Math.max(...next)));
	}

	function endDrag(event: PointerEvent): void {
		if (!dragging || event.pointerId !== draggingPointerId) return;
		stopPointer(event);
		cancelPendingMove();
		movePuck(event, 'end');
		dragging = false;
		draggingPointerId = null;
		if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
	}

	function cancelDrag(event?: PointerEvent): void {
		if (!dragging) return;
		if (event) stopPointer(event);
		cancelPendingMove();
		dragging = false;
		const pointerId = draggingPointerId;
		draggingPointerId = null;
		if (event && svg?.hasPointerCapture(event.pointerId))
			svg.releasePointerCapture(event.pointerId);
		if (!event && pointerId !== null && svg?.hasPointerCapture(pointerId))
			svg.releasePointerCapture(pointerId);
		onCancel('triangle');
	}

	function sameWeights(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
		return (
			left.length === right.length &&
			Array.from(left).every(
				(value, index) => Math.abs(value - (right[index] ?? Number.NaN)) <= LENS_WEIGHT_TOLERANCE
			)
		);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			if (!dragging) return;
			event.preventDefault();
			event.stopPropagation();
			cancelDrag();
			return;
		}
		if (event.key === 'Home') {
			event.preventDefault();
			event.stopPropagation();
			if (!isBalanced) onBalanced();
			return;
		}
		const adjustment = event.shiftKey ? 5 : 1;
		const next = adjustLensForArrowAt(lens.weights, event.key, adjustment, featureIndices);
		if (!next) return;
		event.preventDefault();
		event.stopPropagation();
		if (sameWeights(next, lens.weights)) return;
		const preferredIndex =
			event.key === 'ArrowUp' || event.key === 'ArrowDown'
				? featureIndices.regard
				: event.key === 'ArrowLeft'
					? featureIndices.reach
					: featureIndices.recognition;
		if (preferredIndex < 0) return;
		onChange(next, 'start', preferredIndex, 'keyboard');
		onChange(next, 'end', preferredIndex, 'keyboard');
	}

	$effect(() => {
		const token = cancelToken;
		if (token === lastCancelToken) return;
		lastCancelToken = token;
		const pointerId = draggingPointerId;
		cancelPendingMove();
		dragging = false;
		draggingPointerId = null;
		if (pointerId !== null && svg?.hasPointerCapture(pointerId))
			svg.releasePointerCapture(pointerId);
	});

	onDestroy(cancelPendingMove);
</script>

<section
	class="prominence-lens-control"
	aria-label="Prominence lens control"
	data-testid="prominence-lens-control"
>
	<svg
		bind:this={svg}
		class="prominence-lens-control__triangle"
		viewBox="0 0 300 250"
		tabindex="0"
		role="button"
		aria-label={accessibleName}
		aria-describedby="prominence-lens-keyboard-instructions"
		onpointerdown={startDrag}
		onpointermove={continueDrag}
		onpointerup={endDrag}
		onpointercancel={cancelDrag}
		onkeydown={handleKeydown}
	>
		<defs>
			<linearGradient id="prominence-lens-surface" x1="0" y1="0" x2="1" y2="1">
				<stop offset="0" stop-color={featureColours[0]} stop-opacity="0.42" />
				<stop offset="0.5" stop-color={featureColours[1]} stop-opacity="0.36" />
				<stop offset="1" stop-color={featureColours[2]} stop-opacity="0.38" />
			</linearGradient>
			<filter id="prominence-lens-glow" x="-100%" y="-100%" width="300%" height="300%">
				<feGaussianBlur stdDeviation="5" result="blur" />
				<feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
			</filter>
		</defs>
		<polygon
			points="150,20 24,220 276,220"
			fill="url(#prominence-lens-surface)"
			stroke="rgba(207,231,232,.42)"
			stroke-width="1.2"
			pointer-events="all"
		/>
		<path
			d="M150 20 L150 220 M24 220 L213 120 M276 220 L87 120"
			stroke="rgba(207,231,232,.13)"
			stroke-width="1"
			stroke-dasharray="3 5"
			pointer-events="none"
		/>
		<text
			class="prominence-lens-control__percentage"
			x="150"
			y="57"
			text-anchor="middle"
			fill={featureColours[0]}
		>
			{lens.displayShares[0] ?? 0}%
		</text>
		<text
			class="prominence-lens-control__percentage"
			x="72"
			y="192"
			text-anchor="middle"
			fill={featureColours[1]}
		>
			{lens.displayShares[1] ?? 0}%
		</text>
		<text
			class="prominence-lens-control__percentage"
			x="228"
			y="192"
			text-anchor="middle"
			fill={featureColours[2]}
		>
			{lens.displayShares[2] ?? 0}%
		</text>
		<circle
			cx={VERTICES[0].x}
			cy={VERTICES[0].y}
			r="4"
			fill={featureColours[0]}
			pointer-events="none"
		/>
		<circle
			cx={VERTICES[1].x}
			cy={VERTICES[1].y}
			r="4"
			fill={featureColours[1]}
			pointer-events="none"
		/>
		<circle
			cx={VERTICES[2].x}
			cy={VERTICES[2].y}
			r="4"
			fill={featureColours[2]}
			pointer-events="none"
		/>
		<circle
			cx={point.x}
			cy={point.y}
			r="16"
			fill="#d8eeee"
			opacity="0.12"
			filter="url(#prominence-lens-glow)"
			pointer-events="all"
		/>
		<circle
			cx={point.x}
			cy={point.y}
			r="8"
			fill="#efffff"
			stroke="#efffff"
			stroke-width="2"
			pointer-events="all"
		/>
		<circle
			cx={point.x}
			cy={point.y}
			r="14"
			fill="none"
			stroke="rgba(239,255,255,.35)"
			stroke-width="1"
			pointer-events="all"
		/>
		<text
			class="prominence-lens-control__label"
			x="150"
			y="11"
			text-anchor="middle"
			fill={featureColours[0]}
		>
			{featureLabel(features[0] ?? '').toUpperCase()}
		</text>
		<text
			class="prominence-lens-control__label"
			x="21"
			y="241"
			text-anchor="start"
			fill={featureColours[1]}
		>
			{featureLabel(features[1] ?? '').toUpperCase()}
		</text>
		<text
			class="prominence-lens-control__label"
			x="279"
			y="241"
			text-anchor="end"
			fill={featureColours[2]}
		>
			{featureLabel(features[2] ?? '').toUpperCase()}
		</text>
	</svg>
	<ScreenReaderOnly id="prominence-lens-keyboard-instructions">
		Use ArrowUp or ArrowDown to adjust reader regard. Use ArrowLeft to increase audience reach and
		ArrowRight to increase critical recognition. Hold Shift for five percentage points. Home
		restores {PUBLIC_PRESET_NAME}. Escape cancels an active triangle drag.
	</ScreenReaderOnly>
</section>

<style>
	.prominence-lens-control {
		position: relative;
		display: grid;
		gap: 4px;
		width: 100%;
		min-width: 0;
		pointer-events: none;
	}
	.prominence-lens-control__triangle {
		display: block;
		width: 100%;
		max-height: 196px;
		min-height: 146px;
		overflow: visible;
		pointer-events: none;
		touch-action: none;
		outline: none;
	}
	.prominence-lens-control__triangle polygon,
	.prominence-lens-control__triangle circle {
		pointer-events: all;
	}
	.prominence-lens-control__triangle:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 4px;
		border-radius: 4px;
	}
	.prominence-lens-control__percentage,
	.prominence-lens-control__label {
		font-family: var(--font-family-interactive);
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
	}
	.prominence-lens-control__percentage {
		font-size: 15px;
	}
	.prominence-lens-control__label {
		font-size: 11px;
		letter-spacing: 0.02em;
	}
	@media (max-width: 430px) {
		.prominence-lens-control__triangle {
			max-height: 222px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.prominence-lens-control__triangle {
			transition: none;
		}
	}
</style>
