import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { compareAuthorsEdge } from './comparison';

vi.mock('$lib/auth/anonymous-session', () => ({
	ensureAnonymousSessionStarted: vi.fn(async () => true)
}));

function response() {
	const direction = {
		like_rate: 0.68,
		baseline_rate: 0.71,
		rate_difference: -0.03,
		rate_difference_ci_lower: -0.05,
		rate_difference_ci_upper: -0.001,
		log_odds_ratio: -0.12,
		evidence_score: 0.005,
		p_value: 0.037,
		q_value: null,
		evidence_status: 'eligible_unadjusted',
		eligible_for_production_test: true
	};
	return {
		schema_version: 1,
		dataset_version: 'author-comparisons-v1',
		author_a: { author_id: 13473, author_name: 'Jacqueline Woodson' },
		author_b: { author_id: 2825, author_name: 'Ashley Elston' },
		a_to_b: { ...direction },
		b_to_a: { ...direction },
		validated_relationship: {
			present: false,
			source: 'paired-evidence-v3',
			directionality_status: 'not_validated'
		}
	};
}

const invoke = vi.fn();
const supabase = { functions: { invoke } } as unknown as SupabaseClient;

beforeEach(() => invoke.mockReset());

describe('compareAuthorsEdge', () => {
	it('accepts an on-demand response without mode, display state, or validated-pair fields', async () => {
		invoke.mockResolvedValue({ data: response(), error: null });
		const result = await compareAuthorsEdge(supabase, 13473, 2825);

		expect(invoke).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ body: { author_a_id: 13473, author_b_id: 2825 } })
		);
		expect(result).toMatchObject({
			mode: 'on_demand',
			status: null,
			datasetVersion: 'author-comparisons-v1',
			self: {
				mode: 'on_demand',
				displayState: 'on_demand_not_formally_validated',
				selected: false,
				negLog10Q: null,
				pValue: 0.037,
				rateDifference: -0.03
			},
			reverse: { displayState: 'on_demand_not_formally_validated' }
		});
	});

	it.each([
		[false, false, false, 'not_enough_data'],
		[false, true, false, 'on_demand_not_formally_validated'],
		[true, false, false, 'not_enough_data'],
		[true, false, true, 'not_enough_data'],
		[true, true, false, 'evidence_threshold_not_met'],
		[true, true, true, 'validated']
	] as const)(
		'derives display state for release=%s, eligible=%s, selected=%s',
		async (present, eligible, selected, displayState) => {
			const payload = response();
			payload.a_to_b.eligible_for_production_test = eligible;
			payload.validated_relationship = {
				...payload.validated_relationship,
				present,
				directionality_status: present ? 'reliably_one_sided_a_to_b' : 'not_validated'
			};
			Object.assign(payload.validated_relationship, {
				a_to_b_selected: selected,
				b_to_a_selected: false,
				a_to_b_q_value: 0.01,
				b_to_a_q_value: 0.2
			});
			invoke.mockResolvedValue({ data: payload, error: null });
			const result = await compareAuthorsEdge(supabase, 13473, 2825);

			expect(result.self.displayState).toBe(displayState);
			expect(result.reverse.displayState).toBe(
				present ? 'evidence_threshold_not_met' : 'on_demand_not_formally_validated'
			);
			expect(result.status).toBe(present ? 2 : null);
			expect(result.self.negLog10Q).toBe(present ? 2 : null);
			expect(result.reverse.negLog10Q).toBe(present ? -Math.log10(0.2) : null);
		}
	);

	it('preserves null metrics for insufficient data in both directions', async () => {
		const payload = response();
		for (const direction of [payload.a_to_b, payload.b_to_a]) {
			Object.assign(direction, {
				eligible_for_production_test: false,
				evidence_status: 'no_comparable_readers',
				like_rate: null,
				rate_difference: null,
				p_value: null
			});
		}
		invoke.mockResolvedValue({ data: payload, error: null });
		const result = await compareAuthorsEdge(supabase, 13473, 2825);

		for (const direction of [result.self, result.reverse]) {
			expect(direction).toMatchObject({
				displayState: 'not_enough_data',
				likeRate: null,
				rateDifference: null,
				pValue: null,
				negLog10Q: null
			});
		}
	});

	it('rejects invocation errors before interpreting a comparison', async () => {
		invoke.mockResolvedValue({ data: null, error: { message: 'Not found' } });
		await expect(compareAuthorsEdge(supabase, 13473, 2825)).rejects.toThrow('Not found');
	});
});
