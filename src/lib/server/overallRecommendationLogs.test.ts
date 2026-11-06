import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { overallRecommendationLogs } from './overallRecommendationLogs';

function client(requests: { id: string; filters: unknown; public_id?: string | null }[]) {
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
			{ request_id: '1' },
			{ request_id: null },
			{ request_id: 'old-id' }
		];
		const requests = [
			{ id: '4', filters: { genres: { all_of: ['Africa'] } }, public_id: 'Filter4A' },
			{ id: '3', filters: {}, public_id: 'Overall3' },
			{ id: '2', filters: null }
		];
		const overall = await overallRecommendationLogs(client(requests), logs);
		expect(overall.logs.map((log) => log.request_id)).toEqual(['3', '2', '1', null, 'old-id']);
		expect([...overall.publicIds]).toEqual([['3', 'Overall3']]);
	});
});
