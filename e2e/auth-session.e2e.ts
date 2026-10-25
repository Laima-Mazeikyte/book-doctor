import { expect, test, type Page } from '@playwright/test';
import { loadEnv } from 'vite';

// Match the existing library browser suites, including the first Vite route compilation.
test.setTimeout(60_000);

const base = 'http://127.0.0.1:4173';
const env = loadEnv('development', process.cwd(), '');
const supabaseUrl = env.PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL;
const authKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
const userId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function session(expired = false, refreshed = false) {
	return {
		access_token: refreshed ? 'auth-test-refreshed-token' : 'auth-test-stored-token',
		refresh_token: refreshed ? 'auth-test-rotated-refresh' : 'auth-test-stored-refresh',
		token_type: 'bearer',
		expires_in: 3600,
		expires_at: expired ? 1 : Math.floor(Date.now() / 1000) + 3600,
		user: {
			id: userId,
			is_anonymous: false,
			aud: 'authenticated',
			role: 'authenticated',
			email: 'auth-test@example.com',
			app_metadata: { provider: 'email' },
			user_metadata: {},
			created_at: new Date().toISOString()
		}
	};
}

async function setup(page: Page, expired = false) {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.addInitScript(
		({ authKey, storedSession }) => {
			if (!localStorage.getItem('auth-session-fixture-seeded')) {
				localStorage.setItem(authKey, JSON.stringify(storedSession));
				localStorage.setItem('auth-session-fixture-seeded', 'true');
			}
			const authLockRequests: string[] = [];
			Object.assign(window, { authLockRequests });
			const requestLock = navigator.locks.request.bind(navigator.locks);
			navigator.locks.request = ((name: string, ...args: unknown[]) => {
				if (name.startsWith('lock:sb-')) authLockRequests.push(name);
				return Reflect.apply(requestLock, navigator.locks, [name, ...args]);
			}) as typeof navigator.locks.request;
		},
		{ authKey, storedSession: session(expired) }
	);
	const state = { refreshes: 0, holdRefresh: null as Promise<void> | null, errors };
	await page.route('**/auth/v1/**', async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname.endsWith('/token') && url.searchParams.get('grant_type') === 'refresh_token') {
			state.refreshes++;
			await state.holdRefresh;
			return route.fulfill({ json: session(false, true) });
		}
		if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204, body: '' });
		throw new Error(`Unexpected auth request: ${url.pathname}`);
	});
	await page.route('**/rest/v1/**', (route) =>
		route.fulfill({
			json: [],
			headers: { 'content-range': '*/0', 'access-control-expose-headers': 'content-range' }
		})
	);
	await page.route('**/api/**', (route) =>
		route.fulfill({
			json: {
				books: [],
				count: 0,
				mode: 'below_threshold',
				interaction_count: 0,
				ratings_count: 0,
				eligible_for_feed: false,
				hasMore: false
			}
		})
	);
	await page.goto(base, { waitUntil: 'domcontentloaded' });
	await expect.poll(() => appIdentity(page)).toBe(userId);
	return state;
}

async function appIdentity(page: Page): Promise<string | null> {
	return page.evaluate(async () => {
		const path = '/src/lib/stores/auth.ts';
		const { authStore } = await import(path);
		let id: string | null = null;
		authStore.subscribe(
			(state: { user: { id: string } | null }) => (id = state.user?.id ?? null)
		)();
		return id;
	});
}

async function assertNoAuthLockOrPageErrors(page: Page, errors: string[]) {
	expect(
		await page.evaluate(
			() => (window as unknown as { authLockRequests: string[] }).authLockRequests
		)
	).toEqual([]);
	expect(errors).toEqual([]);
}

test('restores the existing session across reloads without acquiring native auth locks', async ({
	page
}) => {
	const state = await setup(page);
	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect.poll(() => appIdentity(page)).toBe(userId);
	expect(state.refreshes).toBe(0);
	await assertNoAuthLockOrPageErrors(page, state.errors);
});

