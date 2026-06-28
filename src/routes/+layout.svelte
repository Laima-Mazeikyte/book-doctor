<script lang="ts">
	import { onMount } from 'svelte';
	import { setOpenBugReportContext } from '$lib/bugReportContext';
	import { get } from 'svelte/store';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import {
		prefersReducedMotion,
		shouldMainNavPageTransition
	} from '$lib/navigation/mainNavTransition';
	import { page } from '$app/state';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { t } from '$lib/copy';
	import SkipLink from '$lib/components/SkipLink.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import AppFooter from '$lib/components/AppFooter.svelte';
	import BugReportModal from '$lib/components/BugReportModal.svelte';
	import SaveAccountPrompt from '$lib/components/SaveAccountPrompt.svelte';
	import {
		createLayoutAuthController,
		mountRatingsMigratedListener,
		mountRatingsRetryListeners
	} from '$lib/auth/bootstrap-auth';
	import { AUTH_SIGNED_IN_EVENT, isAuthTransitionActive } from '$lib/auth/completeAuthSuccess';
	import { onAfterNavigateForBrowseFeedWarm } from '$lib/feed/browseFeedWarm';
	import { isRateShellPath } from '$lib/navigation/rateShell';
	import { getSupabase } from '$lib/supabase';
	import {
		authStore,
		authReady,
		clearPasswordRecoveryFlag,
		isAnonymousOrSignedOut,
		markAuthInitReady
	} from '$lib/stores/auth';
	import { shortlistSavePromptStore } from '$lib/stores/shortlistSavePrompt';
	import {
		clearUserLibraryHydration,
		registerUserLibraryDetailsLoader,
		registerUserLibraryIdsLoader,
		scheduleUserLibraryDetailsLoad,
		unregisterUserLibraryDetailsLoader,
		unregisterUserLibraryIdsLoader
	} from '$lib/stores/userLibrary';
	import { ratingsStore } from '$lib/stores/ratings';
	import {
		recommendationsCountStore,
		refreshRecommendationsCountFromApi
	} from '$lib/stores/recommendationsCount';
	import { notInterestedStore } from '$lib/stores/notInterested';
	import { bookmarksPageStore } from '$lib/stores/bookmarksPage';
	import { recommendationsPageStore } from '$lib/stores/recommendationsPage';
	import {
		attachRatingsPersistence,
		createLibraryLoadCoordinator,
		loadUserLibraryDetails,
		reloadUserLibraryAfterMigration,
		resetUserLibraryOnSignOut,
		startUserLibraryIdsLoad
	} from '$lib/auth/user-library-loaders';

	let { children } = $props();

	let bugModalOpen = $state(false);
	let pageEnterTransition = $state(false);

	function openBugModal() {
		bugModalOpen = true;
	}

	function closeBugModal() {
		bugModalOpen = false;
	}

	setOpenBugReportContext(openBugModal);

	function skipToRateBottomBar(e: MouseEvent) {
		e.preventDefault();
		const el = document.getElementById('rate-bottom-bar');
		el?.scrollIntoView({ block: 'nearest' });
		el?.focus({ preventScroll: true });
	}

	const isShortlistShell = $derived(page.url.pathname === '/rate/recommendations/shortlist');

	const showSaveAccountPrompt = $derived.by(() => {
		if (!$shortlistSavePromptStore || !$authReady || !$isAnonymousOrSignedOut) return false;
		if (page.url.pathname !== '/rate/recommendations') return false;
		return !page.url.searchParams.get('request_id')?.trim();
	});

	/** Routes with `.book-card-grid` — drop main max-width so more columns fit on large screens */
	const isBookGridShell = $derived.by(() => {
		const pathname = page.url.pathname;
		if (isShortlistShell) return false;
		return (
			pathname === '/my-bookshelf' ||
			pathname === '/not-interested' ||
			pathname === '/faq' ||
			pathname === '/rate' ||
			pathname.startsWith('/rate/')
		);
	});

	const showAppFooter = $derived.by(() => {
		const pathname = page.url.pathname;
		if (isShortlistShell) return false;
		if (pathname === '/rate/recommendations') return true;
		return pathname !== '/rate' && !pathname.startsWith('/rate/');
	});

	const libraryCoordinator = createLibraryLoadCoordinator();
	const hadUserBefore = { current: false };
	const persistenceUserId = { current: null as string | null };
	const libraryHydratedForUserId = { current: null as string | null };
	let recommendationsCountLoadedForUserId: string | null = null;
	let activeLibraryLoadRequestId = 0;

	function reloadLibraryForCurrentUser(): void {
		const supabase = getSupabase();
		const user = get(authStore).user;
		if (!supabase || !user?.id) return;

		activeLibraryLoadRequestId = reloadUserLibraryAfterMigration(
			supabase,
			user.id,
			libraryCoordinator,
			libraryHydratedForUserId,
			persistenceUserId
		);
		scheduleUserLibraryDetailsLoad(user.id);
	}

	onMount(() => {
		ratingsStore.hydratePendingFromLocalStorage();
		notInterestedStore.hydrateFromLocalStorage();

		const supabaseClient = getSupabase();
		if (!supabaseClient) {
			markAuthInitReady();
			return;
		}

		const authController = createLayoutAuthController(supabaseClient);
		const unmountAuth = authController.mount();
		const unmountRetry = mountRatingsRetryListeners();
		const unmountMigrated = mountRatingsMigratedListener(reloadLibraryForCurrentUser);

		registerUserLibraryIdsLoader((userId) => {
			const supabase = getSupabase();
			if (!supabase || get(authStore).user?.id !== userId) return;
			if (libraryHydratedForUserId.current === userId) return;
			activeLibraryLoadRequestId = startUserLibraryIdsLoad(
				supabase,
				userId,
				libraryCoordinator,
				libraryHydratedForUserId
			);
		});
		registerUserLibraryDetailsLoader((userId) => {
			const supabase = getSupabase();
			if (!supabase || get(authStore).user?.id !== userId) return;
			void loadUserLibraryDetails(supabase, userId, activeLibraryLoadRequestId, libraryCoordinator);
		});

		const onSignedIn = () => {
			const user = get(authStore).user;
			const token = get(authStore).session?.access_token ?? null;
			if (!user?.id || !token) return;
			recommendationsCountLoadedForUserId = null;
			void refreshRecommendationsCountFromApi(token).then((ok) => {
				if (ok && get(authStore).user?.id === user.id) {
					recommendationsCountLoadedForUserId = user.id;
				}
			});
		};
		window.addEventListener(AUTH_SIGNED_IN_EVENT, onSignedIn);

		return () => {
			unmountAuth();
			unmountRetry();
			unmountMigrated();
			unregisterUserLibraryIdsLoader();
			unregisterUserLibraryDetailsLoader();
			window.removeEventListener(AUTH_SIGNED_IN_EVENT, onSignedIn);
		};
	});

	beforeNavigate(({ from, to }) => {
		pageEnterTransition =
			shouldMainNavPageTransition(from?.url.pathname ?? '', to?.url.pathname ?? '') &&
			!prefersReducedMotion();
	});

	afterNavigate(({ from, to }) => {
		if (
			from?.url.pathname === '/auth/reset-password' &&
			to?.url.pathname !== '/auth/reset-password'
		) {
			clearPasswordRecoveryFlag();
		}
		if (
			from?.url.pathname === '/rate/recommendations/shortlist' &&
			to?.url.pathname === '/rate/recommendations' &&
			!to.url.searchParams.get('request_id')?.trim() &&
			get(isAnonymousOrSignedOut)
		) {
			shortlistSavePromptStore.show();
		}
		onAfterNavigateForBrowseFeedWarm(from?.url, to?.url);
	});

	$effect(() => {
		if (!$isAnonymousOrSignedOut) {
			shortlistSavePromptStore.dismiss();
		}
	});

	$effect(() => {
		const session = $authStore.session;
		const user = $authStore.user;
		const supabase = typeof window !== 'undefined' ? getSupabase() : null;

		if (!supabase) return;

		const hasUser = !!(session && user);

		if (!hasUser) {
			libraryCoordinator.nextRequest();
			persistenceUserId.current = null;
			libraryHydratedForUserId.current = null;
			recommendationsCountLoadedForUserId = null;
			resetUserLibraryOnSignOut(hadUserBefore);
			bookmarksPageStore.reset();
			if (hadUserBefore && !isAuthTransitionActive()) {
				recommendationsPageStore.reset();
				recommendationsCountStore.set(0);
			}
			clearUserLibraryHydration();
			return;
		}

		hadUserBefore.current = true;
		attachRatingsPersistence(supabase, user.id, persistenceUserId);

		const pathname = page.url.pathname;
		if (libraryHydratedForUserId.current !== user.id) {
			activeLibraryLoadRequestId = startUserLibraryIdsLoad(
				supabase,
				user.id,
				libraryCoordinator,
				libraryHydratedForUserId
			);
		}

		const token = session.access_token ?? null;

		if (token && recommendationsCountLoadedForUserId !== user.id && !isRateShellPath(pathname)) {
			const userId = user.id;
			void refreshRecommendationsCountFromApi(token).then((ok) => {
				if (ok && get(authStore).user?.id === userId) {
					recommendationsCountLoadedForUserId = userId;
				}
			});
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Beth+Ellen&family=Inter:wght@400;500;600&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<SkipLink />
{#if page.url.pathname === '/rate'}
	<a
		href="#rate-bottom-bar"
		class="skip-link skip-link--rate-bottom-bar"
		onclick={skipToRateBottomBar}
	>
		{t('rate.skipToBottomBar')}
	</a>
{/if}
<div
	class="app-chrome"
	class:app-chrome--landing={page.url.pathname === '/'}
	class:app-chrome--shortlist={isShortlistShell}
>
	{#if !isShortlistShell}
		<AppHeader onOpenBugReport={openBugModal} />
	{/if}
	<main
		id="main"
		class:rate-page={page.url.pathname === '/rate'}
		class:landing-page={page.url.pathname === '/'}
		class:shortlist-page-main={isShortlistShell}
		class:main-book-grid-shell={isBookGridShell}
	>
		<div class="main-min">
			{#if pageEnterTransition}
				{#key page.url.pathname}
					<div class="page-enter" in:fade={{ duration: 150, easing: cubicOut }}>
						{@render children()}
					</div>
				{/key}
			{:else}
				{@render children()}
			{/if}
		</div>
	</main>
	{#if showAppFooter}
		<AppFooter onOpenBugReport={openBugModal} />
	{/if}
</div>
<BugReportModal open={bugModalOpen} onClose={closeBugModal} />
<SaveAccountPrompt open={showSaveAccountPrompt} />

<style>
	.app-chrome {
		display: flex;
		flex-direction: column;
		width: 100%;
		/* Matches AppHeader __inner: min-height 3.25rem + vertical padding (2× --space-3) */
		--app-header-chrome-height: 4.75rem;
	}
	.app-chrome--landing {
		min-height: 100dvh;
	}
	.app-chrome :global(main) {
		min-width: 0;
		width: 100%;
	}
	.app-chrome--landing :global(main) {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.main-min {
		min-width: 0;
		min-height: calc(100dvh - var(--app-header-chrome-height));
	}
	.app-chrome--landing .main-min {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.page-enter {
		min-height: 0;
		min-width: 0;
		width: 100%;
	}
	.app-chrome--landing .page-enter {
		flex: 1;
		display: flex;
		flex-direction: column;
	}
	.app-chrome--shortlist {
		min-height: 100dvh;
	}
	.app-chrome--shortlist :global(main.shortlist-page-main) {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		padding: 0;
		max-width: none;
	}
	.app-chrome--shortlist .main-min {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.app-chrome--shortlist .page-enter {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
</style>
