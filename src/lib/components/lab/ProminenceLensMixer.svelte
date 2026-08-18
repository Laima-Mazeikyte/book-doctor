<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { ProminenceManifest } from '$lib/lab/author-prominence/types';
	import { changeOneShare, type LensState } from '$lib/lab/author-prominence/lens';

	interface Props {
		manifest: ProminenceManifest;
		lens: LensState;
		cancelToken?: number;
		onChange: (
			weights: number[],
			phase: 'start' | 'move' | 'end',
			preferredIndex?: number,
			source?: 'triangle' | 'slider'
		) => void;
		onCancel: (source: 'triangle' | 'slider') => void;
		onPreset: (name: string, weights: number[]) => void;
	}

	let { manifest, lens, cancelToken = 0, onChange, onCancel, onPreset }: Props = $props();
	type InfoState = 'closed' | 'hover' | 'focus' | 'open' | 'dismissed';
	type InfoPosition = { left: number; top: number; width: number };
	let infoStates = $state<Record<string, InfoState>>({});
	let infoPositions = $state<Record<string, InfoPosition>>({});
	const INFO_VIEWPORT_MARGIN = 8;
	const INFO_MAX_WIDTH = 448;

	const VERTICES = [
		{ x: 150, y: 20 },
		{ x: 24, y: 220 },
		{ x: 276, y: 220 }
	];
	const COLOURS: Record<string, string> = {
		regard: '#39c596',
		reach: '#9b8cf4',
		recognition: '#e0a52f'
	};
	let dragging = $state(false);
	let draggingPointerId: number | null = null;
	let sliderGesture = $state(false);
	let sliderDraftWeights: number[] | null = null;
	let svg: SVGSVGElement | null = $state(null);
	let lastCancelToken = 0;
	let moveFrame: number | null = null;
	let pendingMove: {
		weights: number[];
		preferredIndex?: number;
		source: 'triangle' | 'slider';
	} | null = null;

	const features = $derived(manifest.model.features);
	const featureColours = $derived(features.map((feature) => COLOURS[feature] ?? '#d8eeee'));
	const point = $derived.by(() => ({
		x: VERTICES.reduce((sum, vertex, index) => sum + vertex.x * (lens.weights[index] ?? 0), 0),
		y: VERTICES.reduce((sum, vertex, index) => sum + vertex.y * (lens.weights[index] ?? 0), 0)
	}));

	function featureLabel(feature: string): string {
		return manifest.model.feature_labels[feature] ?? feature;
	}

	function infoStateFor(feature: string): InfoState {
		return infoStates[feature] ?? 'closed';
	}

	function infoVisible(feature: string): boolean {
		const state = infoStateFor(feature);
		return state === 'hover' || state === 'focus' || state === 'open';
	}

	function infoId(key: string): string {
		return `lens-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}-info`;
	}

	function infoTriggerId(key: string): string {
		return `${infoId(key)}-trigger`;
	}

	function presetInfoKey(index: number): string {
		return `preset-${index}`;
	}

	function infoPositionFor(key: string): InfoPosition {
		const existing = infoPositions[key];
		if (existing) return existing;
		const width =
			typeof window === 'undefined'
				? INFO_MAX_WIDTH
				: Math.min(INFO_MAX_WIDTH, Math.max(1, window.innerWidth - INFO_VIEWPORT_MARGIN * 2));
		return { left: INFO_VIEWPORT_MARGIN, top: INFO_VIEWPORT_MARGIN, width };
	}

	function scheduleInfoPosition(key: string): void {
		if (typeof window === 'undefined') return;
		window.requestAnimationFrame(() => {
			if (!infoVisible(key)) return;
			const trigger = document.getElementById(infoTriggerId(key));
			const popover = document.getElementById(infoId(key));
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
			const below = triggerRect.bottom + INFO_VIEWPORT_MARGIN;
			const above = triggerRect.top - height - INFO_VIEWPORT_MARGIN;
			let top = below;
			if (top + height > viewportHeight - INFO_VIEWPORT_MARGIN && above >= INFO_VIEWPORT_MARGIN)
				top = above;
			top = Math.max(
				INFO_VIEWPORT_MARGIN,
				Math.min(top, viewportHeight - height - INFO_VIEWPORT_MARGIN)
			);
			infoPositions[key] = { left, top, width };
		});
	}

	function repositionVisibleInfos(): void {
		for (const key of Object.keys(infoStates)) {
			if (infoVisible(key)) scheduleInfoPosition(key);
		}
	}

	function handleInfoPointerEnter(feature: string): void {
		if (infoStateFor(feature) === 'closed' || infoStateFor(feature) === 'dismissed') {
			infoStates[feature] = 'hover';
			scheduleInfoPosition(feature);
		}
	}

	function handleInfoPointerLeave(feature: string): void {
		if (infoStateFor(feature) === 'hover' || infoStateFor(feature) === 'dismissed')
			infoStates[feature] = 'closed';
	}

	function handleInfoFocus(feature: string): void {
		if (infoStateFor(feature) !== 'open') {
			infoStates[feature] = 'focus';
			scheduleInfoPosition(feature);
		}
	}

	function handleInfoBlur(feature: string, event: FocusEvent): void {
		if (infoStateFor(feature) === 'open' || infoStateFor(feature) === 'dismissed') return;
		const wrapper = (event.currentTarget as HTMLElement).parentElement;
		infoStates[feature] = wrapper?.matches(':hover') ? 'hover' : 'closed';
	}

	function toggleInfo(feature: string, event: MouseEvent): void {
		if (infoStateFor(feature) === 'open') {
			const wrapper = (event.currentTarget as HTMLElement).parentElement;
			infoStates[feature] = wrapper?.matches(':hover') ? 'dismissed' : 'closed';
			(event.currentTarget as HTMLButtonElement).blur();
			return;
		}
		infoStates[feature] = 'open';
		scheduleInfoPosition(feature);
	}

	function handleInfoKeydown(feature: string, event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		const wrapper = (event.currentTarget as HTMLElement).parentElement;
		infoStates[feature] = wrapper?.matches(':hover') ? 'dismissed' : 'closed';
		(event.currentTarget as HTMLButtonElement).blur();
	}

	function triangleWeights(x: number, y: number): number[] {
		const a = VERTICES[0];
		const b = VERTICES[1];
		const c = VERTICES[2];
		const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
		let first = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator;
		let second = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator;
		let third = 1 - first - second;
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

	function scheduleMove(
		weights: number[],
		preferredIndex: number | undefined,
		source: 'triangle' | 'slider'
	): void {
		pendingMove = { weights: weights.slice(), preferredIndex, source };
		if (moveFrame !== null) return;
		moveFrame = requestAnimationFrame(() => {
			moveFrame = null;
			const next = pendingMove;
			pendingMove = null;
			if (next) onChange(next.weights, 'move', next.preferredIndex, next.source);
		});
	}

	function movePuck(event: PointerEvent, phase: 'start' | 'end'): void {
		const position = pointFromEvent(event);
		if (!position) return;
		const next = triangleWeights(position.x, position.y);
		onChange(next, phase, next.indexOf(Math.max(...next)), 'triangle');
	}

	function startDrag(event: PointerEvent): void {
		if (!svg) return;
		cancelPendingMove();
		dragging = true;
		draggingPointerId = event.pointerId;
		svg.setPointerCapture(event.pointerId);
		movePuck(event, 'start');
	}

	function continueDrag(event: PointerEvent): void {
		if (!dragging) return;
		const position = pointFromEvent(event);
		if (!position) return;
		const next = triangleWeights(position.x, position.y);
		scheduleMove(next, next.indexOf(Math.max(...next)), 'triangle');
	}

	function endDrag(event: PointerEvent): void {
		if (!dragging) return;
		cancelPendingMove();
		movePuck(event, 'end');
		dragging = false;
		draggingPointerId = null;
		if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
	}

	function cancelDrag(event?: PointerEvent): void {
		if (!dragging) return;
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

	function changeSlider(index: number, value: number): void {
		if (!sliderGesture) {
			sliderGesture = true;
			sliderDraftWeights = lens.weights.slice();
			onChange(sliderDraftWeights.slice(), 'start', index, 'slider');
		}
		const next = changeOneShare(sliderDraftWeights ?? lens.weights, index, value);
		sliderGesture = true;
		sliderDraftWeights = next;
		scheduleMove(next, index, 'slider');
	}

	function startSlider(index: number): void {
		if (sliderGesture) return;
		cancelPendingMove();
		sliderGesture = true;
		sliderDraftWeights = lens.weights.slice();
		onChange(sliderDraftWeights.slice(), 'start', index, 'slider');
	}

	function commitSlider(): void {
		if (!sliderGesture) return;
		const finalWeights = sliderDraftWeights?.slice() ?? lens.weights.slice();
		cancelPendingMove();
		onChange(finalWeights, 'end', undefined, 'slider');
		sliderGesture = false;
		sliderDraftWeights = null;
	}

	function cancelSliderGesture(): void {
		cancelPendingMove();
		if (sliderGesture) onCancel('slider');
		sliderGesture = false;
		sliderDraftWeights = null;
	}

	function cancelSlider(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		cancelSliderGesture();
	}

	$effect(() => {
		const token = cancelToken;
		if (token === lastCancelToken) return;
		lastCancelToken = token;
		const pointerId = draggingPointerId;
		cancelPendingMove();
		dragging = false;
		draggingPointerId = null;
		sliderGesture = false;
		sliderDraftWeights = null;
		if (pointerId !== null && svg?.hasPointerCapture(pointerId))
			svg.releasePointerCapture(pointerId);
	});

	onDestroy(cancelPendingMove);

	onMount(() => {
		window.addEventListener('resize', repositionVisibleInfos);
		window.addEventListener('scroll', repositionVisibleInfos, true);
		return () => {
			window.removeEventListener('resize', repositionVisibleInfos);
			window.removeEventListener('scroll', repositionVisibleInfos, true);
		};
	});
</script>

<section class="lens-mixer" aria-label="Aim the field">
	<div class="lens-mixer__body">
		<div class="lens-mixer__triangle-wrap">
			<svg
				bind:this={svg}
				class="lens-mixer__triangle"
				viewBox="0 0 300 250"
				role="img"
				aria-label="Triangular three-way lens mixer. Drag the puck toward a dimension to give it more weight."
				onpointerdown={startDrag}
				onpointermove={continueDrag}
				onpointerup={endDrag}
				onpointercancel={cancelDrag}
			>
				<defs>
					<linearGradient id="lens-surface" x1="0" y1="0" x2="1" y2="1">
						<stop offset="0" stop-color={featureColours[0]} stop-opacity="0.5" />
						<stop offset="0.5" stop-color={featureColours[1]} stop-opacity="0.42" />
						<stop offset="1" stop-color={featureColours[2]} stop-opacity="0.44" />
					</linearGradient>
					<filter id="lens-glow" x="-100%" y="-100%" width="300%" height="300%">
						<feGaussianBlur stdDeviation="5" result="blur" />
						<feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
					</filter>
				</defs>
				<polygon
					points="150,20 24,220 276,220"
					fill="url(#lens-surface)"
					stroke="rgba(207,231,232,.42)"
					stroke-width="1.2"
				/>
				<path
					d="M150 20 L150 220 M24 220 L213 120 M276 220 L87 120"
					stroke="rgba(207,231,232,.13)"
					stroke-width="1"
					stroke-dasharray="3 5"
				/>
				<circle cx={VERTICES[0].x} cy={VERTICES[0].y} r="4" fill={featureColours[0]} />
				<circle cx={VERTICES[1].x} cy={VERTICES[1].y} r="4" fill={featureColours[1]} />
				<circle cx={VERTICES[2].x} cy={VERTICES[2].y} r="4" fill={featureColours[2]} />
				<circle
					cx={point.x}
					cy={point.y}
					r="16"
					fill="#d8eeee"
					opacity="0.12"
					filter="url(#lens-glow)"
				/>
				<circle cx={point.x} cy={point.y} r="8" fill="#efffff" stroke="#efffff" stroke-width="2" />
				<circle
					cx={point.x}
					cy={point.y}
					r="14"
					fill="none"
					stroke="rgba(239,255,255,.35)"
					stroke-width="1"
				/>
				<text
					x="150"
					y="11"
					text-anchor="middle"
					fill={featureColours[0]}
					font-size="11"
					font-family="Inter, sans-serif"
					font-weight="600"
					>{(manifest.model.feature_labels[features[0]] ?? features[0]).toUpperCase()}</text
				>
				<text
					x="21"
					y="241"
					text-anchor="start"
					fill={featureColours[1]}
					font-size="11"
					font-family="Inter, sans-serif"
					font-weight="600"
					>{(manifest.model.feature_labels[features[1]] ?? features[1]).toUpperCase()}</text
				>
				<text
					x="279"
					y="241"
					text-anchor="end"
					fill={featureColours[2]}
					font-size="11"
					font-family="Inter, sans-serif"
					font-weight="600"
					>{(manifest.model.feature_labels[features[2]] ?? features[2]).toUpperCase()}</text
				>
			</svg>
			<p class="lens-mixer__hint">Drag the puck. The vector and ranking follow immediately.</p>
		</div>

		<div class="lens-mixer__shares" aria-label="Keyboard lens controls">
			{#each features as feature, index (feature)}
				<div class="lens-mixer__share" style:--feature-colour={featureColours[index] ?? '#d8eeee'}>
					<div class="lens-mixer__share-line">
						<div class="lens-mixer__share-label">
							<label for="lens-share-{feature}">{featureLabel(feature)}</label>
							<span
								class="lens-mixer__info-wrap"
								role="presentation"
								onpointerenter={() => handleInfoPointerEnter(feature)}
								onpointerleave={() => handleInfoPointerLeave(feature)}
							>
								<button
									type="button"
									class="lens-mixer__info"
									id={infoTriggerId(feature)}
									aria-label="About {featureLabel(feature)}"
									aria-expanded={infoVisible(feature)}
									aria-controls={infoId(feature)}
									aria-describedby={infoId(feature)}
									onclick={(event) => toggleInfo(feature, event)}
									onfocus={() => handleInfoFocus(feature)}
									onblur={(event) => handleInfoBlur(feature, event)}
									onkeydown={(event) => handleInfoKeydown(feature, event)}>i</button
								>
								<div
									id={infoId(feature)}
									class="lens-mixer__info-popover"
									class:lens-mixer__info-popover--visible={infoVisible(feature)}
									style:left={`${infoPositionFor(feature).left}px`}
									style:top={`${infoPositionFor(feature).top}px`}
									style:width={`${infoPositionFor(feature).width}px`}
									role="tooltip"
									aria-hidden={!infoVisible(feature)}
								>
									<p>{manifest.model.feature_blurbs[feature] ?? ''}</p>
								</div>
							</span>
						</div>
						<strong>{lens.displayShares[index] ?? 0}%</strong>
					</div>
					<input
						id="lens-share-{feature}"
						type="range"
						min="0"
						max="100"
						step="1"
						value={lens.displayShares[index] ?? 0}
						aria-valuetext={`${lens.displayShares[index] ?? 0}% of the current prominence weighting`}
						onpointerdown={() => startSlider(index)}
						onpointercancel={cancelSliderGesture}
						oninput={(event) => changeSlider(index, Number(event.currentTarget.value))}
						onchange={commitSlider}
						onblur={commitSlider}
						onkeydown={cancelSlider}
					/>
				</div>
			{/each}
		</div>
	</div>

	<div class="lens-mixer__presets">
		<div class="lens-mixer__preset-grid">
			{#each manifest.presets as preset, index (preset.name)}
				{@const infoKey = presetInfoKey(index)}
				<div class="lens-mixer__preset-option">
					<button
						type="button"
						class="lens-mixer__preset"
						class:active={lens.presetId === preset.name}
						aria-pressed={lens.presetId === preset.name}
						onclick={() => onPreset(preset.name, preset.weights)}
					>
						<span class="lens-mixer__preset-name">{preset.name}</span>
					</button>
					{#if preset.note}
						<span
							class="lens-mixer__info-wrap lens-mixer__preset-info-wrap"
							role="presentation"
							onpointerenter={() => handleInfoPointerEnter(infoKey)}
							onpointerleave={() => handleInfoPointerLeave(infoKey)}
						>
							<button
								type="button"
								class="lens-mixer__info lens-mixer__preset-info"
								data-testid="lens-preset-info"
								id={infoTriggerId(infoKey)}
								aria-label="About {preset.name}"
								aria-expanded={infoVisible(infoKey)}
								aria-controls={infoId(infoKey)}
								aria-describedby={infoId(infoKey)}
								onclick={(event) => toggleInfo(infoKey, event)}
								onfocus={() => handleInfoFocus(infoKey)}
								onblur={(event) => handleInfoBlur(infoKey, event)}
								onkeydown={(event) => handleInfoKeydown(infoKey, event)}>i</button
							>
							<div
								id={infoId(infoKey)}
								class="lens-mixer__info-popover"
								class:lens-mixer__info-popover--visible={infoVisible(infoKey)}
								style:left={`${infoPositionFor(infoKey).left}px`}
								style:top={`${infoPositionFor(infoKey).top}px`}
								style:width={`${infoPositionFor(infoKey).width}px`}
								role="tooltip"
								aria-hidden={!infoVisible(infoKey)}
							>
								<p>{preset.note}</p>
							</div>
						</span>
					{/if}
				</div>
			{/each}
		</div>
	</div>
</section>

<style>
	.lens-mixer {
		display: flex;
		flex-direction: column;
		gap: 9px;
		padding: 12px 14px;
		border: 1px solid rgba(164, 204, 206, 0.18);
		border-radius: 14px;
		background: rgba(18, 28, 28, 0.92);
	}
	.lens-mixer__share-line {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.lens-mixer__body {
		display: grid;
		grid-template-columns: minmax(180px, 1fr) minmax(150px, 0.78fr);
		gap: 9px;
		align-items: center;
	}
	.lens-mixer__triangle-wrap {
		min-width: 0;
	}
	.lens-mixer__triangle {
		display: block;
		width: 100%;
		max-height: 170px;
		min-height: 135px;
		overflow: visible;
		cursor: grab;
		touch-action: none;
	}
	.lens-mixer__triangle:active {
		cursor: grabbing;
	}
	.lens-mixer__hint {
		margin: 2px 0 0;
		font-family: var(--font-family-interactive);
		font-size: 10px;
		line-height: 1.4;
		color: var(--color-text-muted);
		display: none;
	}
	.lens-mixer__shares {
		display: grid;
		gap: 6px;
	}
	.lens-mixer__share {
		display: grid;
		gap: 3px;
	}
	.lens-mixer__share-line label,
	.lens-mixer__share-line strong {
		font-family: var(--font-family-interactive);
		font-size: 11px;
		color: var(--color-text-muted);
		line-height: 1.1;
	}
	.lens-mixer__share-label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.lens-mixer__share-line strong {
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}
	.lens-mixer__share input {
		width: 100%;
		min-height: 44px;
		margin: 0;
		accent-color: var(--feature-colour);
	}
	.lens-mixer__info {
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
	.lens-mixer__info:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.lens-mixer__info-wrap {
		position: relative;
		display: inline-flex;
	}
	.lens-mixer__info-popover {
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
		transform: translateY(-0.25rem);
		pointer-events: none;
		transition:
			opacity 140ms ease,
			transform 140ms ease,
			visibility 140ms ease;
	}
	.lens-mixer__info-popover--visible {
		opacity: 1;
		visibility: visible;
		transform: none;
		pointer-events: auto;
	}
	.lens-mixer__info-popover p {
		margin: 0;
	}
	.lens-mixer__presets {
		display: grid;
		gap: 5px;
	}
	.lens-mixer__preset-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 4px;
	}
	.lens-mixer__preset-option {
		position: relative;
		min-width: 0;
	}
	.lens-mixer__preset {
		display: flex;
		flex-direction: column;
		gap: 1px;
		width: 100%;
		min-height: 44px;
		padding: 3px 2.25rem 3px 6px;
		border: 1px solid rgba(164, 204, 206, 0.17);
		border-radius: 7px;
		background: rgba(8, 16, 16, 0.5);
		text-align: left;
		color: var(--color-text-muted);
		font-family: var(--font-family-interactive);
		font-size: 10px;
		cursor: pointer;
		line-height: 1.1;
		transition:
			border-color 150ms ease,
			background 150ms ease,
			color 150ms ease;
	}
	.lens-mixer__preset:hover,
	.lens-mixer__preset-option:hover > .lens-mixer__preset,
	.lens-mixer__preset.active {
		border-color: rgba(239, 255, 255, 0.56);
		background: rgba(46, 75, 72, 0.42);
		color: #efffff;
	}
	.lens-mixer__preset:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.lens-mixer__preset-info-wrap {
		position: absolute;
		top: 0;
		right: 6px;
		bottom: 0;
		align-items: center;
	}
	.lens-mixer__preset-name {
		font-weight: 600;
		line-height: 1.25;
	}
	@media (max-width: 780px) {
		.lens-mixer__body {
			grid-template-columns: minmax(0, 1fr);
		}
		.lens-mixer__shares {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 10px;
		}
		.lens-mixer__preset-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 430px) {
		.lens-mixer {
			padding: 14px;
		}
		.lens-mixer__shares {
			grid-template-columns: 1fr;
			gap: 10px;
		}
		.lens-mixer__triangle {
			max-height: 206px;
		}
	}
</style>