test('refreshes an expired stored session and restores the signed-in app', async ({ page }) => {
	const state = await setup(page, true);
	expect(state.refreshes).toBe(1);
	await expect
		.poll(() =>
			page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').refresh_token, authKey)
		)
		.toBe('auth-test-rotated-refresh');
	await assertNoAuthLockOrPageErrors(page, state.errors);
});

test('leaves failed database reads to the application retry policy', async ({ page }) => {
	const state = await setup(page);
	let reads = 0;
	await page.route('**/rest/v1/auth_retry_fixture*', (route) => {
		reads++;
		return route.fulfill({ status: 503, json: { message: 'Synthetic read failure' } });
	});
	const status = await page.evaluate(async () => {
		const path = '/src/lib/supabase.ts';
		const { getSupabase } = await import(path);
		const result = await getSupabase()!.from('auth_retry_fixture').select('id');
		return result.status;
	});
	expect(status).toBe(503);
	expect(reads).toBe(1);
	await assertNoAuthLockOrPageErrors(page, state.errors);
});

test('deduplicates simultaneous refresh calls without locking the browser', async ({ page }) => {
	const state = await setup(page);
	let release!: () => void;
	state.holdRefresh = new Promise<void>((resolve) => (release = resolve));
	const refreshed = page.evaluate(async () => {
		const path = '/src/lib/supabase.ts';
		const { getSupabase } = await import(path);
		const client = getSupabase()!;
		const results = await Promise.all([client.auth.refreshSession(), client.auth.refreshSession()]);
		return results.map((result) => ({
			userId: result.data.user?.id,
			error: result.error?.message
		}));
	});
	await expect.poll(() => state.refreshes).toBe(1);
	release();
	expect(await refreshed).toEqual([
		{ userId, error: undefined },
		{ userId, error: undefined }
	]);
	expect(state.refreshes).toBe(1);
	expect(await appIdentity(page)).toBe(userId);
	await assertNoAuthLockOrPageErrors(page, state.errors);
});

test('does not restore a signed-out session when a held refresh finishes late', async ({
	page
}) => {
	const state = await setup(page);
	let release!: () => void;
	state.holdRefresh = new Promise<void>((resolve) => (release = resolve));
	const refreshed = page.evaluate(async () => {
		const path = '/src/lib/supabase.ts';
		const { getSupabase } = await import(path);
		const result = await getSupabase()!.auth.refreshSession();
		return result.data.session?.user.id ?? null;
	});
	await expect.poll(() => state.refreshes).toBe(1);
	await page.getByRole('button', { name: 'Account', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
	await expect.poll(() => appIdentity(page)).toBeNull();
	release();
	expect(await refreshed).toBeNull();
	expect(await appIdentity(page)).toBeNull();
	expect(await page.evaluate((key) => localStorage.getItem(key), authKey)).toBeNull();
	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('button', { name: 'Log in', exact: true }).first()).toBeVisible();
	expect(await appIdentity(page)).toBeNull();
	await assertNoAuthLockOrPageErrors(page, state.errors);
});

test('shares refreshed sessions and sign-out across tabs', async ({ page, context }) => {
	const state = await setup(page);
	const other = await context.newPage();
	const otherState = await setup(other);
	await page.evaluate(async () => {
		const path = '/src/lib/supabase.ts';
		const { getSupabase } = await import(path);
		const result = await getSupabase()!.auth.refreshSession();
		if (result.error) throw result.error;
	});
	await expect
		.poll(() =>
			other.evaluate(async () => {
				const path = '/src/lib/stores/auth.ts';
				const { authStore } = await import(path);
				let token: string | null = null;
				authStore.subscribe(
					(state: { session: { access_token: string } | null }) =>
						(token = state.session?.access_token ?? null)
				)();
				return token;
			})
		)
		.toBe('auth-test-refreshed-token');
	expect(state.refreshes).toBe(1);
	expect(otherState.refreshes).toBe(0);
	await other.getByRole('button', { name: 'Account', exact: true }).click();
	await other.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
	await expect.poll(() => appIdentity(other)).toBeNull();
	await expect.poll(() => appIdentity(page)).toBeNull();
	await assertNoAuthLockOrPageErrors(page, state.errors);
	await assertNoAuthLockOrPageErrors(other, otherState.errors);
});
