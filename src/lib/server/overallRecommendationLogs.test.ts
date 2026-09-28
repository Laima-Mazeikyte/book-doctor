import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { overallRecommendationLogs } from './overallRecommendationLogs';

function client(requests: { id: string; filters: unknown }[]) {
	return {
		from(table: string) {
			if (table !== 'recommendation_requests') throw new Error('Unexpected table');
			return {
				select() {
					return {
						in(_column: string, ids: string[]) {
							return Promise.resolve({
								data: requests.filter((request) => ids.includes(request.id)),
								error: null
							});
						}
					};
				}
			};
		}
	} as unknown as SupabaseClient;
}

describe('overall recommendation history', () => {
	it('excludes filtered runs while retaining unfiltered and historical runs', async () => {
		const logs = [
			{ request_id: '4' },
			{ request_id: '3' },
			{ request_id: '2' },
			{ request_id: 'old-id' }
		];
		const requests = [
			{ id: '4', filters: { genres: { all_of: ['Africa'] } } },
			{ id: '3', filters: {} },
			{ id: '2', filters: null }
		];
		expect(
			(await overallRecommendationLogs(client(requests), logs)).map((log) => log.request_id)
		).toEqual(['3', '2', 'old-id']);
	});
});
