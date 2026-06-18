import { goto } from '$app/navigation';
import { getSupabase } from '$lib/supabase';

export async function requestRecommendations(userId: string | undefined): Promise<void> {
	if (!userId) {
		await goto('/rate/recommendations');
		return;
	}

	const supabase = getSupabase();
	if (supabase) {
		try {
			const { data, error } = await supabase
				.from('recommendation_requests')
				.insert({ user_id: userId })
				.select('id')
				.single();
			if (!error && data?.id != null) {
				await goto(
					`/rate/recommendations/shortlist?request_id=${encodeURIComponent(String(data.id))}`
				);
				return;
			}
		} catch {
			// fall through
		}
	}

	await goto('/rate/recommendations');
}
