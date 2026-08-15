import { describe, expect, it } from 'vitest';
import { placeLabels, type LabelPoint } from './labelPlacement';

const viewport = { left: 0, top: 0, right: 420, bottom: 260 };

function point(id: number, x: number, y: number, priority = id, mandatory = false): LabelPoint {
	return {
		id,
		text: `Author ${id}`,
		x,
		y,
		measurement: { width: 52, height: 15, fontSize: 12 },
		priority,
		kind: mandatory ? 'focus' : 'connection',
		mandatory,
		emphasis: mandatory
	};
}

function boxesOverlap(
	first: { left: number; top: number; right: number; bottom: number },
	second: { left: number; top: number; right: number; bottom: number }
): boolean {
	return (
		first.left < second.right &&
		first.right > second.left &&
		first.top < second.bottom &&
		first.bottom > second.top
	);
}

describe('placeLabels', () => {
	it('keeps nodes fixed and avoids overlap for separated points', () => {
		const points = [point(1, 100, 100), point(2, 300, 160)];
		const result = placeLabels({ points, viewport });

		expect(result.labels).toHaveLength(2);
		expect(result.labels[0].box.right).toBeLessThanOrEqual(viewport.right);
		expect(result.labels[1].box.left).toBeGreaterThanOrEqual(viewport.left);
		expect(boxesOverlap(result.labels[0].box, result.labels[1].box)).toBe(false);
		expect(points.map(({ x, y }) => ({ x, y }))).toEqual([
			{ x: 100, y: 100 },
			{ x: 300, y: 160 }
		]);
	});

	it('does not pull an ordinary off-screen author back into view', () => {
		const result = placeLabels({ points: [point(1, -500, 100)], viewport });

		expect(result.labels).toEqual([]);
		expect(result.hiddenIds).toEqual([1]);
	});

	it('clamps an off-screen mandatory label only with a leader line', () => {
		const result = placeLabels({ points: [point(1, -500, 100, 0, true)], viewport });

		expect(result.labels).toHaveLength(1);
		expect(result.labels[0].box.left).toBeGreaterThanOrEqual(viewport.left);
		expect(result.labels[0].leader).not.toBeNull();
	});

	it('hides labels when no collision-free placement exists', () => {
		const points = [point(1, 210, 130, 0, true), point(2, 210, 130, 1), point(3, 210, 130, 2)];
		const result = placeLabels({
			points,
			viewport: { left: 0, top: 0, right: 220, bottom: 150 },
			obstacles: [{ type: 'rect', rect: { left: 0, top: 0, right: 220, bottom: 150 } }]
		});

		expect(result.labels).toEqual([]);
		expect(result.hiddenIds).toEqual([1, 2, 3]);
	});

	it('never overlaps mandatory labels when only one collision-free slot remains', () => {
		const points = [point(1, 110, 75, 0, true), point(2, 110, 75, 1, true)];
		const result = placeLabels({
			points,
			viewport: { left: 0, top: 0, right: 220, bottom: 150 },
			obstacles: [
				{ type: 'rect', rect: { left: 0, top: 0, right: 220, bottom: 36 } },
				{ type: 'rect', rect: { left: 0, top: 61, right: 220, bottom: 150 } },
				{ type: 'rect', rect: { left: 0, top: 0, right: 79, bottom: 150 } },
				{ type: 'rect', rect: { left: 141, top: 0, right: 220, bottom: 150 } }
			]
		});

		expect(result.labels.map((label) => label.id)).toEqual([1]);
		expect(result.hiddenIds).toEqual([2]);
		expect(result.labels.every((label) => label.mandatory)).toBe(true);
	});

	it('adds a leader line when a label needs the displaced ring', () => {
		const result = placeLabels({
			points: [point(1, 100, 100)],
			viewport,
			obstacles: [{ type: 'rect', rect: { left: 70, top: 60, right: 170, bottom: 150 } }]
		});

		expect(result.labels).toHaveLength(1);
		expect(result.labels[0].ring).toBe('displaced');
		expect(result.leaders).toHaveLength(1);
		expect(result.leaders[0].id).toBe(1);
	});

	it('prefers a previous anchor when it remains collision-free', () => {
		const first = placeLabels({ points: [point(1, 200, 130)], viewport });
		const second = placeLabels({
			points: [point(1, 200, 130)],
			viewport,
			previous: new Map(first.labels.map((label) => [label.id, label]))
		});

		expect(second.labels[0].key).toBe(first.labels[0].key);
	});

	it('reveals more labels as projected screen space opens up', () => {
		const closePoints = [point(1, 60, 45, 0, true), point(2, 60, 45, 1)];
		for (const candidate of closePoints)
			candidate.measurement = { width: 96, height: 18, fontSize: 12 };
		const close = placeLabels({
			points: closePoints,
			viewport: { left: 0, top: 0, right: 120, bottom: 90 },
			obstacles: [{ type: 'rect', rect: { left: 0, top: 35, right: 120, bottom: 90 } }]
		});
		const wide = placeLabels({
			points: [point(1, 90, 90, 0, true), point(2, 330, 190, 1)],
			viewport
		});

		expect(close.labels.length).toBeLessThan(wide.labels.length);
	});
});
