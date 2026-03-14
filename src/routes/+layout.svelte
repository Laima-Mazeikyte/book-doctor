<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import SkipLink from '$lib/components/SkipLink.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import { getSupabase } from '$lib/supabase';
	import { authStore } from '$lib/stores/auth';
	import { ratingsStore } from '$lib/stores/ratings';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import type { RatingValue } from '$lib/types/book';

	let { children } = $props();

	async function loadUserRatingsAndPersistence(
		supabase: SupabaseClient,
		userId: string
	): Promise<void> {
		const { data: rows, error: ratingsError } = await supabase
			.from('user_ratings')
			.select('book_id, book_rating, books(id)')
			.eq('user_id', userId);

		if (ratingsError) {
			console.error('[ratings] Failed to load user ratings:', ratingsError.message);
			return;
		}
		const entries: Array<{ bookId: string; rating: RatingValue }> = (rows ?? []).map((row) => ({
			bookId: row.books?.id ? String(row.books.id) : String(row.book_id),
			rating: row.book_rating as RatingValue
		}));
		ratingsStore.hydrate(entries);

		ratingsStore.setPersistence({
			set(bookIdNum, value) {
				supabase
					.from('user_ratings')
					.upsert(
						{
							user_id: userId,
							book_id: bookIdNum,
							book_rating: value,
							updated_at: new Date().toISOString()
						},
						{ onConflict: 'user_id,book_id' }
					)
					.then(({ error }) => {
						if (error) console.error('[ratings] Failed to save rating:', error.message);
					});
			},
			remove(bookIdNum) {
				supabase
					.from('user_ratings')
					.delete()
					.eq('user_id', userId)
					.eq('book_id', bookIdNum)
					.then(({ error }) => {
						if (error) console.error('[ratings] Failed to remove rating:', error.message);
					});
			}
		});
	}

	onMount(async () => {
		const supabase = getSupabase();
		if (!supabase) return;
		try {
			const { data: { session } } = await supabase.auth.getSession();
			if (!session) {
				const { data: signInData, error } = await supabase.auth.signInAnonymously();
				if (error) {
					console.error('[auth] Anonymous sign-in failed:', error.message, error);
					return;
				}
				authStore.setSession(signInData?.session ?? null);
				if (signInData?.user) {
					console.debug('[auth] Anonymous sign-in OK, user id:', signInData.user.id);
				}
			} else {
				authStore.setSession(session);
			}

			const { data: { subscription } } = supabase.auth.onAuthStateChange(
				(_event, session) => {
					authStore.setSession(session);
				}
			);

			return () => {
				subscription.unsubscribe();
			};
		} catch (e) {
			console.error('[auth] Auth setup error', e);
		}
	});

	$effect(() => {
		const session = $authStore.session;
		const user = $authStore.user;
		const supabase = typeof window !== 'undefined' ? getSupabase() : null;

		if (!supabase) return;

		if (!session || !user) {
			ratingsStore.reset();
			ratingsStore.setPersistence(null);
			return;
		}

		loadUserRatingsAndPersistence(supabase, user.id);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<SkipLink />
<AppHeader />
<main id="main" class:rate-page={$page.url.pathname === '/rate'}>
	{@render children()}
</main>
