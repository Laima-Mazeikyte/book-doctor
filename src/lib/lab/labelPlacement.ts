export type LabelAnchor = 'start' | 'middle' | 'end';
export type LabelRing = 'near' | 'displaced';
export type LabelKind = 'focus' | 'interaction' | 'highlight' | 'connection';

export interface LabelRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface LabelMeasurement {
	width: number;
	height: number;
	fontSize: number;
}

export interface LabelPoint {
	id: number;
	text: string;
	x: number;
	y: number;
	measurement: LabelMeasurement;
	priority: number;
	kind: LabelKind;
	mandatory: boolean;
	emphasis: boolean;
}

export interface LabelRectObstacle {
	type: 'rect';
	rect: LabelRect;
}

export interface LabelCircleObstacle {
	type: 'circle';
	id?: number;
	x: number;
	y: number;
	radius: number;
}

export type LabelObstacle = LabelRectObstacle | LabelCircleObstacle;

export interface LabelLeader {
	id: number;
	key: string;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface LabelPlacement {
	id: number;
	text: string;
	x: number;
	y: number;
	anchor: LabelAnchor;
	box: LabelRect;
	/** The measured glyph area, excluding the collision-clearance padding around it. */
	textBox: LabelRect;
	ring: LabelRing;
	anchorIndex: number;
	key: string;
	kind: LabelKind;
	priority: number;
	mandatory: boolean;
	emphasis: boolean;
	leader: LabelLeader | null;
}

export interface LabelLayout {
	labels: LabelPlacement[];
	leaders: LabelLeader[];
	hiddenIds: number[];
}

export interface LabelPlacementOptions {
	points: readonly LabelPoint[];
	/** All visible node centres, including labels waiting for their reveal-stability frames. */
	nodePoints?: readonly Pick<LabelPoint, 'id' | 'x' | 'y'>[];
	viewport: LabelRect;
	obstacles?: readonly LabelObstacle[];
	previous?: ReadonlyMap<number, LabelPlacement>;
	nodeRadius?: number;
	edgePadding?: number;
	collisionPadding?: number;
}

interface Direction {
	x: number;
	y: number;
	/** Lower is preferred when distance and hysteresis are equal. */
	preference: number;
}

interface Candidate {
	point: LabelPoint;
	box: LabelRect;
	textBox: LabelRect;
	ring: LabelRing;
	anchorIndex: number;
	anchor: LabelAnchor;
	key: string;
	x: number;
	y: number;
	leader: LabelLeader | null;
	score: number;
}

interface Occupied {
	placement: LabelPlacement;
}

const DIRECTIONS: readonly Direction[] = [
	{ x: 0, y: -1, preference: 0 }, // above
	{ x: 0.707, y: -0.707, preference: 2 }, // upper-right
	{ x: 1, y: 0, preference: 5 }, // right
	{ x: 0.707, y: 0.707, preference: 11 }, // lower-right
	{ x: 0, y: 1, preference: 16 }, // below
	{ x: -0.707, y: 0.707, preference: 13 }, // lower-left
	{ x: -1, y: 0, preference: 8 }, // left
	{ x: -0.707, y: -0.707, preference: 3 } // upper-left
];

const RINGS: readonly { name: LabelRing; gap: number }[] = [
	{ name: 'near', gap: 8 },
	{ name: 'displaced', gap: 24 }
];

const WIDE_DISPLACEMENT_GAPS: readonly number[] = [44, 72, 104, 144];
const LABEL_PADDING = 4;
const PREVIOUS_EXIT_MARGIN = 2;
const PREVIOUS_LABEL_CLEARANCE = 2;

function overlap(a: LabelRect, b: LabelRect): boolean {
	return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function expandRect(rect: LabelRect, amount: number): LabelRect {
	return {
		left: rect.left - amount,
		top: rect.top - amount,
		right: rect.right + amount,
		bottom: rect.bottom + amount
	};
}

function circleOverlapsRect(circle: LabelCircleObstacle, rect: LabelRect): boolean {
	const closestX = Math.max(rect.left, Math.min(circle.x, rect.right));
	const closestY = Math.max(rect.top, Math.min(circle.y, rect.bottom));
	const dx = circle.x - closestX;
	const dy = circle.y - closestY;
	return dx * dx + dy * dy < circle.radius * circle.radius;
}

function lineOrientation(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	cx: number,
	cy: number
): number {
	const value = (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
	if (Math.abs(value) < 0.001) return 0;
	return value > 0 ? 1 : -1;
}

function linesCross(first: LabelLeader, second: LabelLeader): boolean {
	const firstA = lineOrientation(first.x1, first.y1, first.x2, first.y2, second.x1, second.y1);
	const firstB = lineOrientation(first.x1, first.y1, first.x2, first.y2, second.x2, second.y2);
	const secondA = lineOrientation(second.x1, second.y1, second.x2, second.y2, first.x1, first.y1);
	const secondB = lineOrientation(second.x1, second.y1, second.x2, second.y2, first.x2, first.y2);
	return firstA !== firstB && secondA !== secondB;
}

function clamp(value: number, lower: number, upper: number): number {
	return Math.max(lower, Math.min(upper, value));
}

function textAnchor(direction: Direction): LabelAnchor {
	if (direction.x > 0.25) return 'start';
	if (direction.x < -0.25) return 'end';
	return 'middle';
}

function textX(box: LabelRect, anchor: LabelAnchor, padding: number): number {
	if (anchor === 'start') return box.left + padding;
	if (anchor === 'end') return box.right - padding;
	return (box.left + box.right) / 2;
}

function textY(box: LabelRect, measurement: LabelMeasurement, padding: number): number {
	return box.top + padding + Math.max(measurement.fontSize, measurement.height * 0.76);
}

function leaderFor(point: LabelPoint, box: LabelRect, id: number, key: string): LabelLeader {
	let x2 = clamp(point.x, box.left, box.right);
	let y2 = clamp(point.y, box.top, box.bottom);
	if (x2 === point.x && y2 === point.y) {
		const centreX = (box.left + box.right) / 2;
		const centreY = (box.top + box.bottom) / 2;
		if (Math.abs(point.x - centreX) >= Math.abs(point.y - centreY)) {
			x2 = point.x < centreX ? box.left : box.right;
		} else {
			y2 = point.y < centreY ? box.top : box.bottom;
		}
	}
	return { id, key, x1: point.x, y1: point.y, x2, y2 };
}

function makeCandidate(
	point: LabelPoint,
	ring: LabelRing,
	gap: number,
	anchorIndex: number,
	nodeRadius: number,
	padding: number
): Candidate {
	const direction = DIRECTIONS[anchorIndex];
	const width = point.measurement.width + padding * 2;
	const height = point.measurement.height + padding * 2;
	const projectedHalfExtent =
		Math.abs(direction.x) * width * 0.5 + Math.abs(direction.y) * height * 0.5;
	const distance = nodeRadius + gap + projectedHalfExtent;
	const centreX = point.x + direction.x * distance;
	const centreY = point.y + direction.y * distance;
	const box: LabelRect = {
		left: centreX - width * 0.5,
		top: centreY - height * 0.5,
		right: centreX + width * 0.5,
		bottom: centreY + height * 0.5
	};
	const textBox: LabelRect = {
		left: box.left + padding,
		top: box.top + padding,
		right: box.right - padding,
		bottom: box.bottom - padding
	};
	const anchor = textAnchor(direction);
	const key = `${point.id}:${ring}:${gap}:${anchorIndex}`;
	return {
		point,
		box,
		textBox,
		ring,
		anchorIndex,
		anchor,
		key,
		x: textX(box, anchor, padding),
		y: textY(box, point.measurement, padding),
		leader: ring === 'displaced' ? leaderFor(point, box, point.id, key) : null,
		score: ring === 'near' ? direction.preference : 32 + direction.preference
	};
}

function makeCandidates(
	point: LabelPoint,
	nodeRadius: number,
	padding: number,
	includeWide = false
): Candidate[] {
	const candidates: Candidate[] = [];
	for (const ring of RINGS) {
		for (let anchorIndex = 0; anchorIndex < DIRECTIONS.length; anchorIndex++) {
			candidates.push(makeCandidate(point, ring.name, ring.gap, anchorIndex, nodeRadius, padding));
		}
	}
	if (includeWide) {
		for (const gap of WIDE_DISPLACEMENT_GAPS) {
			for (let anchorIndex = 0; anchorIndex < DIRECTIONS.length; anchorIndex++) {
				candidates.push(makeCandidate(point, 'displaced', gap, anchorIndex, nodeRadius, padding));
			}
		}
	}
	return candidates;
}

function inViewport(candidate: Candidate, viewport: LabelRect, edgePadding: number): boolean {
	return (
		candidate.box.left >= viewport.left + edgePadding &&
		candidate.box.top >= viewport.top + edgePadding &&
		candidate.box.right <= viewport.right - edgePadding &&
		candidate.box.bottom <= viewport.bottom - edgePadding
	);
}

function shiftIntoViewport(
	candidate: Candidate,
	viewport: LabelRect,
	edgePadding: number
): Candidate {
	const minimumLeft = viewport.left + edgePadding;
	const minimumTop = viewport.top + edgePadding;
	const maximumRight = viewport.right - edgePadding;
	const maximumBottom = viewport.bottom - edgePadding;
	const shiftX =
		candidate.box.left < minimumLeft
			? minimumLeft - candidate.box.left
			: candidate.box.right > maximumRight
				? maximumRight - candidate.box.right
				: 0;
	const shiftY =
		candidate.box.top < minimumTop
			? minimumTop - candidate.box.top
			: candidate.box.bottom > maximumBottom
				? maximumBottom - candidate.box.bottom
				: 0;
	const box = {
		left: candidate.box.left + shiftX,
		top: candidate.box.top + shiftY,
		right: candidate.box.right + shiftX,
		bottom: candidate.box.bottom + shiftY
	};
	const textBox = {
		left: candidate.textBox.left + shiftX,
		top: candidate.textBox.top + shiftY,
		right: candidate.textBox.right + shiftX,
		bottom: candidate.textBox.bottom + shiftY
	};
	return {
		...candidate,
		box,
		textBox,
		x: candidate.x + shiftX,
		y: candidate.y + shiftY,
		leader: candidate.leader
			? leaderFor(candidate.point, box, candidate.point.id, candidate.key)
			: null
	};
}

function candidateCollisions(
	candidate: Candidate,
	pointId: number,
	viewport: LabelRect,
	edgePadding: number,
	obstacles: readonly LabelObstacle[],
	nodes: readonly LabelCircleObstacle[],
	occupied: readonly Occupied[],
	allowPreviousLabelClearance = false
): number {
	let collisions = inViewport(candidate, viewport, edgePadding) ? 0 : 1;
	for (const obstacle of obstacles) {
		if (obstacle.type === 'rect' && overlap(candidate.box, obstacle.rect)) collisions++;
		if (obstacle.type === 'circle' && circleOverlapsRect(obstacle, candidate.box)) collisions++;
	}
	for (const node of nodes) {
		if (node.id === pointId) continue;
		if (circleOverlapsRect(node, candidate.box)) collisions++;
	}
	for (const entry of occupied) {
		// A returning ordinary label may keep its anchor when only the surrounding
		// clearance padding would overlap, but retain a small gap for the rendered halo.
		const labelsOverlap = allowPreviousLabelClearance
			? overlap(
					expandRect(candidate.textBox, PREVIOUS_LABEL_CLEARANCE),
					expandRect(entry.placement.textBox, PREVIOUS_LABEL_CLEARANCE)
				)
			: overlap(candidate.box, entry.placement.box);
		if (labelsOverlap) collisions++;
	}
	return collisions;
}

function occupiedFromPlacements(placements: readonly LabelPlacement[]): Occupied[] {
	return placements.map((placement) => ({ placement }));
}

function leadersFromPlacements(placements: readonly LabelPlacement[]): LabelLeader[] {
	return placements
		.map((placement) => placement.leader)
		.filter((leader): leader is LabelLeader => leader !== null);
}

function collisionFreeCandidate(
	candidate: Candidate,
	pointId: number,
	viewport: LabelRect,
	edgePadding: number,
	obstacles: readonly LabelObstacle[],
	nodes: readonly LabelCircleObstacle[],
	occupied: readonly Occupied[],
	allowPreviousLabelClearance = false
): Candidate | null {
	const isInViewport = inViewport(candidate, viewport, edgePadding);
	// Ordinary connection labels belong to their projected marker. Never pull one in from
	// outside the map; only mandatory interaction labels may be represented at the edge.
	if (!isInViewport && !candidate.point.mandatory) return null;
	const adjusted = isInViewport ? candidate : shiftIntoViewport(candidate, viewport, edgePadding);
	const edgeLabel =
		!isInViewport && candidate.point.mandatory
			? {
					...adjusted,
					leader: leaderFor(candidate.point, adjusted.box, candidate.point.id, adjusted.key)
				}
			: adjusted;
	return candidateCollisions(
		edgeLabel,
		pointId,
		viewport,
		edgePadding,
		obstacles,
		nodes,
		occupied,
		allowPreviousLabelClearance
	) === 0
		? edgeLabel
		: null;
}

function scoreCandidate(
	candidate: Candidate,
	previous: LabelPlacement | undefined,
	leaders: readonly LabelLeader[]
): number {
	let score = candidate.score;
	if (
		previous &&
		previous.anchorIndex === candidate.anchorIndex &&
		previous.ring === candidate.ring
	) {
		score -= 28;
	}
	if (candidate.leader) {
		for (const leader of leaders) {
			if (linesCross(candidate.leader, leader)) score += 12;
		}
	}
	return score;
}

function placementFromCandidate(candidate: Candidate): LabelPlacement {
	return {
		id: candidate.point.id,
		text: candidate.point.text,
		x: candidate.x,
		y: candidate.y,
		anchor: candidate.anchor,
		box: candidate.box,
		textBox: candidate.textBox,
		ring: candidate.ring,
		anchorIndex: candidate.anchorIndex,
		key: candidate.key,
		kind: candidate.point.kind,
		priority: candidate.point.priority,
		mandatory: candidate.point.mandatory,
		emphasis: candidate.point.emphasis,
		leader: candidate.leader
	};
}

function chooseCandidate(
	point: LabelPoint,
	candidates: readonly Candidate[],
	previous: LabelPlacement | undefined,
	viewport: LabelRect,
	edgePadding: number,
	obstacles: readonly LabelObstacle[],
	nodes: readonly LabelCircleObstacle[],
	occupied: readonly Occupied[],
	leaders: readonly LabelLeader[],
	allowWide: boolean,
	padding: number
): Candidate | null {
	const prior: Candidate | undefined = previous
		? candidates.find(
				(candidate) =>
					candidate.anchorIndex === previous.anchorIndex && candidate.ring === previous.ring
			)
		: undefined;
	const priorPlacement = prior
		? collisionFreeCandidate(
				prior,
				point.id,
				viewport,
				Math.max(0, edgePadding - PREVIOUS_EXIT_MARGIN),
				obstacles,
				nodes,
				occupied,
				!point.mandatory
			)
		: null;
	if (priorPlacement) return priorPlacement;

	const additional = allowWide
		? makeCandidates(point, nodeRadiusFor(point, nodes), padding, true).slice(candidates.length)
		: [];
	const valid = [...candidates, ...additional]
		.map((candidate) => ({
			candidate: collisionFreeCandidate(
				candidate,
				point.id,
				viewport,
				edgePadding,
				obstacles,
				nodes,
				occupied
			),
			score: scoreCandidate(candidate, previous, leaders)
		}))
		.filter((entry): entry is { candidate: Candidate; score: number } => entry.candidate !== null)
		.sort((first, second) => first.score - second.score);
	return valid[0]?.candidate ?? null;
}

function nodeRadiusFor(point: LabelPoint, nodes: readonly LabelCircleObstacle[]): number {
	return nodes.find((node) => node.id === point.id)?.radius ?? 7;
}

/**
 * Make room for a mandatory label without ever accepting an overlapping fallback.
 * Ordinary labels may be moved or evicted, starting with the least important one. The
 * caller then performs the normal placement again, and only after that tries the wider
 * callout rings.
 */
function makeRoomForMandatory(
	point: LabelPoint,
	points: readonly LabelPoint[],
	placements: LabelPlacement[],
	viewport: LabelRect,
	edgePadding: number,
	obstacles: readonly LabelObstacle[],
	nodes: readonly LabelCircleObstacle[],
	previous: LabelPlacement | undefined,
	padding: number
): boolean {
	let working = [...placements];
	const ordinary = () =>
		working
			.map((placement) => placement)
			.filter((placement) => !placement.mandatory)
			.sort((first, second) => second.priority - first.priority);

	for (const victim of ordinary()) {
		const victimIndex = working.indexOf(victim);
		if (victimIndex < 0) continue;
		const remaining = working.filter((_, index) => index !== victimIndex);
		const remainingOccupied = occupiedFromPlacements(remaining);
		const remainingLeaders = leadersFromPlacements(remaining);
		const victimPoint = points.find((candidate) => candidate.id === victim.id);

		if (victimPoint) {
			const replacementCandidates = makeCandidates(
				victimPoint,
				nodeRadiusFor(victimPoint, nodes),
				padding
			)
				.filter((candidate) => candidate.key !== victim.key)
				.map((candidate) =>
					collisionFreeCandidate(
						candidate,
						victim.id,
						viewport,
						edgePadding,
						obstacles,
						nodes,
						remainingOccupied
					)
				)
				.filter((candidate): candidate is Candidate => candidate !== null)
				.sort(
					(first, second) =>
						scoreCandidate(first, undefined, remainingLeaders) -
						scoreCandidate(second, undefined, remainingLeaders)
				);

			for (const replacement of replacementCandidates) {
				const trial = [...remaining, placementFromCandidate(replacement)];
				const mandatory = chooseCandidate(
					point,
					makeCandidates(point, nodeRadiusFor(point, nodes), padding),
					previous,
					viewport,
					edgePadding,
					obstacles,
					nodes,
					occupiedFromPlacements(trial),
					leadersFromPlacements(trial),
					false,
					padding
				);
				if (mandatory) {
					placements.splice(0, placements.length, ...trial);
					return true;
				}
			}
		}

		// If moving the victim cannot make room, evict it and see whether this is enough.
		working = remaining;
		const mandatory = chooseCandidate(
			point,
			makeCandidates(point, nodeRadiusFor(point, nodes), padding),
			previous,
			viewport,
			edgePadding,
			obstacles,
			nodes,
			occupiedFromPlacements(working),
			leadersFromPlacements(working),
			false,
			padding
		);
		if (mandatory) {
			placements.splice(0, placements.length, ...working);
			return true;
		}
	}

	return false;
}

function tryImprove(
	points: readonly LabelPoint[],
	placements: LabelPlacement[],
	viewport: LabelRect,
	edgePadding: number,
	obstacles: readonly LabelObstacle[],
	nodes: readonly LabelCircleObstacle[],
	leaders: LabelLeader[],
	padding: number
): void {
	const placedIds = new Set(placements.map((placement) => placement.id));
	for (const point of points) {
		if (placedIds.has(point.id) || point.mandatory) continue;
		for (let victimIndex = placements.length - 1; victimIndex >= 0; victimIndex--) {
			const victim = placements[victimIndex];
			if (victim.priority > point.priority) continue;
			const remaining = placements
				.filter((_, index) => index !== victimIndex)
				.map((placement) => ({ placement }));
			const victimPoint = points.find((candidate) => candidate.id === victim.id);
			if (!victimPoint) continue;
			const victimCandidates = makeCandidates(
				victimPoint,
				nodeRadiusFor(victimPoint, nodes),
				padding
			)
				.filter((candidate) => candidate.key !== victim.key)
				.map((candidate) =>
					collisionFreeCandidate(
						candidate,
						victim.id,
						viewport,
						edgePadding,
						obstacles,
						nodes,
						remaining
					)
				)
				.filter((candidate): candidate is Candidate => candidate !== null)
				.sort((first, second) => first.score - second.score);
			let replacement: Candidate | null = null;
			let labelCandidate: Candidate | null = null;
			for (const candidate of victimCandidates) {
				const withReplacement = [...remaining, { placement: placementFromCandidate(candidate) }];
				const nextLabel = makeCandidates(point, nodeRadiusFor(point, nodes), padding)
					.map((label) =>
						collisionFreeCandidate(
							label,
							point.id,
							viewport,
							edgePadding,
							obstacles,
							nodes,
							withReplacement
						)
					)
					.find((label): label is Candidate => label !== null);
				if (!nextLabel) continue;
				replacement = candidate;
				labelCandidate = nextLabel;
				break;
			}
			if (!replacement || !labelCandidate) continue;
			placements.splice(victimIndex, 1, placementFromCandidate(replacement));
			placements.push(placementFromCandidate(labelCandidate));
			leaders.splice(
				0,
				leaders.length,
				...placements
					.map((placement) => placement.leader)
					.filter((leader): leader is LabelLeader => leader !== null)
			);
			placedIds.add(point.id);
			break;
		}
	}
}

export function placeLabels(options: LabelPlacementOptions): LabelLayout {
	const {
		points,
		nodePoints = points,
		viewport,
		obstacles = [],
		previous = new Map(),
		nodeRadius = 7,
		edgePadding = 4,
		collisionPadding = LABEL_PADDING
	} = options;
	const nodes: LabelCircleObstacle[] = nodePoints.map((point) => ({
		type: 'circle',
		id: point.id,
		x: point.x,
		y: point.y,
		radius: nodeRadius
	}));
	const occupied: Occupied[] = [];
	const labels: LabelPlacement[] = [];
	const leaders: LabelLeader[] = [];

	for (const point of points) {
		const candidates = makeCandidates(point, nodeRadius, collisionPadding);
		let selected = chooseCandidate(
			point,
			candidates,
			previous.get(point.id),
			viewport,
			edgePadding,
			obstacles,
			nodes,
			occupied,
			leaders,
			false,
			collisionPadding
		);
		if (!selected && point.mandatory) {
			if (
				makeRoomForMandatory(
					point,
					points,
					labels,
					viewport,
					edgePadding,
					obstacles,
					nodes,
					previous.get(point.id),
					collisionPadding
				)
			) {
				occupied.splice(0, occupied.length, ...occupiedFromPlacements(labels));
				leaders.splice(0, leaders.length, ...leadersFromPlacements(labels));
				selected = chooseCandidate(
					point,
					candidates,
					previous.get(point.id),
					viewport,
					edgePadding,
					obstacles,
					nodes,
					occupied,
					leaders,
					false,
					collisionPadding
				);
			}
			// The wider callout distances still require a completely collision-free placement.
			selected ??= chooseCandidate(
				point,
				candidates,
				previous.get(point.id),
				viewport,
				edgePadding,
				obstacles,
				nodes,
				occupied,
				leaders,
				true,
				collisionPadding
			);
		}
		if (!selected) {
			continue;
		}
		const placement = placementFromCandidate(selected);
		labels.push(placement);
		occupied.push({ placement });
		if (placement.leader) leaders.push(placement.leader);
	}

	tryImprove(points, labels, viewport, edgePadding, obstacles, nodes, leaders, collisionPadding);
	labels.sort((first, second) => first.priority - second.priority);
	const visibleIds = new Set(labels.map((label) => label.id));
	return {
		labels,
		leaders: labels
			.map((label) => label.leader)
			.filter((leader): leader is LabelLeader => leader !== null),
		hiddenIds: points.map((point) => point.id).filter((id) => !visibleIds.has(id))
	};
}
